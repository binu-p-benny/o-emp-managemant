// Employee KPI points (stored per employee per month — not calculated here).

import type { Tone } from "@/components/ui";

export type KpiMetric = { key: string; label: string; points: number; max: number };

export const RATINGS = [
  { name: "Outstanding", min: 85, tone: "green" as Tone },
  { name: "Exceeds", min: 70, tone: "blue" as Tone },
  { name: "Meets", min: 55, tone: "amber" as Tone },
  { name: "Needs improvement", min: 0, tone: "red" as Tone },
] as const;

export function ratingFor(points: number): string {
  return RATINGS.find((r) => points >= r.min)!.name;
}

export function ratingTone(rating: string): Tone {
  return RATINGS.find((r) => r.name === rating)?.tone ?? "gray";
}

export function parseMetrics(value: unknown): KpiMetric[] {
  return Array.isArray(value)
    ? value.filter((m): m is KpiMetric => !!m && typeof m === "object" && "label" in m && "points" in m && "max" in m)
    : [];
}

export function periodLabel(period: string, style: "long" | "short" = "long"): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: style === "long" ? "long" : "short", year: style === "long" ? "numeric" : "2-digit" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
