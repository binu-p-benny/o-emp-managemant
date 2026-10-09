import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/column-chart";
import { Avatar, Badge, Card, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { parseMetrics, periodLabel, ratingTone } from "@/lib/kpi";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Employee KPI" };

export default async function EmployeeKpiPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  await requirePermission("kpi.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const emp = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      designation: true,
      role: { select: { name: true, department: true } },
      reportsTo: { select: { name: true } },
      kpis: { orderBy: { period: "asc" } },
    },
  });
  if (!emp) notFound();

  const kpis = emp.kpis;
  const selected = kpis.find((k) => k.period === sp.period) ?? kpis.at(-1);
  const idx = selected ? kpis.indexOf(selected) : -1;
  const prev = idx > 0 ? kpis[idx - 1] : undefined;
  const delta = selected && prev ? selected.totalPoints - prev.totalPoints : null;
  const avg = kpis.length ? Math.round(kpis.reduce((n, k) => n + k.totalPoints, 0) / kpis.length) : 0;
  const best = kpis.reduce<(typeof kpis)[number] | undefined>((b, k) => (!b || k.totalPoints > b.totalPoints ? k : b), undefined);
  const metrics = selected ? parseMetrics(selected.metrics) : [];
  const metricKeys = parseMetrics(kpis.at(-1)?.metrics).map((m) => ({ key: m.key, label: m.label }));

  return (
    <div>
      <PageHeader
        back={{ href: selected ? `/kpi?period=${selected.period}` : "/kpi", label: "Employee KPIs" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={emp.name} className="h-10 w-10 text-sm" />
            {emp.name}
          </span>
        }
        subtitle={`${emp.designation ?? emp.role.name} · ${emp.role.department}${emp.reportsTo ? ` · reports to ${emp.reportsTo.name}` : ""}`}
        actions={
          <Link href={`/employees/${emp.id}`} className="btn-secondary">
            Employee profile
          </Link>
        }
      />

      <p className="mb-4 text-xs text-stone-500">Sample data: placeholder points, not calculated from attendance or tasks.</p>

      {!selected ? (
        <Card>
          <p className="p-6 text-sm text-stone-500">No KPI points recorded for {emp.name}.</p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`KPI points · ${periodLabel(selected.period, "short")}`} value={`${selected.totalPoints}/100`} icon="chart" tone="brand" />
            <Stat compact label="Rating" value={<Badge tone={ratingTone(selected.rating)}>{selected.rating}</Badge>} icon="check" tone={ratingTone(selected.rating)} />
            <Stat
              label="vs previous month"
              value={delta === null ? "—" : delta > 0 ? `+${delta}` : `${delta}`}
              hint={prev ? `${prev.totalPoints} in ${periodLabel(prev.period, "short")}` : "No earlier month"}
              icon="refresh"
              tone={delta === null || delta === 0 ? "gray" : delta > 0 ? "green" : "red"}
            />
            <Stat label={`${kpis.length}-month average`} value={avg} hint={best ? `Best: ${best.totalPoints} in ${periodLabel(best.period, "short")}` : undefined} icon="calendar" />
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card title={`Breakdown · ${periodLabel(selected.period)}`}>
              <ul className="divide-y divide-stone-100">
                {metrics.map((m) => (
                  <li key={m.key} className="px-4 py-3">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-ink-900">{m.label}</span>
                      <span className="tabular-nums">
                        <span className="font-semibold">{m.points}</span>
                        <span className="text-stone-400"> / {m.max}</span>
                      </span>
                    </div>
                    <ProgressBar value={(m.points / m.max) * 100} />
                  </li>
                ))}
              </ul>
              {selected.remarks && (
                <div className="border-t border-stone-100 px-4 py-3 text-sm">
                  <p className="label">Remarks</p>
                  <p className="text-stone-700">{selected.remarks}</p>
                </div>
              )}
            </Card>

            <Card title="KPI points by month" actions={<span className="text-xs text-stone-500">out of 100</span>}>
              <ColumnChart
                caption={`${emp.name}: KPI points by month`}
                height={180}
                columns={kpis.map((k) => ({
                  key: k.period,
                  label: periodLabel(k.period, "short"),
                  value: k.totalPoints,
                  tooltip: `${periodLabel(k.period)}: ${k.totalPoints} points · ${k.rating}`,
                  muted: k.period !== selected.period,
                }))}
              />
            </Card>
          </div>

          <Card title="Month by month">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Points</th>
                    <th>Rating</th>
                    {metricKeys.map((m) => (
                      <th key={m.key} className="text-right whitespace-nowrap">
                        {m.label}
                      </th>
                    ))}
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {[...kpis].reverse().map((k) => {
                    const ms = parseMetrics(k.metrics);
                    return (
                      <tr key={k.id} className={cn(k.id === selected.id && "bg-brand-50/60")}>
                        <td className="whitespace-nowrap">
                          <Link href={`/kpi/${emp.id}?period=${k.period}`} className="font-medium hover:text-brand-600">
                            {periodLabel(k.period)}
                          </Link>
                        </td>
                        <td className="text-right font-semibold tabular-nums">{k.totalPoints}</td>
                        <td>
                          <Badge tone={ratingTone(k.rating)}>{k.rating}</Badge>
                        </td>
                        {metricKeys.map((mk) => {
                          const m = ms.find((x) => x.key === mk.key);
                          return (
                            <td key={mk.key} className="text-right tabular-nums">
                              {m ? (
                                <>
                                  {m.points}
                                  <span className="text-stone-400">/{m.max}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                        <td className="min-w-56 text-stone-600">{k.remarks ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
