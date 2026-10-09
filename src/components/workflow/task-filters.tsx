import Link from "next/link";
import { cn } from "@/lib/format";
import type { TaskView } from "@/lib/workflow/queries";

export const TASK_FILTERS = [
  { key: "open", label: "All open" },
  { key: "due-soon", label: "Due soon" },
  { key: "overdue", label: "Overdue" },
  { key: "in-review", label: "In review" },
  { key: "rework", label: "Rework" },
  { key: "done", label: "Done (7 days)" },
] as const;

export type TaskFilter = (typeof TASK_FILTERS)[number]["key"];

export function parseTaskFilter(v: string | undefined): TaskFilter {
  return TASK_FILTERS.some((f) => f.key === v) ? (v as TaskFilter) : "open";
}

export function matchesFilter(t: TaskView, f: TaskFilter): boolean {
  switch (f) {
    case "open":
      return t.status !== "COMPLETED";
    case "due-soon":
      return t.status !== "COMPLETED" && (t.due === "due-soon" || t.due === "due-today");
    case "overdue":
      return t.status !== "COMPLETED" && t.due === "overdue";
    case "in-review":
      return t.status === "IN_REVIEW";
    case "rework":
      return t.status === "REWORK";
    case "done":
      return t.status === "COMPLETED";
  }
}

const TONE: Partial<Record<TaskFilter, string>> = {
  "due-soon": "data-[active=true]:bg-amber-500",
  overdue: "data-[active=true]:bg-red-600",
  "in-review": "data-[active=true]:bg-sky-600",
  rework: "data-[active=true]:bg-orange-600",
};

/** Filter chips with counts; the active one is coloured by state (amber / red / blue / orange). */
export function TaskFilterChips({ tasks, active, href }: { tasks: TaskView[]; active: TaskFilter; href: (f: TaskFilter) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TASK_FILTERS.map((f) => {
        const n = tasks.filter((t) => matchesFilter(t, f.key)).length;
        return (
          <Link
            key={f.key}
            href={href(f.key)}
            data-active={f.key === active}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium ring-1 ring-stone-200 transition-colors",
              "bg-white text-stone-600 hover:bg-stone-50 data-[active=true]:bg-ink-900 data-[active=true]:text-white data-[active=true]:ring-transparent",
              TONE[f.key],
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{n}</span>
          </Link>
        );
      })}
    </div>
  );
}
