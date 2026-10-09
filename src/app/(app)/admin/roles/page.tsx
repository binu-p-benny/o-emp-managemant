import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatINRCompact } from "@/lib/format";
import { PERMISSION_KEYS } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Roles & access" };

export default async function RolesPage() {
  await requirePermission("admin.roles");
  const roles = await prisma.role.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { users: true, permissions: true } } },
  });

  const children = (parentId: string | null) => roles.filter((r) => r.parentId === parentId);
  const render = (role: (typeof roles)[number], depth: number): React.ReactNode => (
    <li key={role.id}>
      <Link href={`/admin/roles/${role.id}`} className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 hover:bg-stone-50" style={{ paddingLeft: 16 + depth * 28 }}>
        {depth > 0 && <span className="h-px w-4 bg-stone-300" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            {role.name}
            {role.isSuperAdmin && <Badge tone="brand">Super admin</Badge>}
          </span>
          <span className="block truncate text-xs text-stone-500">{role.description}</span>
        </span>
        <span className="hidden text-xs text-stone-500 sm:inline">{role.department}</span>
        {role.approvalLimit && <Badge tone="blue">PO ≤ {formatINRCompact(role.approvalLimit)}</Badge>}
        <Badge>{role._count.users} users</Badge>
        <span className="w-20 text-right text-xs text-stone-500">
          {role._count.permissions}/{PERMISSION_KEYS.length} perms
        </span>
        <Icon name="chevronRight" className="h-4 w-4 text-stone-400" />
      </Link>
      {children(role.id).length > 0 && <ul>{children(role.id).map((c) => render(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <div>
      <PageHeader
        title="Roles & access"
        subtitle="The org chart drives team visibility and the purchase-order approval chain. Click a role to change its permissions."
        actions={
          <Link href="/admin/roles/new" className="btn btn-primary">
            <Icon name="plus" /> New role
          </Link>
        }
      />
      <Card title="Organisation chart">
        <ul>{children(null).map((r) => render(r, 0))}</ul>
      </Card>
    </div>
  );
}
