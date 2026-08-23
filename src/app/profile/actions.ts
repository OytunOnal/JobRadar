"use server";

import { spawn } from "node:child_process";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { patchSettings, loadSettings } from "@/lib/settings";
import { profile } from "@/lib/profile";
import { SCORER_VERSION } from "@/lib/score";
import { EXTRACTOR_VERSION } from "@/lib/facts";
import { FIT_PROMPT_VERSION } from "@/lib/fit";
import { deriveVisaTier } from "@/lib/visa";
import type { TrackDef } from "@/lib/profile";

// Editing the profile is never just a save: it invalidates work the pipeline
// already did. Every action here reports what it touched, and the page offers
// the matching repair — the alternative (silently inconsistent pool) is the
// failure mode this whole page exists to prevent.

const csv = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function savePreferences(formData: FormData): Promise<void> {
  patchSettings({
    languages: csv(formData.get("languages")),
    workAuthorization: csv(formData.get("workAuthorization")),
    acceptRegions: csv(formData.get("acceptRegions")),
    extraRoleNegatives: csv(formData.get("extraRoleNegatives")),
    seniority: {
      boost: csv(formData.get("seniorityBoost")),
      avoid: csv(formData.get("seniorityAvoid")),
    },
    salaryFloorEURYear: Number(formData.get("salaryFloor")) || undefined,
  });
  revalidatePath("/profile");
  revalidatePath("/");
}

export async function saveTrack(formData: FormData): Promise<void> {
  const key = String(formData.get("key"));
  const tracks: TrackDef[] = [...profile.tracks];
  const idx = tracks.findIndex((t) => t.key === key);
  if (idx === -1) return;
  tracks[idx] = {
    ...tracks[idx],
    label: String(formData.get("label") || tracks[idx].label),
    titleKeywords: csv(formData.get("titleKeywords")),
    bodyKeywords: csv(formData.get("bodyKeywords")),
    seniority: {
      boost: csv(formData.get("boost")),
      avoid: csv(formData.get("avoid")),
    },
  };
  patchSettings({ tracks });
  revalidatePath("/profile");
}

export async function moveTrack(formData: FormData): Promise<void> {
  // Order is load-bearing: on an equal score the earlier track wins the job's
  // label, so "most specific first" is a real setting, not cosmetics.
  const key = String(formData.get("key"));
  const dir = String(formData.get("dir")) === "up" ? -1 : 1;
  const tracks = [...profile.tracks];
  const i = tracks.findIndex((t) => t.key === key);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= tracks.length) return;
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  patchSettings({ tracks });
  revalidatePath("/profile");
}

export async function removeTrack(formData: FormData): Promise<void> {
  const key = String(formData.get("key"));
  patchSettings({ tracks: profile.tracks.filter((t) => t.key !== key) });
  revalidatePath("/profile");
}

export async function addTrack(formData: FormData): Promise<void> {
  const label = String(formData.get("label") || "").trim();
  if (!label) return;
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (profile.tracks.some((t) => t.key === key)) return;
  patchSettings({
    tracks: [
      ...profile.tracks,
      { key, label, titleKeywords: csv(formData.get("titleKeywords")), bodyKeywords: [] },
    ],
  });
  revalidatePath("/profile");
}

// Recompute the derived visa tier in-process: it is pure local arithmetic and
// finishes in seconds, so the user gets an immediately consistent radar rather
// than a "run this command" instruction.
export async function retierVisa(): Promise<void> {
  const BATCH = 5000;
  let cursor = "";
  for (;;) {
    const rows = await prisma.job.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, visa: true, sponsorReg: true, source: true, country: true, visaTier: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      const tier = deriveVisaTier(r, profile.workAuthorization);
      if (tier !== r.visaTier) {
        await prisma.job.update({ where: { id: r.id }, data: { visaTier: tier } });
      }
    }
  }
  revalidatePath("/profile");
  revalidatePath("/");
}

// Heavy repairs (rescore, facts, re-judge) run as detached workers: they take
// minutes to days, so the page starts them and the log/telemetry shows
// progress — the UI must never block on them.
export async function startTask(formData: FormData): Promise<void> {
  const task = String(formData.get("task"));
  const allowed: Record<string, string[]> = {
    rescore: ["run", "rescore"],
    facts: ["run", "facts:fill"],
    embed: ["run", "embed:fill"],
    fit: ["run", "fit:fill", "--", "--wide", "--wait", "30"],
  };
  const argv = allowed[task];
  if (!argv) return;
  const child = spawn("npm", argv, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    shell: true,
    env: { ...process.env },
  });
  child.unref();
  revalidatePath("/profile");
}

export interface ImpactCounts {
  totalJobs: number;
  candidates: number;
  staleScores: number;
  staleFacts: number;
  staleJudgments: number;
  missingVectors: number;
  visaDrift: number;
}

export async function impactCounts(): Promise<ImpactCounts> {
  const live = { delistedAt: null, duplicateOfId: null } as const;
  const [totalJobs, candidates, staleScores, staleFacts, staleJudgments, missingVectors] =
    await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: { ...live, disqualified: false } }),
      prisma.job.count({ where: { scores: { none: { scorerVersion: SCORER_VERSION } } } }),
      prisma.job.count({
        where: {
          ...live, disqualified: false, score: { gte: 40 },
          OR: [{ facts: { is: null } }, { facts: { extractorVersion: { not: EXTRACTOR_VERSION } } }],
        },
      }),
      prisma.job.count({
        where: {
          ...live, fitScore: { not: null },
          judgments: { none: { promptVersion: FIT_PROMPT_VERSION } },
        },
      }),
      prisma.job.count({ where: { ...live, disqualified: false, vector: { is: null } } }),
    ]);
  // Sample-based drift check — the same invariant `npm run doctor` audits.
  const sample = await prisma.job.findMany({
    where: live,
    select: { visa: true, sponsorReg: true, source: true, country: true, visaTier: true },
    take: 5000,
    orderBy: { updatedAt: "desc" },
  });
  const visaDrift = sample.filter((j) => deriveVisaTier(j, profile.workAuthorization) !== j.visaTier).length;
  return { totalJobs, candidates, staleScores, staleFacts, staleJudgments, missingVectors, visaDrift };
}

export async function currentSettings() {
  return loadSettings();
}
