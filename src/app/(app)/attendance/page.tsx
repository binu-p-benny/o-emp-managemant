import type { Metadata } from "next";
import Link from "next/link";
import { Legend, RangeBadge, SelfieThumb } from "@/components/attendance-badges";
import { Icon } from "@/components/icons";
import { PeriodNav, parsePeriod } from "@/components/period-nav";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { DAY_STATUS_STYLE, dayStatus, getOpenCheckIn, workedHours } from "@/lib/attendance";
import { formatDateKey, formatTime, periodDays, rangeFor, toDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "My attendance" };

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const user = await requirePermission("attendance.self");
  const { view, date } = parsePeriod(await searchParams, "week");
  const days = periodDays(view, date);
  const { from, to } = rangeFor(days);

  const [open, records, mainProject] = await Promise.all([
    getOpenCheckIn(user.id),
    prisma.attendance.findMany({
      where: { userId: user.id, timestamp: { gte: from, lt: to } },
      orderBy: { timestamp: "desc" },
      include: { project: { select: { projectCode: true, projectName: true } } },
    }),
    user.mainProjectId
      ? prisma.project.findUnique({ where: { id: user.mainProjectId }, select: { projectCode: true, projectName: true, attendanceRadius: true } })
      : null,
  ]);

  const byDay = new Map<string, typeof records>();
  for (const r of records) {
    const k = toDateKey(r.timestamp);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const today = todayKey();
  const pastDays = days.filter((d) => d <= today);
  const statuses = pastDays.map((d) => dayStatus(byDay.get(d) ?? []));
  const onSite = statuses.filter((s) => s === "on-site").length;
  const flagged = records.filter((r) => r.reviewStatus === "PENDING").length;
  const hours = workedHours(records);

  return (
    <div>
      <PageHeader
        title="My attendance"
        subtitle={mainProject ? `Main project: ${mainProject.projectCode} — ${mainProject.projectName} (radius ${mainProject.attendanceRadius} m)` : "No main project assigned yet"}
        actions={
          <Link href="/attendance/check-in" className={cn("btn", open ? "btn-dark" : "btn-primary")}>
            <Icon name="camera" />
            {open ? "Check out" : "Check in"}
          </Link>
        }
      />

      {open && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Checked in at <strong>{open.project.projectCode}</strong> since {formatTime(open.timestamp)}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodNav basePath="/attendance" view={view} date={date} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Days on-site" value={`${onSite}/${pastDays.length}`} icon="check" tone="green" />
        <Stat label="Hours logged" value={hours.toFixed(1)} icon="clock" tone="blue" />
        <Stat label="Pending review" value={flagged} icon="flag" tone={flagged ? "amber" : "gray"} />
        <Stat label="Entries" value={records.length} icon="camera" />
      </div>

      {view !== "day" && (
        <Card title="Calendar" className="mb-6">
          <div className="grid grid-cols-7 gap-1.5 p-4">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-stone-400 uppercase">
                {d}
              </div>
            ))}
            {Array.from({ length: (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => (
              <div key={`pad${i}`} />
            ))}
            {days.map((d) => {
              const status = d > today ? null : dayStatus(byDay.get(d) ?? []);
              return (
                <Link
                  key={d}
                  href={`/attendance?view=day&date=${d}`}
                  title={status ? DAY_STATUS_STYLE[status].label : "Upcoming"}
                  className={cn(
                    "grid aspect-square place-items-center rounded-lg text-xs font-semibold sm:aspect-auto sm:h-12",
                    status ? DAY_STATUS_STYLE[status].cell : "bg-white text-stone-300 ring-1 ring-stone-100",
                    d === today && "ring-2 ring-brand-500 ring-offset-1",
                  )}
                >
                  {Number(d.slice(8))}
                </Link>
              );
            })}
          </div>
          <Legend />
        </Card>
      )}

      <Card title="Entries">
        {records.length === 0 ? (
          <EmptyState icon="clock" title="No attendance in this period" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {records.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <SelfieThumb url={r.selfieUrl} alt={`Selfie ${r.type}`} size="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {r.type === "CHECK_IN" ? "Check-in" : "Check-out"} · {formatTime(r.timestamp)}
                    <span className="ml-2 text-xs font-normal text-stone-500">{formatDateKey(toDateKey(r.timestamp), { weekday: "short", day: "2-digit", month: "short" })}</span>
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    {r.project.projectCode} · {formatDistance(r.distanceMeters)} from site{r.locationLabel ? ` · ${r.locationLabel}` : ""}
                  </p>
                  {r.reviewNote && <p className="mt-0.5 text-xs text-stone-600 italic">Reviewer: {r.reviewNote}</p>}
                </div>
                <RangeBadge record={r} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
