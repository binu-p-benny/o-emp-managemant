// Single-series column chart (pure HTML/CSS, server-renderable).
// Columns ≤24px with 4px rounded caps, square at the baseline; hover tooltip per
// column; recessive hairline grid; values only on the latest and the peak column;
// a screen-reader table carries every value.

import { cn } from "@/lib/format";

export type Column = { key: string; label: string; value: number; tooltip: string; muted?: boolean };

function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => max / s <= 4) ?? pow * 10;
  return Math.ceil(max / step) * step;
}

export function ColumnChart({ columns, caption, height = 160 }: { columns: Column[]; caption: string; height?: number }) {
  const top = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const peak = columns.reduce((best, c, i) => (c.value > (columns[best]?.value ?? -1) ? i : best), 0);
  const labelled = new Set([columns.length - 1, peak]);

  return (
    <figure className="px-4 pt-3 pb-4">
      <div className="flex gap-2">
        {/* y-axis */}
        <div className="relative w-6 shrink-0 text-right text-[10px] text-stone-400 tabular-nums" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 h-px bg-stone-100" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>
          <div className="relative flex items-end" style={{ height }}>
            {columns.map((c, i) => (
              <div key={c.key} className="group relative flex h-full flex-1 items-end justify-center">
                {labelled.has(i) && c.value > 0 && (
                  <span className="absolute text-[10px] font-semibold text-stone-600 tabular-nums" style={{ bottom: `calc(${(c.value / top) * 100}% + 2px)` }}>
                    {c.value}
                  </span>
                )}
                <div
                  className={cn("w-full max-w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80", c.muted ? "bg-brand-200" : "bg-brand-500")}
                  style={{ height: `${(c.value / top) * 100}%`, minHeight: c.value > 0 ? 2 : 0, marginInline: 1 }}
                />
                {/* tooltip */}
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-48 rounded-md bg-ink-900 px-2 py-1 text-[11px] leading-snug text-white shadow-lg group-hover:block">
                  {c.tooltip}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex">
            {columns.map((c, i) => (
              <span key={c.key} className={cn("flex-1 text-center text-[10px] text-stone-400", i % 2 === 1 && columns.length > 10 && "invisible sm:visible")}>
                {c.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label}</th>
              <td>{c.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
