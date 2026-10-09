import type { Metadata } from "next";
import Link from "next/link";
import { Legend, RangeBadge, SelfieThumb } from "@/components/attendance-badges";
import { Icon } from "@/components/icons";
import { PeriodNav, parsePeriod } from "@/components/period-nav";
import { Avatar, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ATTENDANCE_TRACKED, DAY_STATUS_STYLE, dayStatus, workedHours, type DayStatus } from "@/lib/attendance";
import { formatDateKey, formatTime, periodDays, rangeFor, toDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn, percent } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { attendanceScope, userWhere } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Team attendance" };

type Search = { view?: string; date?: string; project?: string; role?: string; q?: string };

export default async function TeamAttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("attendance.team.view", "attendance.all.view");
  const sp = await searchParams;
  const { view, date } = parsePeriod(sp, "day");
  const days = periodDays(view, date);
  const { from, to } = rangeFor(days);
  const scope = await attendanceScope(user);

  const [employees, roles, projects] = await Promise.all([
    prisma.user.findMany({
      where: {
        AND: [
          userWhere(scope),
          { isActive: true },
          ATTENDANCE_TRACKED,
          sp.role ? { roleId: sp.role } : {},
          sp.q ? { name: { contains: sp.q, mode: "insensitive" } } : {},
          sp.project ? { OR: [{ mainProjectId: sp.project }, { projects: { some: { projectId: sp.project } } }] } : {},
        ],
      },
      select: { id: true, name: true, designation: true, role: { select: { name: true } }, mainProject: { select: { projectCode: true } } },
      orderBy: [{ role: { sortOrder: "asc" } }, { name: "asc" }],
    }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.project.findMany({ select: { id: true, projectCode: true, projectName: true }, orderBy: { projectCode: "asc" } }),
  ]);

  const records = await prisma.attendance.findMany({
    where: {
      userId: { in: employees.map((e) => e.id) },
      timestamp: { gte: from, lt: to },
      ...(sp.project ? { projectId: sp.project } : {}),
    },
    orderBy: { timestamp: "asc" },
    include: { project: { select: { projectCode: true } } },
  });

  // userId → dateKey → records
  const grid = new Map<string, Map<string, typeof records>>();
  for (const r of records) {
    const k = toDateKey(r.timestamp);
    const row = grid.get(r.userId) ?? new Map();
    row.set(k, [...(row.get(k) ?? []), r]);
    grid.set(r.userId, row);
  }

  const today = todayKey();
  const workingDays = days.filter((d) => d <= today && new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
  let presentDays = 0;
  for (const e of employees) for (const d of workingDays) if (dayStatus(grid.get(e.id)?.get(d) ?? []) !== "absent") presentDays++;
  const checkIns = records.filter((r) => r.type === "CHECK_IN");
  const onSiteRate = percent(checkIns.filter((r) => r.inRange).length, checkIns.length);
  const pending = records.filter((r) => r.reviewStatus === "PENDING").length;
  const totalHours = workedHours(records);

  const filterParams = { project: sp.project, role: sp.role, q: sp.q };
  const exportQuery = new URLSearchParams({ from: days[0], to: days[days.length - 1], ...(sp.project ? { project: sp.project } : {}), ...(sp.role ? { role: sp.role } : {}) });

  return (
    <div>
      <PageHeader
        title="Team attendance"
        subtitle={scope.all ? "All employees" : "Employees in your reporting line"}
        actions={
          <>
            {can(user, "attendance.review") && (
              <Link href="/attendance/review" className="btn btn-secondary">
                <Icon name="flag" /> Review queue
              </Link>
            )}
            {can(user, "attendance.export") && (
              <a href={`/api/attendance/export?${exportQuery}`} className="btn btn-dark">
                <Icon name="download" /> Export CSV
              </a>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <PeriodNav basePath="/attendance/team" view={view} date={date} params={filterParams} />
        <form className="flex flex-wrap gap-2" action="/attendance/team">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={date} />
          <input name="q" defaultValue={sp.q} placeholder="Search name…" className="input w-40" />
          <select name="project" defaultValue={sp.project ?? ""} className="input w-44">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectCode}
              </option>
            ))}
          </select>
          <select name="role" defaultValue={sp.role ?? ""} className="input w-48">
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary">Filter</button>
        </form>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Employees" value={employees.length} icon="users" />
        <Stat
          label="Attendance rate"
          value={`${percent(presentDays, employees.length * workingDays.length)}%`}
          hint={`${presentDays} present days · Mon–Sat`}
          icon="check"
          tone="green"
        />
        <Stat label="On-site check-ins" value={`${onSiteRate}%`} hint={`${checkIns.length} check-ins`} icon="pin" tone="brand" />
        <Stat label="Pending review" value={pending} hint={`${totalHours.toFixed(0)} h logged`} icon="flag" tone={pending ? "amber" : "gray"} href="/attendance/review" />
      </div>

      {employees.length === 0 ? (
        <Card>
          <EmptyState icon="users" title="No employees match these filters" />
        </Card>
      ) : view === "day" ? (
        <Card title={`Attendance · ${formatDateKey(date, { weekday: "long", day: "numeric", month: "long" })}`}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Project</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Hours</th>
                  <th>Location</th>
                  <th>Selfies</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const recs = grid.get(e.id)?.get(date) ?? [];
                  const firstIn = recs.find((r) => r.type === "CHECK_IN");
                  const lastOut = [...recs].reverse().find((r) => r.type === "CHECK_OUT");
                  return (
                    <tr key={e.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={e.name} />
                          <div className="min-w-0">
                            <Link href={`/employees/${e.id}`} className="block truncate font-medium hover:text-brand-600">
                              {e.name}
                            </Link>
                            <span className="block truncate text-xs text-stone-500">{e.designation ?? e.role.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{firstIn?.project.projectCode ?? <span className="text-stone-400">{e.mainProject?.projectCode ?? "—"}</span>}</td>
                      <td className="whitespace-nowrap tabular-nums">{firstIn ? formatTime(firstIn.timestamp) : <span className="text-stone-400">—</span>}</td>
                      <td className="whitespace-nowrap tabular-nums">{lastOut ? formatTime(lastOut.timestamp) : <span className="text-stone-400">—</span>}</td>
                      <td className="tabular-nums">{recs.length ? workedHours(recs).toFixed(1) : "—"}</td>
                      <td>{firstIn ? <RangeBadge record={firstIn} /> : <span className="text-xs text-stone-400">No check-in</span>}</td>
                      <td>
                        <div className="flex gap-1">
                          {recs.slice(0, 4).map((r) => (
                            <SelfieThumb key={r.id} url={r.selfieUrl} alt={`${e.name} ${r.type}`} size="h-8 w-8" />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title={view === "week" ? "Weekly register" : "Monthly register"}>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-44 border-b border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs font-semibold text-stone-500 uppercase">Employee</th>
                  {days.map((d) => (
                    <th key={d} className={cn("border-b border-stone-200 bg-stone-50 px-0.5 py-2 text-center text-[10px] font-semibold text-stone-500", d === today && "text-brand-600")}>
                      {formatDateKey(d, { weekday: "narrow" })}
                      <br />
                      {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="border-b border-stone-200 bg-stone-50 px-2 py-2 text-xs font-semibold text-stone-500 uppercase">Days</th>
                  <th className="border-b border-stone-200 bg-stone-50 px-2 py-2 text-xs font-semibold text-stone-500 uppercase">Hours</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const row = grid.get(e.id);
                  const statuses: (DayStatus | null)[] = days.map((d) => (d > today ? null : dayStatus(row?.get(d) ?? [])));
                  const userRecs = [...(row?.values() ?? [])].flat();
                  return (
                    <tr key={e.id}>
                      <td className="sticky left-0 z-10 border-b border-stone-100 bg-white px-3 py-1.5">
                        <Link href={`/employees/${e.id}`} className="block truncate font-medium hover:text-brand-600">
                          {e.name}
                        </Link>
                        <span className="block truncate text-xs text-stone-500">{e.role.name}</span>
                      </td>
                      {days.map((d, i) => {
                        const s = statuses[i];
                        return (
                          <td key={d} className="border-b border-stone-100 px-0.5 py-1.5 text-center">
                            <Link
                              href={`/attendance/team?view=day&date=${d}`}
                              title={`${formatDateKey(d)} · ${s ? DAY_STATUS_STYLE[s].label : "Upcoming"}`}
                              className={cn("mx-auto block h-6 w-6 rounded", s ? DAY_STATUS_STYLE[s].cell : "bg-white ring-1 ring-stone-100", view === "month" && "h-5 w-5")}
                            />
                          </td>
                        );
                      })}
                      <td className="border-b border-stone-100 px-2 text-center font-semibold tabular-nums">{statuses.filter((s) => s && s !== "absent").length}</td>
                      <td className="border-b border-stone-100 px-2 text-center tabular-nums">{workedHours(userRecs).toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Legend />
        </Card>
      )}

      {view === "day" && records.length > 0 && (
        <Card title="All entries" className="mt-6">
          <ul className="divide-y divide-stone-100">
            {[...records].reverse().map((r) => {
              const e = employees.find((x) => x.id === r.userId)!;
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <SelfieThumb url={r.selfieUrl} alt={`${e.name} ${r.type}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {e.name} · {r.type === "CHECK_IN" ? "in" : "out"} {formatTime(r.timestamp)}
                    </p>
                    <p className="truncate text-xs text-stone-500">
                      {r.project.projectCode} · {formatDistance(r.distanceMeters)} from site{r.locationLabel ? ` · ${r.locationLabel}` : ""}
                    </p>
                  </div>
                  <RangeBadge record={r} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
