import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { dayStatus, DAY_STATUS_STYLE } from "@/lib/attendance";
import { startOfDay, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { employeeScope, userWhere } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string }> }) {
  const user = await requirePermission("employees.view.all", "employees.view.team");
  const sp = await searchParams;
  const scope = await employeeScope(user);

  const [employees, roles] = await Promise.all([
    prisma.user.findMany({
      where: {
        AND: [
          userWhere(scope),
          sp.role ? { roleId: sp.role } : {},
          sp.status === "inactive" ? { isActive: false } : sp.status === "all" ? {} : { isActive: true },
          sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, { employeeCode: { contains: sp.q, mode: "insensitive" } }] } : {},
        ],
      },
      include: {
        role: { select: { name: true, department: true, permissions: { where: { key: "attendance.self" }, select: { id: true } } } },
        mainProject: { select: { id: true, projectCode: true } },
        attendances: { where: { timestamp: { gte: startOfDay(todayKey()) } }, select: { type: true, timestamp: true, inRange: true, reviewStatus: true } },
      },
      orderBy: [{ role: { sortOrder: "asc" } }, { name: "asc" }],
    }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={scope.all ? `${employees.length} employees` : `${employees.length} people in your reporting line`}
        actions={
          can(user, "employees.manage") && (
            <Link href="/employees/new" className="btn btn-primary">
              <Icon name="plus" /> Add employee
            </Link>
          )
        }
      />
      <form action="/employees" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, email, code…" className="input w-64" />
        <select name="role" defaultValue={sp.role ?? ""} className="input w-56">
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="input w-36">
          <option value="">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-secondary">Filter</button>
      </form>

      <Card>
        {employees.length === 0 ? (
          <EmptyState icon="users" title="No employees found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Main project</th>
                  <th>Today</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const status = dayStatus(e.attendances);
                  return (
                    <tr key={e.id} className={cn(!e.isActive && "opacity-50")}>
                      <td>
                        <Link href={`/employees/${e.id}`} className="flex items-center gap-2 hover:text-brand-600">
                          <Avatar name={e.name} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{e.name}</span>
                            <span className="block truncate text-xs text-stone-500">
                              {e.employeeCode ? `${e.employeeCode} · ` : ""}
                              {e.designation ?? e.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{e.role.name}</td>
                      <td>
                        <Badge>{e.role.department}</Badge>
                      </td>
                      <td>{e.mainProject ? <Link href={`/projects/${e.mainProject.id}`} className="hover:text-brand-600">{e.mainProject.projectCode}</Link> : <span className="text-stone-400">—</span>}</td>
                      <td>
                        {!e.isActive ? (
                          <Badge tone="gray">Inactive</Badge>
                        ) : e.role.permissions.length === 0 ? (
                          <span className="text-xs text-stone-400">No check-in (owner)</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-stone-600">
                            <span className={cn("h-2 w-2 rounded-full", DAY_STATUS_STYLE[status].dot)} />
                            {DAY_STATUS_STYLE[status].label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
