"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/ingest";
import { OPEN_STATUSES } from "@/lib/queue/pool";
import { followUpDate, pursuitEvent, transitionFields } from "@/lib/queue/pursuit";
import { draftCoverLetter } from "@/lib/llm/cover";
import { analyzeFit, verdictFields } from "@/lib/llm/fit";

// The rules — stamps, nudges, reasons, the event shape — live in
// queue/pursuit.ts (ADR-12). These handlers read the form and apply what the
// lifecycle says; nothing here decides anything.
export async function setStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  // One transaction around read-then-write. A double-click sends two of these
  // concurrently; computed from the same snapshot, the second would re-stamp
  // what the first just stamped. Serialized, it computes from the first's
  // result and correctly changes nothing.
  await prisma.$transaction(async (tx) => {
    const current = await tx.job.findUnique({
      where: { id },
      select: { status: true, appliedAt: true, followUpAt: true },
    });
    if (!current) return;
    const { fields, event } = transitionFields(current, status, {
      reason: String(formData.get("reason") ?? "") || null,
    });
    await tx.job.update({
      where: { id },
      data: { ...fields, actions: { create: event } },
    });
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
  if (affected.length === 0) return;
  // One lifecycle answer for the whole sweep — the same definition the
  // single-row path uses, not a second spelling of it. The synthetic state is
  // honest: every affected row is OPEN (the where says so), and dismissal's
  // effects do not depend on the rest of the row. If they ever do, this must
  // start feeding real rows — which is why only `id` is selected: selecting
  // state and then not using it would read as though it were.
  const { fields, event } = transitionFields(
    { status: "new", appliedAt: null, followUpAt: null },
    "ignored",
    { reason: "company-applied", bulk: true },
  );
  await prisma.job.updateMany({
    where: { id: { in: affected.map((a) => a.id) } },
    data: fields,
  });
  await prisma.userActionLog.createMany({
    data: affected.map((a) => ({ jobId: a.id, ...event })),
  });
  revalidatePath("/");
  revalidatePath("/dismissed");
}

export async function setFollowUp(formData: FormData) {
  const id = String(formData.get("id"));
  const days = String(formData.get("days")); // "3" | "7" | "clear"
  await prisma.job.update({
    where: { id },
    data: { followUpAt: followUpDate(days) },
  });
  revalidatePath("/applied");
}

export async function saveNote(formData: FormData) {
  const id = String(formData.get("id"));
  const note = String(formData.get("note") ?? "").slice(0, 500);
  await prisma.job.update({
    where: { id },
    data: { note: note || null, actions: { create: pursuitEvent("note", null) } },
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
    data: verdictFields(fit, "on-demand-strong", job),
  });
  revalidatePath("/");
}
