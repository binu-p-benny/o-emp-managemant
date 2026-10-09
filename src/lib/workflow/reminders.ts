// Daily reminder rules — pure. The runner (reminders-runner.ts) loads tasks,
// calls computeReminders and inserts the results with skipDuplicates, so the
// dedupe key guarantees at most one notification per task / type / user / day.

import { dayDiff } from "./dates";
import type { TaskKindKey, TaskStatusKey } from "./types";

export type ReminderSettings = {
  /** "HH:MM" in the app timezone. */
  time: string;
  dueSoonDays: number;
  /** [notify department head after N days overdue, notify MD after M days]. */
  escalationDays: [number, number];
  reviewWaitingDays: number;
  startWaitingDays: number;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  time: "09:00",
  dueSoonDays: 2,
  escalationDays: [3, 7],
  reviewWaitingDays: 2,
  startWaitingDays: 2,
};

export type ReminderTask = {
  id: string;
  projectId: string;
  projectCode: string;
  name: string;
  kind: TaskKindKey;
  status: TaskStatusKey;
  plannedEnd: Date | null;
  /** false for construction tasks before "Start construction". */
  visible: boolean;
  /** Is the task's phase running? Tasks in phases not yet started are skipped. */
  phaseActive: boolean;
  assigneeIds: string[];
  reviewerIds: string[];
  deptHeadIds: string[];
  lastSubmittedAt: Date | null;
  createdAt: Date;
};

export type ReminderType = "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "ESCALATION" | "REVIEW_WAITING" | "START_TASK_WAITING";

export type Reminder = {
  userId: string;
  type: ReminderType;
  taskId: string;
  projectId: string;
  message: string;
  dedupeKey: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param today   date-only (UTC midnight) for the app-timezone "today"
 * @param todayKey "YYYY-MM-DD", used in dedupe keys
 */
export function computeReminders(
  tasks: ReminderTask[],
  ctx: { today: Date; todayKey: string; settings: ReminderSettings; mdIds: string[] },
): Reminder[] {
  const out = new Map<string, Reminder>();
  const add = (userIds: string[], type: ReminderType, t: ReminderTask, message: string) => {
    for (const userId of new Set(userIds)) {
      const dedupeKey = `${type}:${t.id}:${userId}:${ctx.todayKey}`;
      if (!out.has(dedupeKey)) out.set(dedupeKey, { userId, type, taskId: t.id, projectId: t.projectId, message, dedupeKey });
    }
  };
  const [escalateHead, escalateMd] = ctx.settings.escalationDays;

  for (const t of tasks) {
    if (t.status === "COMPLETED" || !t.visible) continue;
    const label = `${t.projectCode} · ${t.name}`;

    // Start tasks: remind the head when one has been waiting too long.
    if (t.kind === "PHASE_START") {
      const waiting = dayDiff(t.createdAt, ctx.today);
      if (waiting > ctx.settings.startWaitingDays) add(t.assigneeIds, "START_TASK_WAITING", t, `${label} has been waiting ${plural(waiting, "day")} for you to start it.`);
      continue;
    }

    // Reviews waiting on the reviewer.
    if (t.status === "IN_REVIEW" && t.lastSubmittedAt) {
      const waiting = dayDiff(t.lastSubmittedAt, ctx.today);
      if (waiting > ctx.settings.reviewWaitingDays) add(t.reviewerIds, "REVIEW_WAITING", t, `${label} has been waiting ${plural(waiting, "day")} for your review.`);
    }

    if (!t.plannedEnd || !t.phaseActive) continue;
    // Unassigned work is chased with the department head.
    const owners = t.assigneeIds.length ? t.assigneeIds : t.deptHeadIds;
    const diff = dayDiff(ctx.today, t.plannedEnd);

    if (diff < 0) {
      const late = -diff;
      add(owners, "OVERDUE", t, `${label} is overdue by ${plural(late, "day")}.`);
      if (late > escalateHead) add(t.deptHeadIds, "ESCALATION", t, `Escalation: ${label} is ${plural(late, "day")} overdue.`);
      if (late > escalateMd) add(ctx.mdIds, "ESCALATION", t, `Escalation: ${label} is ${plural(late, "day")} overdue.`);
    } else if (diff === 0) {
      add(owners, "DUE_TODAY", t, `${label} is due today.`);
    } else if (diff <= ctx.settings.dueSoonDays) {
      add(owners, "DUE_SOON", t, `${label} is due in ${plural(diff, "day")}.`);
    }
  }
  return [...out.values()];
}
