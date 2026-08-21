"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/ingest";
import { draftCoverLetter } from "@/lib/cover";
import { analyzeFit } from "@/lib/fit";

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
  await prisma.job.update({ where: { id }, data: { status, ...extra } });
  revalidatePath("/");
  revalidatePath("/applied");
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
  await prisma.job.update({ where: { id }, data: { note: note || null } });
  revalidatePath("/applied");
}

export async function triggerIngest() {
  await runIngest();
  revalidatePath("/");
}

export async function draftCover(formData: FormData) {
  const id = String(formData.get("id"));
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;
  const letter = await draftCoverLetter(job);
  await prisma.job.update({ where: { id }, data: { coverLetter: letter } });
  revalidatePath("/");
}

export async function analyzeFitAction(formData: FormData) {
  const id = String(formData.get("id"));
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;
  // Deliberate per-job check from the dashboard — use the strong model.
  const fit = await analyzeFit(job, "strong");
  if (!fit) return;
  await prisma.job.update({
    where: { id },
    data: { fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment, fitCategory: fit.category, ghostRisk: fit.ghostRisk, ...(fit.category === "NO_VISA" ? { visa: "no" } : {}) },
  });
  revalidatePath("/");
}
