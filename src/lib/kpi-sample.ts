// Sample KPI data for every employee (owners excluded) — placeholder scores
// for the KPI page until real scores are entered or imported. Deterministic,
// so re-running gives the same numbers.

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { ratingFor, type KpiMetric } from "@/lib/kpi";

const ROLE_KPI: Record<string, string> = {
  HR_ADMIN: "Hiring & compliance",
  SALES: "Enquiries converted",
  ACCOUNTS: "Billing & payroll accuracy",
  HEAD_DESIGN: "Team delivery & reviews",
  AR_DESIGN: "Client approvals",
  INTERIOR_DESIGN: "Client approvals",
  DRAFTING: "Drawing accuracy",
  HEAD_SITE_OPS: "Projects on schedule",
  CIVIL_WORKS: "Site safety & daily logs",
  INTERIOR_WORKS: "Site safety & daily logs",
  HEAD_PROCUREMENT: "Savings on purchase orders",
  HEAD_COSTING: "Estimate accuracy",
};

const OWNER_ROLES = new Set(["MD", "MANAGING_PARTNER"]);

const REMARKS = {
  high: ["Consistently ahead of plan; strong reviews from clients.", "Reliable delivery and very few items sent back.", "Sets the pace for the team this month."],
  mid: ["Steady month; a couple of tasks slipped by a day or two.", "Good quality; on-time delivery can improve.", "Meeting expectations; one item needed rework."],
  low: ["Several tasks overdue — follow up in the weekly review.", "Attendance gaps and repeated rework; needs support.", "Below target; agree an improvement plan."],
};

/** Simple seeded PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The last `count` complete months before `today`, oldest first, as "YYYY-MM". */
export function lastMonths(today: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (count - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export function sampleKpi(email: string, roleKey: string, period: string, monthIndex: number): { totalPoints: number; rating: string; metrics: KpiMetric[]; remarks: string } {
  const base = hash(email);
  const r = rng(base + monthIndex * 7919);
  // Each person has a stable level (≈ 48–92) and a gentle trend over the months.
  const level = 48 + (base % 45);
  const trend = ((base >> 8) % 7) - 3; // −3 … +3 points a month
  const target = Math.max(30, Math.min(98, level + trend * (monthIndex - 3) + Math.round((r() - 0.5) * 8)));
  const shares: { key: string; label: string; max: number }[] = [
    { key: "attendance", label: "Attendance & punctuality", max: 20 },
    { key: "on_time", label: "Tasks delivered on time", max: 30 },
    { key: "quality", label: "Quality (first-time approval)", max: 25 },
    { key: "role", label: ROLE_KPI[roleKey] ?? "Role objectives", max: 25 },
  ];
  const metrics = shares.map((m) => {
    const pct = Math.max(0.2, Math.min(1, target / 100 + (r() - 0.5) * 0.2));
    return { ...m, points: Math.round(m.max * pct) };
  });
  const totalPoints = metrics.reduce((n, m) => n + m.points, 0);
  const band = totalPoints >= 75 ? REMARKS.high : totalPoints >= 55 ? REMARKS.mid : REMARKS.low;
  return { totalPoints, rating: ratingFor(totalPoints), metrics, remarks: band[Math.floor(r() * band.length)] };
}

/** Upserts six months of sample KPI points for every active non-owner employee. */
export async function seedSampleKpis(db: PrismaClient, today = new Date()) {
  const months = lastMonths(today, 6);
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, email: true, role: { select: { key: true } } } });
  let rows = 0;
  for (const u of users) {
    if (OWNER_ROLES.has(u.role.key)) continue;
    for (const [i, period] of months.entries()) {
      const k = sampleKpi(u.email, u.role.key, period, i);
      const data = { totalPoints: k.totalPoints, rating: k.rating, metrics: k.metrics as unknown as Prisma.InputJsonValue, remarks: k.remarks };
      await db.employeeKpi.upsert({ where: { userId_period: { userId: u.id, period } }, create: { userId: u.id, period, ...data }, update: data });
      rows++;
    }
  }
  return { rows, months };
}
