import Link from "next/link";
import { Icon } from "@/components/icons";
import { formatDateKey, periodDays, shiftPeriod, todayKey, type PeriodView } from "@/lib/dates";
import { cn } from "@/lib/format";

export function parsePeriod(params: { view?: string; date?: string }, fallback: PeriodView = "week"): { view: PeriodView; date: string } {
  const view: PeriodView = params.view === "day" || params.view === "week" || params.view === "month" ? params.view : fallback;
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayKey();
  return { view, date };
}

export function periodLabel(view: PeriodView, date: string): string {
  const days = periodDays(view, date);
  if (view === "day") return formatDateKey(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return formatDateKey(date, { month: "long", year: "numeric" });
  return `${formatDateKey(days[0])} – ${formatDateKey(days[6], { day: "2-digit", month: "short", year: "numeric" })}`;
}

/** Day / week / month switcher with previous/next links. Preserves other query params. */
export function PeriodNav({
  basePath,
  view,
  date,
  params = {},
}: {
  basePath: string;
  view: PeriodView;
  date: string;
  params?: Record<string, string | undefined>;
}) {
  const href = (v: PeriodView, d: string) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) if (val) q.set(k, val);
    q.set("view", v);
    q.set("date", d);
    return `${basePath}?${q.toString()}`;
  };
  const today = todayKey();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
        {(["day", "week", "month"] as const).map((v) => (
          <Link
            key={v}
            href={href(v, date)}
            className={cn("rounded-md px-3 py-1 font-medium capitalize", v === view ? "bg-ink-900 text-white" : "text-stone-600 hover:bg-stone-100")}
          >
            {v}
          </Link>
        ))}
      </div>
      <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white">
        <Link href={href(view, shiftPeriod(view, date, -1))} className="p-1.5 text-stone-600 hover:text-ink-900" aria-label="Previous">
          <Icon name="chevronLeft" />
        </Link>
        <span className="min-w-36 px-2 text-center text-sm font-medium">{periodLabel(view, date)}</span>
        <Link href={href(view, shiftPeriod(view, date, 1))} className="p-1.5 text-stone-600 hover:text-ink-900" aria-label="Next">
          <Icon name="chevronRight" />
        </Link>
      </div>
      {date !== today && (
        <Link href={href(view, today)} className="btn btn-ghost btn-sm">
          Today
        </Link>
      )}
    </div>
  );
}
