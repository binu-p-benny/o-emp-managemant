import type { Metadata } from "next";
import Link from "next/link";
import { addBoqItem, deleteBoqItem } from "@/actions/modules";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cn, formatINR, formatINRCompact, formatNumber, percent, toNumber } from "@/lib/format";
import { projectWhere } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Costing & BoQ" };

const SECTIONS = ["Civil", "Structural", "Masonry", "Finishes", "Electrical", "Plumbing", "Interior", "Landscape", "Other"];
const UNITS = ["cum", "sqm", "sqft", "rmt", "kg", "MT", "nos", "bags", "LS"];

export default async function CostingPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requirePermission("costing.view");
  const sp = await searchParams;
  const projects = await prisma.project.findMany({
    where: await projectWhere(user),
    select: { id: true, projectCode: true, projectName: true, projectValue: true, boqItems: { select: { quantity: true, rate: true } } },
    orderBy: { projectCode: "asc" },
  });

  const summary = projects.map((p) => {
    const boq = p.boqItems.reduce((n, i) => n + toNumber(i.quantity) * toNumber(i.rate), 0);
    return { ...p, boq, value: toNumber(p.projectValue) };
  });
  const selected = summary.find((p) => p.id === sp.project) ?? null;
  const items = selected ? await prisma.boqItem.findMany({ where: { projectId: selected.id }, orderBy: [{ sortOrder: "asc" }] }) : [];
  const canEdit = can(user, "costing.edit");

  const totalValue = summary.reduce((n, p) => n + p.value, 0);
  const totalBoq = summary.reduce((n, p) => n + p.boq, 0);
  const overBudget = summary.filter((p) => p.value > 0 && p.boq > p.value).length;

  return (
    <div>
      <PageHeader title="Costing & BoQ" subtitle="Bill of quantities and estimate vs project value." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Contract value" value={formatINRCompact(totalValue)} icon="building" />
        <Stat label="BoQ estimate" value={formatINRCompact(totalBoq)} hint={`${percent(totalBoq, totalValue)}% of contract value`} icon="calculator" tone="brand" />
        <Stat label="Projects with BoQ" value={`${summary.filter((p) => p.boq > 0).length}/${summary.length}`} icon="clipboard" tone="blue" />
        <Stat label="Estimate over value" value={overBudget} icon="alert" tone={overBudget ? "red" : "gray"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Projects" className="h-fit">
          <ul className="divide-y divide-stone-100">
            {summary.map((p) => {
              const pct = percent(p.boq, p.value);
              return (
                <li key={p.id}>
                  <Link href={`/costing?project=${p.id}`} className={cn("block px-4 py-3 hover:bg-stone-50", selected?.id === p.id && "bg-brand-50")}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-semibold">{p.projectCode}</span>
                      <span className="text-stone-500">{p.boq ? formatINRCompact(p.boq) : "No BoQ"}</span>
                    </div>
                    <p className="truncate text-xs text-stone-500">{p.projectName}</p>
                    {p.value > 0 && p.boq > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={pct} tone={pct > 100 ? "red" : "brand"} />
                        <span className="w-10 text-right text-xs text-stone-500 tabular-nums">{pct}%</span>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {!selected ? (
            <Card>
              <EmptyState icon="calculator" title="Select a project">
                Pick a project to view or prepare its bill of quantities.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card
                title={`${selected.projectCode} · BoQ`}
                actions={<span className="text-sm font-semibold tabular-nums">{formatINR(selected.boq)}</span>}
              >
                {items.length === 0 ? (
                  <EmptyState icon="calculator" title="No BoQ items yet" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th>Description</th>
                          <th className="text-right">Qty</th>
                          <th>Unit</th>
                          <th className="text-right">Rate</th>
                          <th className="text-right">Amount</th>
                          {canEdit && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((i) => (
                          <tr key={i.id}>
                            <td className="whitespace-nowrap">{i.section}</td>
                            <td>
                              {i.itemCode && <span className="mr-1 font-mono text-xs text-stone-400">{i.itemCode}</span>}
                              {i.description}
                            </td>
                            <td className="text-right tabular-nums">{formatNumber(i.quantity)}</td>
                            <td>{i.unit}</td>
                            <td className="text-right tabular-nums">{formatINR(i.rate)}</td>
                            <td className="text-right font-medium tabular-nums">{formatINR(toNumber(i.quantity) * toNumber(i.rate))}</td>
                            {canEdit && (
                              <td className="text-right">
                                <form action={deleteBoqItem}>
                                  <input type="hidden" name="id" value={i.id} />
                                  <button className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete item">
                                    <Icon name="trash" />
                                  </button>
                                </form>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {selected.value > 0 && (
                  <p className={cn("border-t border-stone-100 px-4 py-2.5 text-sm", selected.boq > selected.value ? "text-red-700" : "text-stone-600")}>
                    Estimate is {percent(selected.boq, selected.value)}% of the project value ({formatINR(selected.value)}).
                  </p>
                )}
              </Card>

              {canEdit && (
                <Card title="Add BoQ item">
                  <ActionForm action={addBoqItem} className="grid gap-3 p-4 sm:grid-cols-6" submitLabel={<><Icon name="plus" /> Add item</>}>
                    <input type="hidden" name="projectId" value={selected.id} />
                    <label className="block sm:col-span-2">
                      <span className="label">Section</span>
                      <select name="section" className="input">
                        {SECTIONS.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-1">
                      <span className="label">Code</span>
                      <input name="itemCode" className="input" placeholder="C-01" />
                    </label>
                    <label className="block sm:col-span-3">
                      <span className="label">Description</span>
                      <input name="description" required className="input" placeholder="RCC M25 for roof slab" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="label">Quantity</span>
                      <input name="quantity" type="number" step="0.001" min="0" required className="input" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="label">Unit</span>
                      <select name="unit" className="input">
                        {UNITS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="label">Rate (₹)</span>
                      <input name="rate" type="number" step="0.01" min="0" required className="input" />
                    </label>
                  </ActionForm>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
