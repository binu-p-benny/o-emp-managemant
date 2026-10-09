import Link from "next/link";
import { RangeBadge } from "@/components/attendance-badges";
import { ColumnChart } from "@/components/column-chart";
import { Icon } from "@/components/icons";
import { DepartmentIllustration, themeForDepartment } from "@/components/illustrations";
import { Badge, Card, EmptyState, ProgressBar, Stat } from "@/components/ui";
import { ATTENDANCE_TRACKED, dayStatus, getOpenCheckIn, reviewableWhere, workedHours } from "@/lib/attendance";
import { addDays, dateOnly, formatDate, formatDateKey, formatDateTime, formatTime, periodDays, rangeFor, startOfDay, toDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { formatINR, formatINRCompact, percent } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { NON_WORKFLOW_CATEGORY, STAGE_TONE } from "@/lib/project-schema";
import { attendanceScope, projectWhere } from "@/lib/scope";
import { can, requireUser, type CurrentUser } from "@/lib/session";
import { PHASES } from "@/lib/workflow/template-def";
import type { PhaseKey } from "@/lib/workflow/types";

export default async function DashboardPage() {
  const user = await requireUser();
  const today = todayKey();
  const seesTeam = can(user, "attendance.team.view", "attendance.all.view");

  return (
    <div className="space-y-6">
      <Hero user={user} today={today} />
      {seesTeam ? <TeamAttendanceSection user={user} today={today} /> : can(user, "attendance.self") ? <MyAttendanceSection user={user} today={today} /> : null}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProjectsSection user={user} />
        </div>
        <AttentionSection user={user} />
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

async function Hero({ user, today }: { user: CurrentUser; today: string }) {
  const open = can(user, "attendance.self") ? await getOpenCheckIn(user.id) : null;
  const todays = can(user, "attendance.self")
    ? await prisma.attendance.findFirst({ where: { userId: user.id, type: "CHECK_IN", timestamp: { gte: startOfDay(today) } }, orderBy: { timestamp: "asc" } })
    : null;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand-700 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#d8bc80_1px,transparent_1px),linear-gradient(90deg,#d8bc80_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative grid items-center gap-4 p-5 sm:p-6 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm text-gold-300">{formatDateKey(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">
            {greeting()}, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {user.designation?.includes(user.roleName) ? user.designation : [user.roleName, user.designation].filter(Boolean).join(" · ")}
          </p>
          {can(user, "attendance.self") ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href="/attendance/check-in" className={open ? "btn bg-white text-ink-900 hover:bg-stone-100" : "btn bg-gold-500 text-white hover:bg-gold-600"}>
                <Icon name="camera" />
                {open ? "Check out" : "Check in"}
              </Link>
              <span className="text-sm text-stone-300">
                {open
                  ? `Checked in at ${open.project.projectCode} since ${formatTime(open.timestamp)}`
                  : todays
                    ? `Checked in today at ${formatTime(todays.timestamp)}`
                    : "You haven't checked in today."}
              </span>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-white/70">Owner&apos;s view — everyone&apos;s work and attendance at a glance.</span>
              {can(user, "attendance.team.view", "attendance.all.view") && (
                <Link href="/attendance/team?view=day" className="btn btn-sm bg-gold-500 text-white hover:bg-gold-600">
                  <Icon name="calendar" className="h-3.5 w-3.5" /> Today&apos;s attendance
                </Link>
              )}
              <Link href="/projects" className="btn btn-sm bg-white/10 text-white hover:bg-white/20">
                <Icon name="building" className="h-3.5 w-3.5" /> All projects
              </Link>
            </div>
          )}
        </div>
        <div className="hidden w-72 rounded-xl bg-gradient-to-b from-gold-50 to-stone-50 p-2 ring-1 ring-gold-300/40 md:block">
          <DepartmentIllustration theme={themeForDepartment(user.department)} className="h-40 w-full" />
        </div>
      </div>
    </section>
  );
}

async function TeamAttendanceSection({ user, today }: { user: CurrentUser; today: string }) {
  const scope = await attendanceScope(user);
  const scopeWhere = scope.all ? {} : { userId: { in: scope.userIds } };
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const { from, to } = rangeFor(days);

  const [employeeCount, records, pendingCount] = await Promise.all([
    prisma.user.count({ where: { isActive: true, ...ATTENDANCE_TRACKED, ...(scope.all ? {} : { id: { in: scope.userIds } }) } }),
    prisma.attendance.findMany({
      where: { ...scopeWhere, timestamp: { gte: from, lt: to } },
      select: { id: true, userId: true, type: true, timestamp: true, inRange: true, reviewStatus: true, checkInId: true },
    }),
    can(user, "attendance.review") ? reviewableWhere(user).then((where) => prisma.attendance.count({ where })) : Promise.resolve(0),
  ]);

  const byDayUser = new Map<string, Map<string, typeof records>>();
  for (const r of records) {
    const d = toDateKey(r.timestamp);
    const m = byDayUser.get(d) ?? new Map();
    m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    byDayUser.set(d, m);
  }
  const presentOn = (d: string) => [...(byDayUser.get(d)?.values() ?? [])].filter((recs) => dayStatus(recs) !== "absent").length;
  const onSiteOn = (d: string) => [...(byDayUser.get(d)?.values() ?? [])].filter((recs) => dayStatus(recs) === "on-site").length;

  const presentToday = presentOn(today);
  const todayCheckIns = records.filter((r) => r.type === "CHECK_IN" && toDateKey(r.timestamp) === today);
  const weekDays = periodDays("week", today).filter((d) => d <= today);
  const weekRecords = records.filter((r) => weekDays.includes(toDateKey(r.timestamp)));

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="grid grid-cols-2 content-start gap-3 xl:col-span-1">
        <Stat label="Present today" value={`${presentToday}/${employeeCount}`} hint={`${percent(presentToday, employeeCount)}% attendance`} icon="users" tone="green" href="/attendance/team?view=day" />
        <Stat
          label="On-site check-ins today"
          value={`${percent(todayCheckIns.filter((r) => r.inRange).length, todayCheckIns.length)}%`}
          hint={`${todayCheckIns.length} check-ins`}
          icon="pin"
          tone="brand"
        />
        <Stat label="Awaiting review" value={pendingCount} hint="out-of-range entries" icon="flag" tone={pendingCount ? "amber" : "gray"} href="/attendance/review" />
        <Stat label="Hours this week" value={Math.round(workedHours(weekRecords)).toLocaleString("en-IN")} hint={scope.all ? "all employees" : "your team"} icon="clock" tone="blue" />
      </div>
      <Card title="On-site headcount · last 14 days" className="xl:col-span-2" actions={<Link href="/attendance/team?view=week" className="text-xs font-semibold text-brand-600 hover:underline">Register →</Link>}>
        <ColumnChart
          caption="Employees verified on-site per day, last 14 days"
          columns={days.map((d) => ({
            key: d,
            label: formatDateKey(d, { day: "numeric" }),
            value: onSiteOn(d),
            muted: new Date(`${d}T00:00:00Z`).getUTCDay() === 0,
            tooltip: `${formatDateKey(d, { weekday: "short", day: "numeric", month: "short" })}: ${onSiteOn(d)} on-site · ${presentOn(d) - onSiteOn(d)} flagged/other`,
          }))}
        />
      </Card>
    </div>
  );
}

