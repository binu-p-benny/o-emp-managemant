// Daily reminder job: loads open tasks, applies the rules in reminders.ts and
// stores notifications (dedupe key = one per task / type / user / day).

import { APP_TIMEZONE, dateOnly, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getLastReminderRun, getReminderSettings, setLastReminderRun } from "@/lib/settings";
import { computeReminders, type ReminderTask } from "./reminders";
import { loadTemplates } from "./templates";

export async function runDailyReminders(now = new Date()) {
  const settings = await getReminderSettings();
  const key = todayKey();
  const [tasks, templates, phases, users] = await Promise.all([
    prisma.task.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { assignees: { select: { userId: true } }, project: { select: { projectCode: true } } },
    }),
    loadTemplates(prisma),
    prisma.projectPhase.findMany({ select: { projectId: true, key: true, status: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, role: { select: { key: true } } } }),
  ]);
  const byRole = (roleKey: string) => users.filter((u) => u.role.key === roleKey).map((u) => u.id);
  const phaseStatus = new Map(phases.map((p) => [`${p.projectId}:${p.key}`, p.status]));

  const input: ReminderTask[] = tasks.map((t) => {
    const tpl = templates.tasks.get(t.templateKey);
    const owner = templates.phaseByKey.get(t.phaseKey)?.ownerRoleKey;
    return {
      id: t.id,
      projectId: t.projectId,
      projectCode: t.project.projectCode,
      name: t.name,
      kind: t.kind,
      status: t.status,
      plannedEnd: t.plannedEnd,
      visible: t.visible,
      phaseActive: t.kind === "APPROVAL" || phaseStatus.get(`${t.projectId}:${t.phaseKey}`) === "ACTIVE",
      assigneeIds: t.assignees.map((a) => a.userId),
      reviewerIds: t.reviewerId ? [t.reviewerId] : tpl?.reviewerRoleKey ? byRole(tpl.reviewerRoleKey) : [],
      deptHeadIds: owner ? byRole(owner) : [],
      lastSubmittedAt: t.lastSubmittedAt,
      createdAt: t.createdAt,
    };
  });

  const reminders = computeReminders(input, { today: dateOnly(key), todayKey: key, settings, mdIds: byRole("MD") });
  const { count } = await prisma.notification.createMany({
    data: reminders.map((r) => ({ userId: r.userId, type: r.type, taskId: r.taskId, projectId: r.projectId, message: r.message, dedupeKey: r.dedupeKey })),
    skipDuplicates: true,
  });
  await setLastReminderRun({ date: key, at: now.toISOString(), sent: count });
  return { considered: tasks.length, generated: reminders.length, sent: count };
}

/** "HH:MM" in the app timezone. */
function nowHHMM(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** Called every minute by the in-process scheduler; runs once a day at the configured time. */
export async function runRemindersIfDue(now = new Date()) {
  const [settings, last] = await Promise.all([getReminderSettings(), getLastReminderRun()]);
  if (last?.date === todayKey()) return null;
  if (nowHHMM(now) < settings.time) return null;
  return runDailyReminders(now);
}
