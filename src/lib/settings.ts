import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/workflow/reminders";

const REMINDERS_KEY = "reminders";
const REMINDERS_LAST_RUN_KEY = "reminders.lastRun";

export async function getReminderSettings(): Promise<ReminderSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: REMINDERS_KEY } });
  const v = (row?.value ?? {}) as Partial<ReminderSettings>;
  return {
    time: typeof v.time === "string" && /^\d{2}:\d{2}$/.test(v.time) ? v.time : DEFAULT_REMINDER_SETTINGS.time,
    dueSoonDays: Number.isInteger(v.dueSoonDays) ? v.dueSoonDays! : DEFAULT_REMINDER_SETTINGS.dueSoonDays,
    escalationDays:
      Array.isArray(v.escalationDays) && v.escalationDays.length === 2 ? [Number(v.escalationDays[0]), Number(v.escalationDays[1])] : DEFAULT_REMINDER_SETTINGS.escalationDays,
    reviewWaitingDays: Number.isInteger(v.reviewWaitingDays) ? v.reviewWaitingDays! : DEFAULT_REMINDER_SETTINGS.reviewWaitingDays,
    startWaitingDays: Number.isInteger(v.startWaitingDays) ? v.startWaitingDays! : DEFAULT_REMINDER_SETTINGS.startWaitingDays,
  };
}

export async function saveReminderSettings(value: ReminderSettings, userId: string) {
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: REMINDERS_KEY }, create: { key: REMINDERS_KEY, value: json, updatedById: userId }, update: { value: json, updatedById: userId } });
}

export async function getLastReminderRun(): Promise<{ date: string; at: string; sent: number } | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: REMINDERS_LAST_RUN_KEY } });
  return (row?.value as { date: string; at: string; sent: number } | undefined) ?? null;
}

export async function setLastReminderRun(value: { date: string; at: string; sent: number }) {
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: REMINDERS_LAST_RUN_KEY }, create: { key: REMINDERS_LAST_RUN_KEY, value: json }, update: { value: json } });
}