async function MyAttendanceSection({ user, today }: { user: CurrentUser; today: string }) {
  const month = periodDays("month", today).filter((d) => d <= today);
  const { from, to } = rangeFor(month);
  const records = await prisma.attendance.findMany({
    where: { userId: user.id, timestamp: { gte: from, lt: to } },
    orderBy: { timestamp: "desc" },
    include: { project: { select: { projectCode: true } } },
  });
  const byDay = new Map<string, typeof records>();
  for (const r of records) byDay.set(toDateKey(r.timestamp), [...(byDay.get(toDateKey(r.timestamp)) ?? []), r]);
  const statuses = month.map((d) => dayStatus(byDay.get(d) ?? []));
  const working = month.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).length;
  const onSite = statuses.filter((s) => s === "on-site").length;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="grid grid-cols-2 content-start gap-3">
        <Stat label="Days on-site this month" value={`${onSite}/${working}`} hint="Mon–Sat" icon="check" tone="green" href="/attendance?view=month" />
        <Stat label="Hours this month" value={workedHours(records).toFixed(1)} icon="clock" tone="blue" />
        <Stat label="Pending review" value={records.filter((r) => r.reviewStatus === "PENDING").length} icon="flag" tone="amber" />
        <Stat label="Rejected" value={records.filter((r) => r.reviewStatus === "REJECTED").length} icon="x" tone="red" />
      </div>
      <Card title="Recent check-ins" className="xl:col-span-2" actions={<Link href="/attendance" className="text-xs font-semibold text-brand-600 hover:underline">All →</Link>}>
        {records.length === 0 ? (
          <EmptyState icon="clock" title="No attendance this month yet" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {records.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-stone-500">{formatDateKey(toDateKey(r.timestamp), { weekday: "short", day: "2-digit", month: "short" })}</span>
                <span className="flex-1 truncate">
                  {r.type === "CHECK_IN" ? "In" : "Out"} {formatTime(r.timestamp)} · {r.project.projectCode} · {formatDistance(r.distanceMeters)}
                </span>
                <RangeBadge record={r} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function ProjectsSection({ user }: { user: CurrentUser }) {
  const where = await projectWhere(user);
  const projects = await prisma.project.findMany({
    where: { AND: [where, { projectStage: { notIn: ["Completed", "Cancelled"] }, projectCategory: { not: NON_WORKFLOW_CATEGORY } }] },
    orderBy: { startDate: "desc" },
    take: 8,
    include: {
      tasks: { where: { kind: "STAGE" }, select: { status: true, name: true, phaseKey: true, plannedEnd: true }, orderBy: { order: "asc" } },
      phases: { select: { key: true, status: true } },
    },
  });
  const [activeCount, portfolio, stageTotal] = await Promise.all([
    prisma.project.count({ where: { AND: [where, { projectStage: { notIn: ["Completed", "Cancelled"] }, projectCategory: { not: NON_WORKFLOW_CATEGORY } }] } }),
    can(user, "projects.view.all", "costing.view") ? prisma.project.aggregate({ where: { AND: [where, { projectStage: { notIn: ["Cancelled"] } }] }, _sum: { projectValue: true } }) : null,
    prisma.taskTemplate.count({ where: { kind: "STAGE" } }),
  ]);
  const todayDate = dateOnly(todayKey());
  const phaseName = new Map(PHASES.map((p) => [p.key, p.shortName]));

  return (
    <Card
      title={`Active projects (${activeCount})`}
      actions={
        <span className="flex items-center gap-3">
          {portfolio?._sum.projectValue && <span className="hidden text-xs text-stone-500 sm:inline">Portfolio {formatINRCompact(portfolio._sum.projectValue)}</span>}
          <Link href="/projects" className="text-xs font-semibold text-brand-600 hover:underline">
            All projects →
          </Link>
        </span>
      }
    >
      {projects.length === 0 ? (
        <EmptyState icon="building" title="No active projects assigned to you" />
      ) : (
        <ul className="divide-y divide-stone-100">
          {projects.map((p) => {
            const activePhases = new Set(p.phases.filter((ph) => ph.status === "ACTIVE").map((ph) => ph.key));
            const done = p.tasks.filter((s) => s.status === "COMPLETED").length;
            const current = p.tasks.find((s) => s.status !== "COMPLETED" && s.status !== "NOT_STARTED" && activePhases.has(s.phaseKey));
            const waiting = p.phases.find((ph) => ph.status === "AWAITING_START");
            const overdue = p.tasks.filter((s) => s.status !== "COMPLETED" && activePhases.has(s.phaseKey) && s.plannedEnd && s.plannedEnd < todayDate).length;
            const pct = percent(done, stageTotal);
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="grid gap-2 px-4 py-3 hover:bg-stone-50 sm:grid-cols-[1fr_200px] sm:items-center">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      {p.projectCode}
                      <Badge tone={STAGE_TONE[p.projectStage] ?? "gray"}>{p.projectStage}</Badge>
                      {overdue > 0 && (
                        <Badge tone="red">
                          <Icon name="alert" className="h-3 w-3" /> {overdue} overdue
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-sm text-stone-500">{p.projectName}</p>
                    {current ? (
                      <p className="truncate text-xs text-stone-500">
                        {phaseName.get(current.phaseKey as PhaseKey)} · {current.name}
                      </p>
                    ) : waiting ? (
                      <p className="truncate text-xs text-gold-700">Waiting to start {phaseName.get(waiting.key as PhaseKey)}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={pct} />
                    <span className="w-9 text-right text-xs text-stone-500 tabular-nums">{pct}%</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

async function AttentionSection({ user }: { user: CurrentUser }) {
  const items: { href: string; title: string; detail: string; tone: "amber" | "red" | "blue"; icon: "flag" | "alert" | "truck" }[] = [];

  if (can(user, "attendance.review")) {
    const pending = await prisma.attendance.findMany({
      where: await reviewableWhere(user),
      orderBy: { timestamp: "desc" },
      take: 4,
      include: { user: { select: { name: true } }, project: { select: { projectCode: true } } },
    });
    for (const a of pending)
      items.push({ href: "/attendance/review", title: `${a.user.name} out of range`, detail: `${a.project.projectCode} · ${formatDistance(a.distanceMeters)} · ${formatDateTime(a.timestamp)}`, tone: "amber", icon: "flag" });
  }

  if (can(user, "procurement.po.approve")) {
    const pos = await prisma.purchaseOrder.findMany({
      where: { status: "PENDING", ...(user.isSuperAdmin ? {} : { awaitingRoleId: user.roleId }) },
      orderBy: { createdAt: "asc" },
      take: 4,
      include: { project: { select: { projectCode: true } }, vendor: { select: { name: true } } },
    });
    for (const po of pos) items.push({ href: "/procurement?status=PENDING", title: `Approve ${po.poNumber} · ${formatINR(po.amount)}`, detail: `${po.project.projectCode} · ${po.vendor.name}`, tone: "blue", icon: "truck" });
  }

  // Workflow: my Start tasks / rework / overdue work, then overdue work across visible projects.
  const today = dateOnly(todayKey());
  const mine = await prisma.task.findMany({
    where: {
      visible: true,
      assignees: { some: { userId: user.id } },
      OR: [{ kind: "PHASE_START", status: "NOT_STARTED" }, { status: "REWORK" }, { status: { in: ["IN_PROGRESS", "REWORK"] }, plannedEnd: { lt: today } }],
    },
    orderBy: [{ plannedEnd: "asc" }],
    take: 5,
    include: { project: { select: { id: true, projectCode: true } } },
  });
  for (const t of mine)
    items.push({
      href: `/projects/${t.project.id}?tab=workflow#task-${t.id}`,
      title: `${t.project.projectCode}: ${t.name}`,
      detail: t.kind === "PHASE_START" ? "Waiting for you to start the phase" : t.status === "REWORK" ? "Sent back for rework" : `Overdue since ${formatDate(t.plannedEnd)}`,
      tone: t.kind === "PHASE_START" ? "blue" : "red",
      icon: t.kind === "PHASE_START" ? "flag" : "alert",
    });

  const where = await projectWhere(user);
  const overdue = await prisma.task.findMany({
    where: {
      project: { AND: [where, { projectStage: { notIn: ["Completed", "Cancelled", "On Hold"] } }] },
      kind: "STAGE",
      visible: true,
      status: { in: ["IN_PROGRESS", "IN_REVIEW", "REWORK"] },
      plannedEnd: { lt: today },
      id: { notIn: mine.map((t) => t.id) },
    },
    orderBy: { plannedEnd: "asc" },
    take: 5,
    include: { project: { select: { id: true, projectCode: true } }, assignees: { include: { user: { select: { name: true } } } } },
  });
  for (const s of overdue)
    items.push({
      href: `/projects/${s.project.id}?tab=workflow#task-${s.id}`,
      title: `${s.project.projectCode}: ${s.name}`,
      detail: `Planned by ${formatDate(s.plannedEnd)} · ${s.assignees.map((a) => a.user.name).join(", ") || "unassigned"}`,
      tone: "red",
      icon: "alert",
    });

  const toneCls = { amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600", blue: "bg-sky-50 text-sky-600" };
  return (
    <Card title="Needs attention">
      {items.length === 0 ? (
        <EmptyState icon="check" title="Nothing needs your attention" />
      ) : (
        <ul className="divide-y divide-stone-100">
          {items.slice(0, 10).map((it, i) => (
            <li key={i}>
              <Link href={it.href} className="flex items-start gap-3 px-4 py-3 hover:bg-stone-50">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneCls[it.tone]}`}>
                  <Icon name={it.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{it.title}</span>
                  <span className="block truncate text-xs text-stone-500">{it.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
