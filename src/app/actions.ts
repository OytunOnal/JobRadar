"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/ingest";
import { draftCoverLetter } from "@/lib/cover";
import { analyzeFit } from "@/lib/fit";

export async function setStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await prisma.job.update({ where: { id }, data: { status } });
  revalidatePath("/");
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
    data: { fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment, fitCategory: fit.category, ghostRisk: fit.ghostRisk },
  });
  revalidatePath("/");
}
