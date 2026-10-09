import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { formatDateTime, APP_TIMEZONE } from "@/lib/dates";
import { requirePermission } from "@/lib/session";
import { getLastReminderRun, getReminderSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("admin.settings");
  const [settings, last] = await Promise.all([getReminderSettings(), getLastReminderRun()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Daily workflow reminders (in-app notifications)." />
      <Card title="Reminders & overdue alerts">
        <SettingsForm settings={settings} timezone={APP_TIMEZONE} lastRun={last ? `${formatDateTime(new Date(last.at))} · ${last.sent} sent` : "Not run yet"} />
      </Card>
      <p className="mt-4 text-xs text-stone-500">
        The job runs once a day at the time above inside the app server. To use an external scheduler instead, set <code>REMINDERS_SCHEDULER=off</code> and call{" "}
        <code>/api/cron/reminders</code> with <code>Authorization: Bearer $CRON_SECRET</code>. Notifications are de-duplicated: at most one per task, type, person and day.
      </p>
    </div>
  );
}
