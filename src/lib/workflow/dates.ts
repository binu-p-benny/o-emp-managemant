// Date engine — turns offset rules into planned dates. Pure functions, no I/O.
//
// Rules of the road:
//  • Only AUTO tasks are recalculated; CUSTOM dates are never overwritten.
//    (A CUSTOM task that has no planned end yet gets a provisional start from
//    its predecessor so the plan still reads left-to-right.)
//  • Chained rules (PREVIOUS / TASK_* / PHASE_END) read the *base* (unshifted)
//    dates of what they depend on; each task then adds its own shiftDays.
//    A client-side delay shift therefore adds the same N days to every task
//    downstream, without double-counting along the chain.

import type { OffsetRule, PhaseKey, TaskKindKey, TaskStatusKey } from "./types";

const DAY = 86_400_000;

export function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

export function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

export function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type EngineTask = {
  id: string;
  key: string;
  kind: TaskKindKey;
  phaseKey: PhaseKey;
  afterKey: string | null;
  rule: OffsetRule | null;
  durationDays: number | null;
  plannedSource: "AUTO" | "CUSTOM";
  plannedStart: Date | null;
  plannedEnd: Date | null;
  shiftDays: number;
  actualStart: Date | null;
  actualEnd: Date | null;
  status: TaskStatusKey;
};

export type EngineAnchors = {
  projectStart: Date;
  kickoff: Date | null;
  designApprovedAt: Date | null;
  phases: Partial<Record<PhaseKey, { actualStart: Date | null; actualEnd: Date | null }>>;
};

export type PlannedDates = { plannedStart: Date | null; plannedEnd: Date | null };

const max = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/**
 * Computes planned dates for every task. Returns a map of task id → dates for
 * the tasks whose stored values should change (AUTO tasks, and provisional
 * starts of not-yet-planned CUSTOM tasks).
 */
export function computePlannedDates(tasks: EngineTask[], anchors: EngineAnchors): Map<string, PlannedDates> {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const baseMemo = new Map<string, PlannedDates>();
  const finalMemo = new Map<string, PlannedDates>();
  const visiting = new Set<string>();

  const shift = (d: PlannedDates, days: number): PlannedDates =>
    days ? { plannedStart: d.plannedStart && addDaysUTC(d.plannedStart, days), plannedEnd: d.plannedEnd && addDaysUTC(d.plannedEnd, days) } : d;

  /** Dates without this task's own shift. */
  function base(key: string): PlannedDates {
    const cached = baseMemo.get(key);
    if (cached) return cached;
    const t = byKey.get(key);
    if (!t || visiting.has(key)) return { plannedStart: null, plannedEnd: null };
    visiting.add(key);
    const result = computeBase(t);
    visiting.delete(key);
    baseMemo.set(key, result);
    return result;
  }

  /** Dates as stored/shown (base + shift for AUTO, stored for CUSTOM). */
  function final(key: string): PlannedDates {
    const cached = finalMemo.get(key);
    if (cached) return cached;
    const t = byKey.get(key);
    if (!t) return { plannedStart: null, plannedEnd: null };
    const result = t.plannedSource === "CUSTOM" && t.plannedEnd ? { plannedStart: t.plannedStart, plannedEnd: t.plannedEnd } : shift(base(key), t.shiftDays);
    finalMemo.set(key, result);
    return result;
  }

  function predecessorEnd(t: EngineTask): Date | null {
    return t.afterKey ? base(t.afterKey).plannedEnd : null;
  }

  function startTaskPlanned(phase: PhaseKey): Date | null {
    const start = tasks.find((x) => x.kind === "PHASE_START" && x.phaseKey === phase);
    return start ? final(start.key).plannedEnd : null;
  }

  function phaseEnd(phase: PhaseKey): Date | null {
    const actual = anchors.phases[phase]?.actualEnd;
    if (actual) return actual;
    return max(tasks.filter((x) => x.kind === "STAGE" && x.phaseKey === phase).map((x) => base(x.key).plannedEnd));
  }

  function computeBase(t: EngineTask): PlannedDates {
    if (t.plannedSource === "CUSTOM") {
      if (t.plannedEnd) {
        // Stored dates already include this task's shift.
        return shift({ plannedStart: t.plannedStart, plannedEnd: t.plannedEnd }, -t.shiftDays);
      }
      // Not planned yet: provisional start from the predecessor.
      return { plannedStart: t.plannedStart ?? predecessorEnd(t), plannedEnd: null };
    }

    const rule = t.rule;
    const duration = t.durationDays ?? 0;
    if (!rule) return { plannedStart: predecessorEnd(t), plannedEnd: null };

    switch (rule.from) {
      case "PROJECT_START": {
        const end = addDaysUTC(anchors.projectStart, rule.days);
        const start = predecessorEnd(t) ?? anchors.projectStart;
        return { plannedStart: start > end ? end : start, plannedEnd: end };
      }
      case "PHASE_START": {
        const start = anchors.phases[t.phaseKey]?.actualStart ?? startTaskPlanned(t.phaseKey);
        return { plannedStart: start, plannedEnd: start && addDaysUTC(start, rule.days ?? duration) };
      }
      case "PREVIOUS": {
        const start = predecessorEnd(t);
        return { plannedStart: start, plannedEnd: start && addDaysUTC(start, rule.days ?? duration) };
      }
      case "KICKOFF": {
        if (!anchors.kickoff) return { plannedStart: null, plannedEnd: null };
        const end = addDaysUTC(anchors.kickoff, rule.days);
        const start = predecessorEnd(t) ?? anchors.kickoff;
        return { plannedStart: start > end ? end : start, plannedEnd: end };
      }
      case "TASK_END": {
        const ref = byKey.get(rule.taskKey);
        const from = ref?.actualEnd ?? (ref ? base(ref.key).plannedEnd : null);
        return { plannedStart: from, plannedEnd: from && addDaysUTC(from, rule.days) };
      }
      case "TASK_START": {
        const ref = byKey.get(rule.taskKey);
        if (!ref) return { plannedStart: null, plannedEnd: null };
        const refDates = base(ref.key);
        const start = refDates.plannedStart && addDaysUTC(refDates.plannedStart, rule.days ?? 0);
        const end = t.durationDays && start ? addDaysUTC(start, t.durationDays) : refDates.plannedEnd;
        return { plannedStart: start, plannedEnd: end };
      }
      case "PHASE_END": {
        const end = phaseEnd(rule.phase);
        return { plannedStart: end, plannedEnd: end };
      }
      case "DESIGN_APPROVED": {
        const d = anchors.designApprovedAt ? toDateOnly(anchors.designApprovedAt) : null;
        return { plannedStart: d, plannedEnd: d };
      }
    }
  }

  const out = new Map<string, PlannedDates>();
  for (const t of tasks) {
    if (t.plannedSource === "CUSTOM" && t.plannedEnd) continue; // never touch planned custom dates
    let next = t.plannedSource === "CUSTOM" ? base(t.key) : final(t.key);
    // Start tasks and approval gates are a single day ("start on …"), not a span.
    if (t.kind !== "STAGE" && t.plannedSource === "AUTO") {
      const day = t.rule?.from === "TASK_START" ? next.plannedStart : (next.plannedEnd ?? next.plannedStart);
      next = { plannedStart: day, plannedEnd: day };
    }
    out.set(t.id, next);
  }
  return out;
}

