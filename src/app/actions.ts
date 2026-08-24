"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/ingest";
import { OPEN_STATUSES } from "@/lib/pool";
import { draftCoverLetter } from "@/lib/cover";
import { analyzeFit, FIT_PROMPT_VERSION } from "@/lib/fit";

const FOLLOW_UP_DAYS = 10; // Europe answers slowly — first nudge after 10 days

export async function setStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  const extra: { appliedAt?: Date; followUpAt?: Date | null; dismissReason?: string | null } = {};
  if (status === "applied") {
    const cur = await prisma.job.findUnique({ where: { id }, select: { appliedAt: true } });
    if (!cur?.appliedAt) {
      extra.appliedAt = new Date();
      extra.followUpAt = new Date(Date.now() + FOLLOW_UP_DAYS * 86_400_000);
    }
  }
  // Terminal states don't need nudging.
  if (status === "rejected" || status === "ghosted" || status === "offer") extra.followUpAt = null;
  // Dismissing records why (labeled feedback for scorer tuning); leaving the
  // dismissed state clears it.
  if (status === "ignored") {
    const reason = String(formData.get("reason") ?? "");
    extra.dismissReason = reason || null;
  } else {
    extra.dismissReason = null;
  }
  await prisma.job.update({
    where: { id },
    data: {
      status, ...extra,
      actions: {
        create: {
          type: status === "ignored" ? "dismissed" : "status-change",
          payload: JSON.stringify({ to: status, ...(extra.dismissReason ? { reason: extra.dismissReason } : {}) }),
          at: new Date(),
        },
      },
    },
  });
  revalidatePath("/");
  revalidatePath("/applied");
  revalidatePath("/dismissed");
}

// One click instead of N: after applying at a company, hide its remaining
// discoverable postings (dismissal data: one Mistral application cost 14
// manual dismissals). Only touches new/interested — pipeline stays intact.
export async function dismissCompanyRest(formData: FormData) {
  const company = String(formData.get("company"));
  if (!company) return;
  const affected = await prisma.job.findMany({
    where: { company, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  await prisma.job.updateMany({
    where: { id: { in: affected.map((a) => a.id) } },
    data: { status: "ignored", dismissReason: "company-applied" },
  });
  await prisma.userActionLog.createMany({
    data: affected.map((a) => ({
      jobId: a.id, type: "dismissed", payload: '{"reason":"company-applied","bulk":true}', at: new Date(),
    })),
  });
  revalidatePath("/");
  revalidatePath("/dismissed");
}

export async function setFollowUp(formData: FormData) {
  const id = String(formData.get("id"));
  const days = String(formData.get("days")); // "3" | "7" | "clear"
  await prisma.job.update({
    where: { id },
    data: { followUpAt: days === "clear" ? null : new Date(Date.now() + Number(days) * 86_400_000) },
  });
  revalidatePath("/applied");
}

export async function saveNote(formData: FormData) {
  const id = String(formData.get("id"));
  const note = String(formData.get("note") ?? "").slice(0, 500);
  await prisma.job.update({
    where: { id },
    data: { note: note || null, actions: { create: { type: "note", payload: null, at: new Date() } } },
  });
  revalidatePath("/applied");
}

export async function triggerIngest() {
  await runIngest();
  revalidatePath("/");
}

export async function draftCover(formData: FormData) {
  const id = String(formData.get("id"));
  const job = await prisma.job.findUnique({ where: { id }, include: { content: true } });
  if (!job) return;
  const letter = await draftCoverLetter({ ...job, description: job.content?.description ?? job.title });
  await prisma.jobContent.update({ where: { jobId: id }, data: { coverLetter: letter } });
  revalidatePath("/");
}

export async function analyzeFitAction(formData: FormData) {
  const id = String(formData.get("id"));
  const job = await prisma.job.findUnique({ where: { id }, include: { content: true } });
  if (!job) return;
  // Deliberate per-job check from the dashboard — use the strong model.
  const fit = await analyzeFit({ ...job, description: job.content?.description ?? job.title, visaTier: job.visaTier, seniorityLevel: job.seniorityLevel, langReq: job.langReq }, "strong");
  if (!fit) return;
  await prisma.job.update({
    where: { id },
    data: {
      fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment, fitCategory: fit.category, ghostRisk: fit.ghostRisk,
      ...(fit.category === "NO_VISA" ? { visa: "no", visaBy: "llm" } : {}),
      judgments: {
        create: {
          model: "on-demand-strong", promptVersion: FIT_PROMPT_VERSION, fitScore: fit.fitScore,
          verdict: fit.verdict, category: fit.category, seniorityLevel: job.seniorityLevel,
          ghostRisk: fit.ghostRisk, comment: fit.comment, at: new Date(),
        },
      },
    },
  });
  revalidatePath("/");
}
