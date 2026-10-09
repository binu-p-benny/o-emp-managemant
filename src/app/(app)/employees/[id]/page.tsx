import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Legend, RangeBadge, SelfieThumb } from "@/components/attendance-badges";
import { EmployeeForm } from "@/components/employee-form";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { DAY_STATUS_STYLE, dayStatus, workedHours } from "@/lib/attendance";
import { addDays, formatDateKey, formatDateTime, rangeFor, toDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { employeeFormOptions } from "@/lib/employees";
import { cn } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { attendanceScope, employeeScope, inScope } from "@/lib/scope";
import { can, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [empScope, attScope] = await Promise.all([employeeScope(user), attendanceScope(user)]);
  if (id !== user.id && !inScope(empScope, id) && !inScope(attScope, id)) notFound();

  const emp = await prisma.user.findUnique({
    where: { id },
    include: {
      role: { select: { name: true, department: true, isSuperAdmin: true, parent: { select: { name: true } }, permissions: { where: { key: "attendance.self" }, select: { id: true } } } },
      mainProject: { select: { id: true, projectCode: true, projectName: true } },
      reportsTo: { select: { id: true, name: true } },
      projects: { include: { project: { select: { id: true, projectCode: true, projectName: true, projectStage: true } } } },
    },
  });
  if (!emp) notFound();

  const today = todayKey();
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const { from, to } = rangeFor(days);
  const tracked = emp.role.permissions.length > 0;
  const canSeeAttendance = tracked && (id === user.id || inScope(attScope, id));
  const records = canSeeAttendance
    ? await prisma.attendance.findMany({
        where: { userId: id, timestamp: { gte: from, lt: to } },
        orderBy: { timestamp: "desc" },
        include: { project: { select: { projectCode: true } } },
      })
    : [];
  const byDay = new Map<string, typeof records>();
  for (const r of records) byDay.set(toDateKey(r.timestamp), [...(byDay.get(toDateKey(r.timestamp)) ?? []), r]);
  const statuses = days.map((d) => dayStatus(byDay.get(d) ?? []));

  const canManage = can(user, "employees.manage") && (user.isSuperAdmin || !emp.role.isSuperAdmin);
  const formOptions = canManage ? await employeeFormOptions(user) : null;

  return (
    <div>
      <PageHeader back={{ href: "/employees", label: "Employees" }} title={emp.name} subtitle={`${emp.designation ?? emp.role.name} · ${emp.email}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-3 p-4">
            <Avatar name={emp.name} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{emp.name}</p>
              <p className="truncate text-sm text-stone-500">{emp.role.name}</p>
              <div className="mt-1 flex gap-1">
                <Badge>{emp.role.department}</Badge>
                {!emp.isActive && <Badge tone="red">Inactive</Badge>}
              </div>
            </div>
          </div>
          <dl className="space-y-2 border-t border-stone-100 p-4 text-sm">
            <Row label="Employee code" value={emp.employeeCode} />
            <Row label="Phone" value={emp.phone} />
            <Row label="Reports to" value={emp.reportsTo ? <Link href={`/employees/${emp.reportsTo.id}`} className="text-brand-600 hover:underline">{emp.reportsTo.name}</Link> : emp.role.parent?.name} />
            <Row
              label="Main project"
              value={emp.mainProject ? <Link href={`/projects/${emp.mainProject.id}`} className="text-brand-600 hover:underline">{emp.mainProject.projectCode}</Link> : null}
            />
            <Row label="Last sign-in" value={emp.lastLoginAt ? formatDateTime(emp.lastLoginAt) : null} />
          </dl>
          <div className="border-t border-stone-100 p-4">
            <p className="label">Assigned projects</p>
            {emp.projects.length === 0 ? (
              <p className="text-sm text-stone-500">None</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {emp.projects.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <Link href={`/projects/${m.project.id}`} className="truncate hover:text-brand-600">
                      {m.project.projectCode} <span className="text-stone-500">· {m.projectRole ?? "Member"}</span>
                    </Link>
                    <Badge>{m.project.projectStage}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {!tracked && (
            <Card>
              <EmptyState icon="clock" title="Attendance not tracked">
                The {emp.role.name} role has no check-in duty — owners oversee everyone&apos;s work and attendance instead.
              </EmptyState>
            </Card>
          )}
          {canSeeAttendance && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="On-site days (30d)" value={statuses.filter((s) => s === "on-site").length} icon="check" tone="green" />
                <Stat label="Flagged" value={records.filter((r) => !r.inRange).length} icon="flag" tone="amber" />
                <Stat label="Hours (30d)" value={workedHours(records).toFixed(0)} icon="clock" tone="blue" />
              </div>
              <Card title="Last 30 days">
                <div className="flex flex-wrap gap-1 p-4">
                  {days.map((d, i) => (
                    <span
                      key={d}
                      title={`${formatDateKey(d, { weekday: "short", day: "numeric", month: "short" })} · ${DAY_STATUS_STYLE[statuses[i]].label}`}
                      className={cn("grid h-8 w-8 place-items-center rounded text-[10px] font-semibold", DAY_STATUS_STYLE[statuses[i]].cell)}
                    >
                      {Number(d.slice(8))}
                    </span>
                  ))}
                </div>
                <Legend />
              </Card>
              <Card title="Recent entries">
                {records.length === 0 ? (
                  <EmptyState icon="clock" title="No attendance in the last 30 days" />
                ) : (
                  <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
                    {records.slice(0, 30).map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <SelfieThumb url={r.selfieUrl} alt={`${emp.name} ${r.type}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {r.type === "CHECK_IN" ? "Check-in" : "Check-out"} · {formatDateTime(r.timestamp)}
                          </p>
                          <p className="truncate text-xs text-stone-500">
                            {r.project.projectCode} · {formatDistance(r.distanceMeters)}
                            {r.locationLabel ? ` · ${r.locationLabel}` : ""}
                          </p>
                        </div>
                        <RangeBadge record={r} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}

          {canManage && formOptions && (
            <Card title="Edit employee">
              <EmployeeForm
                roles={formOptions.roles}
                projects={formOptions.projects}
                managers={formOptions.managers}
                initial={{
                  id: emp.id,
                  name: emp.name,
                  email: emp.email,
                  employeeCode: emp.employeeCode ?? "",
                  phone: emp.phone ?? "",
                  designation: emp.designation ?? "",
                  roleId: emp.roleId,
                  mainProjectId: emp.mainProjectId ?? "",
                  reportsToId: emp.reportsToId ?? "",
                  isActive: emp.isActive,
                }}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}
