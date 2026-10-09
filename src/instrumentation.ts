// In-process scheduler for the daily reminder job (checks once a minute and
// runs at the time configured in Settings, default 09:00 Asia/Kolkata).
// Running several server instances is safe: notification dedupe keys make
// the job idempotent per day. Set REMINDERS_SCHEDULER=off to disable it and
// call /api/cron/reminders from an external scheduler instead.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.REMINDERS_SCHEDULER === "off") return;
  const g = globalThis as typeof globalThis & { __reminderTimer?: ReturnType<typeof setInterval> };
  if (g.__reminderTimer) return;
  const { runRemindersIfDue } = await import("@/lib/workflow/reminders-runner");
  const tick = () =>
    runRemindersIfDue()
      .then((r) => r && console.log(`[reminders] ${r.sent} notification(s) sent (${r.generated} generated, ${r.considered} open tasks)`))
      .catch((e) => console.error("[reminders]", e instanceof Error ? e.message : e));
  g.__reminderTimer = setInterval(tick, 60_000);
  setTimeout(tick, 20_000);
}
