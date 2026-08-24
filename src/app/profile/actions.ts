"use server";

import { spawn } from "node:child_process";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { patchSettings, loadSettings } from "@/lib/user/settings";
import { profile } from "@/lib/user/profile";
import { SCORER_VERSION } from "@/lib/scoring/score";
import { EXTRACTOR_VERSION } from "@/lib/llm/facts";
import { FIT_PROMPT_VERSION, judgeQueueWhere } from "@/lib/llm/fit";
import { staleVectorWhere } from "@/lib/llm/embed";
import { deriveVisaTier } from "@/lib/visa/visa";
import { andWhere, liveWhere, openWhere } from "@/lib/queue/pool";
import type { TrackDef } from "@/lib/user/profile";

// Editing the profile is never just a save: it invalidates work the pipeline
// already did. Every action here reports what it touched, and the page offers
// the matching repair — the alternative (silently inconsistent pool) is the
// failure mode this whole page exists to prevent.

// An empty field means "no override", not "an empty list". They are not the
// same thing here: buildProfile composes with `settings.acceptRegions ??
// u.acceptRegions ?? defaultRegions`, and `[]` satisfies `??`. Clearing the
// regions box therefore stored [], regionOk() rejected every locatable
// posting, and the next rescore disqualified most of the pool with nothing on
// screen saying why.
const csvOrUndefined = (v: FormDataEntryValue | null): string[] | undefined => {
  const list = csv(v);
  return list.length ? list : undefined;
};

const csv = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function savePreferences(formData: FormData): Promise<void> {
  patchSettings({
    languages: csvOrUndefined(formData.get("languages")),
    workAuthorization: csvOrUndefined(formData.get("workAuthorization")),
    acceptRegions: csvOrUndefined(formData.get("acceptRegions")),
    extraRoleNegatives: csvOrUndefined(formData.get("extraRoleNegatives")),
    seniority: {
      boost: csv(formData.get("seniorityBoost")),
      avoid: csv(formData.get("seniorityAvoid")),
    },
    salaryFloorEURYear: Number(formData.get("salaryFloor")) || undefined,
  });
  revalidatePath("/profile");
  revalidatePath("/");
}

// Which model does the judging. The local model is the recommendation, not
// the requirement: a machine that cannot host a 27B should be able to point
// this at a cloud key instead, and a user who does not want their CV leaving
// the laptop should be able to refuse one. Both are one dropdown away.
export async function saveJudge(formData: FormData): Promise<void> {
  const lead = String(formData.get("lead") || "ollama");
  const localModel = String(formData.get("localModel") || "").trim();
  const localOnly = formData.get("localOnly") === "on";
  patchSettings({
    llm: {
      // The chosen provider leads; everything else keeps its default position
      // behind it, so adding a key later needs no edit here.
      order: [lead],
      localModel: localModel || undefined,
      // "My CV never leaves this machine" is a real preference, and it
      // deserves a real switch rather than asking the user to delete keys
      // they may want back tomorrow. Note this turns the fallback chain OFF:
      // if the local model is down, judging stops instead of going to a
      // provider the user just refused.
      disabled: localOnly ? ["anthropic", "cerebras", "groq", "gemini", "deepseek"] : [],
    },
  });
  revalidatePath("/profile");
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
  open: number;
  staleScores: number;
  staleFacts: number;
  staleJudgments: number;
  missingVectors: number;
  visaDrift: number;
}

export async function impactCounts(): Promise<ImpactCounts> {
  // A health panel that disagrees with the pipeline it reports on is worse
  // than no panel. It said so already about vectors — and then answered every
  // other row with its own hand-written filter. Each count below is now the
  // queue it reports on, composed from the same functions that queue feeds on.
  //
  // One of them changed answer as a result: staleJudgments asked a different COLUMN
  // than the pipeline — a join against the judgment history rather than the
  // posting's own stamp — which is a third opinion on "judged by an old
  // prompt", where two were already one too many.
  const NOW = new Date();
  const [totalJobs, open, staleScores, staleFacts, staleJudgments, missingVectors] =
    await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: openWhere() }),
      prisma.job.count({ where: { scores: { none: { scorerVersion: SCORER_VERSION } } } }),
      prisma.job.count({
        where: andWhere(openWhere(), { score: { gte: 40 } }, {
          OR: [{ facts: { is: null } }, { facts: { extractorVersion: { not: EXTRACTOR_VERSION } } }],
        }),
      }),
      prisma.job.count({ where: andWhere(judgeQueueWhere(true, NOW), { fitScore: { not: null } }) }),
      prisma.job.count({ where: andWhere(openWhere(), staleVectorWhere()) }),
    ]);
  // Sample-based drift check — the same invariant `npm run doctor` audits.
  const sample = await prisma.job.findMany({
    where: liveWhere(),
    select: { visa: true, sponsorReg: true, source: true, country: true, visaTier: true },
    take: 5000,
    orderBy: { updatedAt: "desc" },
  });
  const visaDrift = sample.filter((j) => deriveVisaTier(j, profile.workAuthorization) !== j.visaTier).length;
  return { totalJobs, open, staleScores, staleFacts, staleJudgments, missingVectors, visaDrift };
}

export async function currentSettings() {
  return loadSettings();
}
