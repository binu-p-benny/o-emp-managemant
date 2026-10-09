import type { Metadata } from "next";
import Link from "next/link";
import { createPurchaseOrder } from "@/actions/modules";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn, formatINR, formatINRCompact, toNumber } from "@/lib/format";
import { ancestorRoleIds, projectWhere } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";
import { PODecisionForm } from "./po-decision-form";

export const metadata: Metadata = { title: "Purchase orders" };

const STATUS_TONE = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;
const DECISION_TONE = { APPROVED: "green", ESCALATED: "blue", REJECTED: "red" } as const;

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ status?: string; project?: string; mine?: string }> }) {
  const user = await requirePermission("procurement.view", "procurement.po.create");
  const sp = await searchParams;
  const canViewAll = can(user, "procurement.view");

  const visibleProjects = await prisma.project.findMany({
    where: canViewAll ? {} : await projectWhere(user),
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { projectCode: "asc" },
  });

  const where: Prisma.PurchaseOrderWhereInput = {
    AND: [
      canViewAll ? {} : { OR: [{ createdById: user.id }, { awaitingRoleId: user.roleId }] },
      sp.status && ["PENDING", "APPROVED", "REJECTED"].includes(sp.status) ? { status: sp.status as "PENDING" } : {},
      sp.project ? { projectId: sp.project } : {},
      sp.mine === "1" ? (user.isSuperAdmin ? { status: "PENDING" } : { status: "PENDING", awaitingRoleId: user.roleId }) : {},
    ],
  };

  const [pos, vendors, me] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        project: { select: { id: true, projectCode: true } },
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, role: { select: { name: true } } } },
        awaitingRole: { select: { name: true } },
        approvals: { orderBy: { createdAt: "asc" }, include: { approver: { select: { name: true } }, role: { select: { name: true } } } },
      },
    }),
    prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    prisma.role.findUnique({ where: { id: user.roleId }, select: { approvalLimit: true } }),
  ]);

  // Nearest role above me that can approve POs (for the "Endorse →" label and the form hint).
  const ancestors = await ancestorRoleIds(user.roleId);
  const approversAbove = await prisma.role.findMany({
    where: {
      id: { in: ancestors },
      OR: [{ isSuperAdmin: true }, { approvalLimit: { not: null }, permissions: { some: { key: "procurement.po.approve" } } }],
    },
    select: { id: true, name: true },
  });
  const nearest = approversAbove.sort((a, b) => ancestors.indexOf(a.id) - ancestors.indexOf(b.id))[0] ?? null;

  const myLimit = user.isSuperAdmin ? Infinity : me?.approvalLimit != null ? toNumber(me.approvalLimit) : -1;
  const awaitingMe = pos.filter((p) => p.status === "PENDING" && can(user, "procurement.po.approve") && (user.isSuperAdmin || p.awaitingRoleId === user.roleId) && p.createdById !== user.id);
  const pendingValue = pos.filter((p) => p.status === "PENDING").reduce((n, p) => n + toNumber(p.amount), 0);
  const approvedValue = pos.filter((p) => p.status === "APPROVED").reduce((n, p) => n + toNumber(p.amount), 0);

  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
    return `/procurement?${q}`;
  };

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        subtitle="POs route up the org chart; each approver signs off within their role's limit, larger amounts escalate."
        actions={
          canViewAll && (
            <Link href="/procurement/vendors" className="btn btn-secondary">
              <Icon name="package" /> Vendors
            </Link>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting you" value={awaitingMe.length} icon="flag" tone={awaitingMe.length ? "amber" : "gray"} href={qs({ mine: "1" })} />
        <Stat label="Pending value" value={formatINRCompact(pendingValue)} icon="clock" tone="blue" />
        <Stat label="Approved value" value={formatINRCompact(approvedValue)} icon="check" tone="green" />
        <Stat
          label="Your approval limit"
          value={myLimit === Infinity ? "Unlimited" : myLimit < 0 ? "—" : formatINRCompact(myLimit)}
          hint={myLimit < 0 ? "No approval authority" : undefined}
          icon="shield"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["", "All"],
              ["PENDING", "Pending"],
              ["APPROVED", "Approved"],
              ["REJECTED", "Rejected"],
            ].map(([v, label]) => (
              <Link
                key={label}
                href={qs({ status: v || undefined, mine: undefined })}
                className={cn("rounded-full px-3 py-1 text-sm font-medium", (sp.status ?? "") === v && !sp.mine ? "bg-ink-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200")}
              >
                {label}
              </Link>
            ))}
            <Link href={qs({ mine: "1", status: undefined })} className={cn("rounded-full px-3 py-1 text-sm font-medium", sp.mine ? "bg-brand-500 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200")}>
              Awaiting me
            </Link>
          </div>

          {pos.length === 0 ? (
            <Card>
              <EmptyState icon="truck" title="No purchase orders" />
            </Card>
          ) : (
            pos.map((po) => {
              const actionable = awaitingMe.some((a) => a.id === po.id);
              const amount = toNumber(po.amount);
              return (
                <article key={po.id} className={cn("card p-4", actionable && "ring-2 ring-amber-300")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {po.poNumber}{" "}
                        <Link href={`/projects/${po.project.id}?tab=procurement`} className="font-normal text-stone-500 hover:text-brand-600">
                          · {po.project.projectCode}
                        </Link>
                      </p>
                      <p className="text-sm text-stone-600">{po.vendor.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">{formatINR(po.amount)}</p>
                      <Badge tone={STATUS_TONE[po.status]}>{po.status === "PENDING" ? `Awaiting ${po.awaitingRole?.name ?? "approval"}` : po.status.toLowerCase()}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-line text-stone-700">{po.description}</p>
                  <ol className="mt-3 space-y-1 border-l-2 border-stone-200 pl-3 text-xs text-stone-600">
                    <li>
                      Raised by <strong>{po.createdBy.name}</strong> ({po.createdBy.role.name}) · {formatDateTime(po.createdAt)}
                    </li>
                    {po.approvals.map((a) => (
                      <li key={a.id}>
                        <Badge tone={DECISION_TONE[a.decision]} className="mr-1">
                          {a.decision.toLowerCase()}
                        </Badge>
                        {a.approver.name} ({a.role.name}) · {formatDateTime(a.createdAt)}
                        {a.note ? ` — “${a.note}”` : ""}
                      </li>
                    ))}
                  </ol>
                  {actionable && (
                    <div className="mt-3 border-t border-stone-100 pt-3">
                      <PODecisionForm id={po.id} withinLimit={amount <= myLimit} nextRole={nearest?.name ?? null} />
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {can(user, "procurement.po.create") && (
          <Card title="Raise purchase order" className="h-fit">
            <ActionForm action={createPurchaseOrder} className="grid gap-3 p-4" submitLabel={<><Icon name="plus" /> Submit for approval</>}>
              <label className="block">
                <span className="label">Project</span>
                <select name="projectId" required className="input" defaultValue={sp.project ?? user.mainProjectId ?? ""}>
                  <option value="">Select…</option>
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.projectCode} — {p.projectName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Vendor</span>
                <select name="vendorId" required className="input" defaultValue="">
                  <option value="">Select…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.category ? ` (${v.category})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Materials / services</span>
                <textarea name="description" rows={3} required className="input" placeholder="Fe500 TMT 12mm — 2.5 MT" />
              </label>
              <label className="block">
                <span className="label">Amount (₹, incl. GST)</span>
                <input name="amount" type="number" min="1" step="1" required className="input" />
              </label>
              <p className="text-xs text-stone-500">
                {user.isSuperAdmin ? "As MD, your POs are approved immediately." : `Goes to ${nearest?.name ?? "your manager"} first; amounts above their limit escalate further up.`}
              </p>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