/** Tasks downstream of `key` (transitive successors and rule dependants), not yet completed. */
export function downstreamTaskIds(tasks: EngineTask[], key: string): string[] {
  const dependants = new Map<string, string[]>();
  const link = (from: string, to: string) => dependants.set(from, [...(dependants.get(from) ?? []), to]);
  for (const t of tasks) {
    if (t.afterKey) link(t.afterKey, t.key);
    if (t.rule && (t.rule.from === "TASK_END" || t.rule.from === "TASK_START")) link(t.rule.taskKey, t.key);
  }
  const seen = new Set<string>();
  const stack = [...(dependants.get(key) ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...(dependants.get(k) ?? []));
  }
  return tasks.filter((t) => seen.has(t.key) && t.status !== "COMPLETED").map((t) => t.id);
}

/** Days late (+) or early (−) versus plan; null when either side is missing. */
export function varianceDays(plannedEnd: Date | null, actualEnd: Date | null): number | null {
  if (!plannedEnd || !actualEnd) return null;
  return dayDiff(plannedEnd, actualEnd);
}

export type DueState = "overdue" | "due-today" | "due-soon" | null;

export function dueState(task: { status: string; plannedEnd: Date | null }, today: Date, dueSoonDays: number): DueState {
  if (!task.plannedEnd || task.status === "COMPLETED") return null;
  const diff = dayDiff(today, task.plannedEnd);
  if (diff < 0) return "overdue";
  if (diff === 0) return "due-today";
  if (diff <= dueSoonDays) return "due-soon";
  return null;
}

/** Delay days auto value: (actual end or today) − planned end, never negative. */
export function autoDelayDays(plannedEnd: Date | null, actualEnd: Date | null, today: Date): number {
  if (!plannedEnd) return 0;
  return Math.max(0, dayDiff(plannedEnd, actualEnd ?? today));
}
