import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { PERMISSION_KEYS, PERMISSIONS, SELF_SERVICE_PERMISSIONS, isSelfService } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Edit role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("admin.roles");
  const { id } = await params;
  const isNew = id === "new";

  const [role, roles] = await Promise.all([
    isNew ? null : prisma.role.findUnique({ where: { id }, include: { permissions: { select: { key: true } }, users: { select: { name: true }, orderBy: { name: "asc" } } } }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!isNew && !role) notFound();

  const groups = new Map<string, { key: string; label: string }[]>();
  for (const key of PERMISSION_KEYS) {
    const p = PERMISSIONS[key];
    groups.set(p.group, [...(groups.get(p.group) ?? []), { key, label: p.label }]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: "/admin/roles", label: "Roles & access" }}
        title={role?.name ?? "New role"}
        subtitle={role ? `${role.users.length} user${role.users.length === 1 ? "" : "s"}${role.users.length ? ": " + role.users.map((u) => u.name).join(", ") : ""}` : "Add a role to the org chart"}
      />
      <Card>
        <RoleForm
          role={
            role
              ? {
                  id: role.id,
                  name: role.name,
                  department: role.department,
                  description: role.description ?? "",
                  parentId: role.parentId ?? "",
                  approvalLimit: role.approvalLimit?.toString() ?? "",
                  isSuperAdmin: role.isSuperAdmin,
                  permissions: role.isSuperAdmin
                    ? [...PERMISSION_KEYS.filter((k) => !isSelfService(k)), ...role.permissions.map((p) => p.key).filter(isSelfService)]
                    : role.permissions.map((p) => p.key),
                }
              : null
          }
          parents={roles.filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name }))}
          groups={[...groups.entries()].map(([name, perms]) => ({ name, perms }))}
          selfService={[...SELF_SERVICE_PERMISSIONS]}
        />
      </Card>
    </div>
  );
}
