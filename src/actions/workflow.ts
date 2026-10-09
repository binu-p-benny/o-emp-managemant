"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DelayType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { saveReminderSettings } from "@/lib/settings";
import type { Actor } from "@/lib/workflow/access";
import { runDailyReminders } from "@/lib/workflow/reminders-runner";
import * as wf from "@/lib/workflow/service";

export type WorkflowResult = { ok?: true; error?: string; needsReason?: "milestone" | "interior" | "sequence"; message?: string };

async function run(fn: (actor: Actor) => Promise<unknown>): Promise<WorkflowResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Your session has expired. Please sign in again." };
    const actor = await wf.actorFor(prisma, user.id);
    await fn(actor);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof wf.NeedsReasonError) return { needsReason: e.kind, message: e.message };
    if (e instanceof wf.WorkflowError) return { error: e.message };
    console.error("[workflow]", e);
    return { error: "Something went wrong — please try again." };
  }
}

const id = z.string().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const text = z.string().trim().max(1000).nullable().optional();

export async function startPhaseAction(input: { taskId: string; startDate?: string; kickoff?: string; assignments?: { taskId: string; userId: string }[] }) {
  const d = z.object({ taskId: id, startDate: day, kickoff: day, assignments: z.array(z.object({ taskId: id, userId: z.string() })).optional() }).parse(input);
  return run((a) => wf.startPhase(a, { taskId: d.taskId, startDate: d.startDate ?? undefined, kickoff: d.kickoff ?? undefined, assignments: d.assignments }));
}

export async function submitTaskAction(taskId: string, note?: string) {
  return run((a) => wf.submitTask(a, id.parse(taskId), note));
}

export async function approveTaskAction(taskId: string, note?: string, actualEnd?: string) {
  return run((a) => wf.approveTask(a, id.parse(taskId), note, day.parse(actualEnd) ?? undefined));
}

export async function completeTaskAction(taskId: string, actualEnd?: string) {
  return run((a) => wf.completeTask(a, id.parse(taskId), day.parse(actualEnd) ?? undefined));
}

export async function sendBackTaskAction(taskId: string, input: { note: string; logDelayDays?: number | null; reassignTo?: string | null }) {
  const d = z.object({ note: z.string().trim().min(1, "A reason is required."), logDelayDays: z.number().int().min(0).max(3650).nullable().optional(), reassignTo: z.string().nullable().optional() }).safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input." };
  return run((a) => wf.sendBackTask(a, id.parse(taskId), { note: d.data.note, logDelayDays: d.data.logDelayDays, reassignTo: d.data.reassignTo || null }));
}

export async function startTaskAction(taskId: string, reason?: string) {
  return run((a) => wf.startTask(a, id.parse(taskId), reason));
}

export async function setPlannedDatesAction(taskId: string, input: { plannedStart?: string | null; plannedEnd: string; reason?: string | null; interiorOverrideReason?: string | null }) {
  const d = z.object({ plannedStart: day, plannedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a planned end date."), reason: text, interiorOverrideReason: text }).safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input." };
  return run((a) => wf.setPlannedDates(a, id.parse(taskId), d.data));
}

export async function resetPlannedAction(taskId: string) {
  return run((a) => wf.resetPlannedToAuto(a, id.parse(taskId)));
}

export async function setActualDatesAction(taskId: string, input: { actualStart?: string | null; actualEnd?: string | null }) {
  const d = z.object({ actualStart: day, actualEnd: day }).parse(input);
  return run((a) => wf.setActualDates(a, id.parse(taskId), d));
}

export async function flagDelayAction(taskId: string, input: { type: DelayType; reason: string; delayDays?: number | null; shiftFollowing?: boolean }) {
  const d = z
    .object({ type: z.enum(["IN_HOUSE", "CLIENT_SIDE", "REWORK"]), reason: z.string().trim().min(1, "A reason is required.").max(1000), delayDays: z.number().int().min(0).max(3650).nullable().optional(), shiftFollowing: z.boolean().optional() })
    .safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input." };
  return run((a) => wf.flagDelay(a, id.parse(taskId), d.data));
}

export async function reassignTaskAction(taskId: string, input: { toUserId: string; replaceUserId?: string | null; reason?: string | null }) {
  const d = z.object({ toUserId: id, replaceUserId: z.string().nullable().optional(), reason: text }).parse(input);
  return run((a) => wf.reassignTask(a, id.parse(taskId), d));
}

export async function saveConstructionPlanAction(
  projectId: string,
  input: { kickoff: string | null; rows: { taskId: string; plannedStart?: string | null; plannedEnd?: string | null; assigneeId?: string | null }[]; reason?: string | null; interiorOverrideReason?: string | null },
) {
  const d = z
    .object({
      kickoff: day,
      rows: z.array(z.object({ taskId: id, plannedStart: day, plannedEnd: day, assigneeId: z.string().nullable().optional() })).max(100),
      reason: text,
      interiorOverrideReason: text,
    })
    .safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid plan." };
  return run((a) => wf.saveConstructionPlan(a, id.parse(projectId), { ...d.data, kickoff: d.data.kickoff ?? null }));
}

// ─── Settings (MD only) ─────────────────────────────────────────────────────

const settingsSchema = z
  .object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)."),
    dueSoonDays: z.coerce.number().int().min(0).max(30),
    escalationHead: z.coerce.number().int().min(1).max(90),
    escalationMd: z.coerce.number().int().min(1).max(180),
    reviewWaitingDays: z.coerce.number().int().min(1).max(60),
    startWaitingDays: z.coerce.number().int().min(1).max(60),
  })
  .refine((v) => v.escalationMd > v.escalationHead, { message: "MD escalation must come after the department-head escalation.", path: ["escalationMd"] });

export async function saveReminderSettingsAction(_prev: { ok?: boolean; error?: string }, formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user?.isSuperAdmin) return { error: "Only the Managing Director can change reminder settings." };
  const d = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid settings." };
  await saveReminderSettings(
    { time: d.data.time, dueSoonDays: d.data.dueSoonDays, escalationDays: [d.data.escalationHead, d.data.escalationMd], reviewWaitingDays: d.data.reviewWaitingDays, startWaitingDays: d.data.startWaitingDays },
    user.id,
  );
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function runRemindersNowAction(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const user = await getCurrentUser();
  if (!user?.isSuperAdmin) return { error: "Only the Managing Director can run reminders." };
  const r = await runDailyReminders();
  revalidatePath("/", "layout");
  return { ok: true, message: `${r.sent} new notification(s) from ${r.considered} open task(s).` };
}

export async function markAllNotificationsReadAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
