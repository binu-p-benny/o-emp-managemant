import { Badge, type Tone } from "@/components/ui";
import type { DueState } from "@/lib/workflow/dates";
import { STATUS_LABEL, type PhaseStatusKey, type TaskStatusKey } from "@/lib/workflow/types";

const STATUS_TONE: Record<TaskStatusKey, Tone> = {
  NOT_STARTED: "gray",
  IN_PROGRESS: "brand",
  IN_REVIEW: "blue",
  REWORK: "amber", // orange family
  COMPLETED: "green",
};

export function StatusChip({ status }: { status: TaskStatusKey }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={status === "REWORK" ? "!bg-orange-50 !text-orange-700 !ring-orange-200" : undefined}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function DueChip({ due }: { due: DueState }) {
  if (!due) return null;
  if (due === "overdue") return <Badge tone="red">Overdue</Badge>;
  if (due === "due-today") return <Badge tone="amber">Due today</Badge>;
  return <Badge tone="amber">Due soon</Badge>;
}

export function SourceChip({ source, hasAutoRule }: { source: "AUTO" | "CUSTOM"; hasAutoRule: boolean }) {
  if (source === "AUTO") return <span className="rounded bg-brand-50 px-1 text-[10px] font-bold tracking-wide text-brand-700 ring-1 ring-brand-200">AUTO</span>;
  return (
    <span
      title={hasAutoRule ? "Overridden by hand — can be reset to the automatic date" : "Custom date set by the head"}
      className="rounded bg-gold-50 px-1 text-[10px] font-bold tracking-wide text-gold-700 ring-1 ring-gold-200"
    >
      CUSTOM
    </span>
  );
}

export function DelayBadge({ count, days }: { count: number; days: number }) {
  if (!count) return null;
  return (
    <Badge tone="red" className="!px-1.5">
      ⚑ {count} delay{count === 1 ? "" : "s"} · {days}d
    </Badge>
  );
}

const PHASE_TONE: Record<PhaseStatusKey, Tone> = { LOCKED: "gray", AWAITING_START: "amber", ACTIVE: "brand", COMPLETED: "green" };
const PHASE_LABEL: Record<PhaseStatusKey, string> = { LOCKED: "Not reached", AWAITING_START: "Waiting to start", ACTIVE: "In progress", COMPLETED: "Completed" };

export function PhaseStatusBadge({ status }: { status: PhaseStatusKey }) {
  return <Badge tone={PHASE_TONE[status]}>{PHASE_LABEL[status]}</Badge>;
}

export function fmtDay(key: string | null): string {
  if (!key) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit" }).format(new Date(`${key}T00:00:00Z`));
}

export function fmtVariance(v: number | null): { text: string; tone: string } | null {
  if (v === null) return null;
  if (v === 0) return { text: "on time", tone: "text-emerald-700" };
  return v > 0 ? { text: `+${v}d late`, tone: "text-red-600" } : { text: `${-v}d early`, tone: "text-emerald-700" };
}
