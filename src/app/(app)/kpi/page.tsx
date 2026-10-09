import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Sparkline } from "@/components/sparkline";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { RATINGS, parseMetrics, periodLabel, ratingTone } from "@/lib/kpi";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Employee KPIs" };

const METRIC_COLUMNS = [
  { key: "attendance", label: "Attendance" },
  { key: "on_time", label: "On time" },
  { key: "quality", label: "Quality" },
  { key: "role", label: "Role KPI" },
] as const;

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ period?: string; dept?: string }> }) {
  await requirePermission("kpi.view");
  const sp = await searchParams;

  const periods = (await prisma.employeeKpi.findMany({ distinct: ["period"], select: { period: true }, orderBy: { period: "desc" } })).map((p) => p.period);
  const period = sp.period && periods.includes(sp.period) ? sp.period : periods[0];
  const prevPeriod = period ? periods[periods.indexOf(period) + 1] : undefined;

  const all = period
    ? await prisma.employeeKpi.findMany({
        where: { period: { lte: period }, user: { isActive: true } },
        include: { user: { select: { id: true, name: true, designation: true, role: { select: { name: true, department: true } } } } },
        orderBy: { period: "asc" },
      })
    : [];
  const departments = [...new Set(all.map((k) => k.user.role.department))].sort();
  const dept = sp.dept && departments.includes(sp.dept) ? sp.dept : undefined;

  const current = all.filter((k) => k.period === period && (!dept || k.user.role.department === dept)).sort((a, b) => b.totalPoints - a.totalPoints);
  const prevOf = new Map(all.filter((k) => k.period === prevPeriod).map((k) => [k.userId, k.totalPoints]));
  const historyOf = (userId: string) => all.filter((k) => k.userId === userId).slice(-6).map((k) => k.totalPoints);

  const avg = current.length ? Math.round(current.reduce((n, k) => n + k.totalPoints, 0) / current.length) : 0;
  const prevAvgRows = current.map((k) => prevOf.get(k.userId)).filter((v): v is number => v !== undefined);
  const prevAvg = prevAvgRows.length ? Math.round(prevAvgRows.reduce((n, v) => n + v, 0) / prevAvgRows.length) : null;
  const top = current[0];
  const needs = current.filter((k) => k.rating === "Needs improvement").length;

  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ period, dept, ...patch })) if (v) q.set(k, v);
    return `/kpi?${q}`;
  };

  return (
    <div>
      <PageHeader title="Employee KPIs" subtitle={period ? `KPI points out of 100 for every employee · ${periodLabel(period)}` : "KPI points out of 100 for every employee"} />

      <p className="mb-4 flex items-center gap-2 rounded-lg bg-gold-50 px-4 py-2.5 text-sm text-gold-800 ring-1 ring-gold-200">
        <Icon name="alert" className="h-4 w-4 shrink-0" />
        Sample data: these points are placeholder values, not yet calculated from attendance or tasks.
      </p>

      {!period ? (
        <Card>
          <EmptyState icon="chart" title="No KPI data yet">
            Load sample scores with <code>npm run kpi:sample</code>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
              {[...periods].reverse().map((p) => (
                <Link key={p} href={qs({ period: p })} className={cn("rounded-md px-2.5 py-1 font-medium", p === period ? "bg-ink-900 text-white" : "text-stone-600 hover:bg-stone-100")}>
                  {periodLabel(p, "short")}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 text-sm">
              <Link href={qs({ dept: undefined })} className={cn("rounded-full px-3 py-1 font-medium ring-1 ring-stone-200", !dept ? "bg-ink-900 text-white ring-transparent" : "bg-white text-stone-600")}>
                All departments
              </Link>
              {departments.map((d) => (
                <Link key={d} href={qs({ dept: d })} className={cn("rounded-full px-3 py-1 font-medium ring-1 ring-stone-200", dept === d ? "bg-ink-900 text-white ring-transparent" : "bg-white text-stone-600")}>
                  {d}
                </Link>
              ))}
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Average KPI points" value={avg} hint={prevAvg !== null ? `${avg - prevAvg >= 0 ? "+" : ""}${avg - prevAvg} vs ${periodLabel(prevPeriod!, "short")}` : undefined} icon="chart" tone="brand" />
            <Stat compact label="Top performer" value={top ? top.user.name : "—"} hint={top ? `${top.totalPoints} points · ${top.user.designation ?? top.user.role.name}` : undefined} icon="check" tone="green" />
            <Stat label="Needs improvement" value={needs} hint="below 55 points" icon="alert" tone={needs ? "red" : "gray"} />
            <Stat label="Employees scored" value={current.length} hint={RATINGS.slice(0, 3).map((r) => `${current.filter((k) => k.rating === r.name).length} ${r.name.toLowerCase()}`).join(" · ")} icon="users" />
          </div>

          <Card title={`Ranking · ${periodLabel(period)}`} actions={<span className="text-xs text-stone-500">Click a name for the monthly detail</span>}>
            {current.length === 0 ? (
              <EmptyState icon="users" title="No employees in this department" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10 text-right">#</th>
                      <th>Employee</th>
                      <th>KPI points</th>
                      <th>Rating</th>
                      <th className="text-right">vs last month</th>
                      <th>6-month trend</th>
                      {METRIC_COLUMNS.map((c) => (
                        <th key={c.key} className="text-right">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.map((k, i) => {
                      const metrics = parseMetrics(k.metrics);
                      const prev = prevOf.get(k.userId);
                      const delta = prev === undefined ? null : k.totalPoints - prev;
                      return (
                        <tr key={k.id}>
                          <td className="text-right text-stone-400 tabular-nums">{i + 1}</td>
                          <td>
                            <Link href={`/kpi/${k.userId}${period ? `?period=${period}` : ""}`} className="flex items-center gap-2 hover:text-brand-600">
                              <Avatar name={k.user.name} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{k.user.name}</span>
                                <span className="block truncate text-xs text-stone-500">
                                  {k.user.designation ?? k.user.role.name} · {k.user.role.department}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="w-48">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-brand-100">
                                <div className="h-full rounded-full bg-brand-500" style={{ width: `${k.totalPoints}%` }} />
                              </div>
                              <span className="w-8 text-right font-semibold tabular-nums">{k.totalPoints}</span>
                            </div>
                          </td>
                          <td>
                            <Badge tone={ratingTone(k.rating)}>{k.rating}</Badge>
                          </td>
                          <td className={cn("text-right tabular-nums", delta === null ? "text-stone-400" : delta > 0 ? "text-emerald-700" : delta < 0 ? "text-red-600" : "text-stone-500")}>
                            {delta === null ? "—" : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "0"}
                          </td>
                          <td>
                            <Sparkline values={historyOf(k.userId)} label={`${k.user.name}: ${historyOf(k.userId).join(", ")}`} />
                          </td>
                          {METRIC_COLUMNS.map((c) => {
                            const m = metrics.find((x) => x.key === c.key);
                            return (
                              <td key={c.key} className="text-right whitespace-nowrap tabular-nums" title={m?.label}>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap gap-4 border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
              {RATINGS.map((r) => (
                <span key={r.name} className="inline-flex items-center gap-1.5">
                  <Badge tone={r.tone}>{r.name}</Badge> {r.min > 0 ? `${r.min}+ points` : "below 55"}
                </span>
              ))}
              <span>Role KPI differs by role (hover a cell to see it).</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
