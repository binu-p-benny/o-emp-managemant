"use client";

import { useActionState, useState, useTransition } from "react";
import { runRemindersNowAction, saveReminderSettingsAction } from "@/actions/workflow";
import { Icon } from "@/components/icons";
import type { ReminderSettings } from "@/lib/workflow/reminders";

export function SettingsForm({ settings, timezone, lastRun }: { settings: ReminderSettings; timezone: string; lastRun: string }) {
  const [state, action, pending] = useActionState(saveReminderSettingsAction, {});
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [running, startRun] = useTransition();

  const num = (name: string, label: string, value: number, hint: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type="number" min={0} defaultValue={value} className="input" required />
      <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>
    </label>
  );

  return (
    <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
      <label className="block">
        <span className="label">Daily reminder time</span>
        <input name="time" type="time" defaultValue={settings.time} className="input" required />
        <span className="mt-1 block text-[11px] text-stone-500">{timezone}</span>
      </label>
      {num("dueSoonDays", "Due-soon window (days)", settings.dueSoonDays, "“Due soon” when the planned end is within this many days")}
      {num("escalationHead", "Escalate to department head after (days overdue)", settings.escalationDays[0], "Overdue for more than this → the head is notified too")}
      {num("escalationMd", "Escalate to MD after (days overdue)", settings.escalationDays[1], "Overdue for more than this → the MD is notified too")}
      {num("reviewWaitingDays", "Remind reviewer after (days in review)", settings.reviewWaitingDays, "A task waiting in review longer than this")}
      {num("startWaitingDays", "Remind head about Start tasks after (days)", settings.startWaitingDays, "A pending “Start <phase>” task older than this")}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="check" /> {pending ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={running}
          onClick={() =>
            startRun(async () => {
              const r = await runRemindersNowAction();
              setRunMsg(r.message ?? r.error ?? null);
            })
          }
        >
          <Icon name="refresh" /> {running ? "Running…" : "Run reminders now"}
        </button>
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">Settings saved.</span>}
        {runMsg && <span className="text-sm text-stone-600">{runMsg}</span>}
        <span className="ml-auto text-xs text-stone-500">Last run: {lastRun}</span>
      </div>
    </form>
  );
}
