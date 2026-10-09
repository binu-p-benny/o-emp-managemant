// Day boundaries are computed in the company's timezone (APP_TIMEZONE),
// not the server's, so "today" means the same thing on site and on the server.

export const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

const DAY_MS = 86_400_000;

/** Offset of `tz` from UTC at instant `at`, in minutes (e.g. +330 for IST). */
function tzOffsetMinutes(at: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** "YYYY-MM-DD" for the given instant in the app timezone. */
export function toDateKey(at: Date, tz = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function isDateKey(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** UTC instant at which local day `dateKey` starts in the app timezone. */
export function startOfDay(dateKey: string, tz = APP_TIMEZONE): Date {
  const utcMidnight = new Date(`${dateKey}T00:00:00Z`);
  const offset = tzOffsetMinutes(utcMidnight, tz);
  return new Date(utcMidnight.getTime() - offset * 60_000);
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar-date (UTC midnight) for `@db.Date` columns. */
export function dateOnly(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`);
}

export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type PeriodView = "day" | "week" | "month";

/** Inclusive list of date keys covered by a day/week/month view anchored at `anchor`. */
export function periodDays(view: PeriodView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    // ISO week: Monday first
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(anchor, -dow);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  const [y, m] = anchor.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  return Array.from({ length: daysInMonth }, (_, i) => addDays(first, i));
}

export function shiftPeriod(view: PeriodView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + direction, 1));
  return d.toISOString().slice(0, 10);
}

/** UTC range [from, to) covering the given local date keys. */
export function rangeFor(days: string[]): { from: Date; to: Date } {
  return { from: startOfDay(days[0]), to: startOfDay(addDays(days[days.length - 1], 1)) };
}

export function formatTime(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(at);
}

export function formatDateTime(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Formats a `@db.Date` value (stored as UTC midnight). */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatDateKey(key: string, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" }): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(new Date(`${key}T00:00:00Z`));
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
