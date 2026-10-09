import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";

/** Role & project options for the employee form. Non-super-admins can't hand out admin roles. */
export async function employeeFormOptions(user: CurrentUser) {
  const [roles, projects, managers] = await Promise.all([
    prisma.role.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, isSuperAdmin: true, permissions: { where: { key: "admin.roles" }, select: { id: true } } },
    }),
    prisma.project.findMany({
      where: { projectStage: { notIn: ["Completed", "Cancelled"] } },
      orderBy: { projectCode: "asc" },
      select: { id: true, projectCode: true, projectName: true },
    }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: [{ role: { sortOrder: "asc" } }, { name: "asc" }], select: { id: true, name: true, role: { select: { name: true } } } }),
  ]);
  return {
    roles: roles.filter((r) => user.isSuperAdmin || (!r.isSuperAdmin && r.permissions.length === 0)).map((r) => ({ id: r.id, label: r.name })),
    projects: projects.map((p) => ({ id: p.id, label: `${p.projectCode} — ${p.projectName}` })),
    managers: managers.map((m) => ({ id: m.id, label: `${m.name} — ${m.role.name}` })),
  };
}
