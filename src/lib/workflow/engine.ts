// Workflow state machine — pure functions, no I/O.
//
//  • applyReviewAction: submit / approve / send back / complete for one task.
//  • planAdvance: given a project snapshot, decides what happens next —
//    complete phases, create Start tasks / the design approval, activate the
//    next stage. Only COMPLETED tasks move anything downstream, so a task that
//    is IN_REVIEW or in REWORK blocks everything after it.

import type { PhaseKey, PhaseStatusKey, StartTrigger, TaskKindKey, TaskStatusKey } from "./types";

// ─── Review transitions ─────────────────────────────────────────────────────

export type ReviewAction = "SUBMIT" | "APPROVE" | "SEND_BACK" | "COMPLETE";

export type ReviewableTask = {
  status: TaskStatusKey;
  requiresReview: boolean;
  submittedAt: Date | null;
  reworkCount: number;
};

export type ReviewPatch = {
  status: TaskStatusKey;
  submittedAt?: Date;
  lastSubmittedAt?: Date;
  reworkCount?: number;
  actualEnd?: Date;
};

export type ReviewResult =
  | { ok: true; patch: ReviewPatch; review?: { decision: "SUBMITTED" | "APPROVED" | "SENT_BACK"; note: string | null } }
  | { ok: false; error: string };

export function applyReviewAction(
  task: ReviewableTask,
  action: ReviewAction,
  ctx: { now: Date; today: Date; note?: string | null },
): ReviewResult {
  const note = ctx.note?.trim() || null;
  switch (action) {
    case "SUBMIT":
      if (!task.requiresReview) return { ok: false, error: "This task doesn't need review — mark it complete instead." };
      if (task.status !== "IN_PROGRESS" && task.status !== "REWORK") return { ok: false, error: "Only an active task or one sent back for rework can be submitted." };
      return {
        ok: true,
        patch: { status: "IN_REVIEW", submittedAt: task.submittedAt ?? ctx.now, lastSubmittedAt: ctx.now },
        review: { decision: "SUBMITTED", note },
      };
    case "APPROVE":
      if (task.status !== "IN_REVIEW") return { ok: false, error: "Only a task in review can be approved." };
      return { ok: true, patch: { status: "COMPLETED", actualEnd: ctx.today }, review: { decision: "APPROVED", note } };
    case "SEND_BACK":
      if (task.status !== "IN_REVIEW") return { ok: false, error: "Only a task in review can be sent back." };
      if (!note) return { ok: false, error: "A reason is required to send work back." };
      return { ok: true, patch: { status: "REWORK", reworkCount: task.reworkCount + 1 }, review: { decision: "SENT_BACK", note } };
    case "COMPLETE":
      if (task.requiresReview) return { ok: false, error: "This task needs review — submit it for review." };
      if (task.status !== "IN_PROGRESS") return { ok: false, error: "Only an active task can be completed." };
      return { ok: true, patch: { status: "COMPLETED", actualEnd: ctx.today } };
  }
}

// ─── Advance planner ────────────────────────────────────────────────────────

export type SnapshotPhase = {
  key: PhaseKey;
  status: PhaseStatusKey;
  actualStart: Date | null;
  actualEnd: Date | null;
  startTrigger: StartTrigger;
  /** Number of STAGE tasks the template defines for this phase. */
  stageCount: number;
  /** Template key of this phase's APPROVAL task, if any (created once the phase completes). */
  approvalKey: string | null;
};

export type SnapshotTask = {
  id: string;
  key: string;
  kind: TaskKindKey;
  phaseKey: PhaseKey;
  status: TaskStatusKey;
  afterKey: string | null;
  actualEnd: Date | null;
};

export type Snapshot = { today: Date; phases: SnapshotPhase[]; tasks: SnapshotTask[] };

export type AdvanceOp =
  | { type: "COMPLETE_PHASE"; phaseKey: PhaseKey; actualEnd: Date }
  | { type: "OPEN_START_TASK"; phaseKey: PhaseKey }
  | { type: "CREATE_APPROVAL"; phaseKey: PhaseKey; templateKey: string; actualStart: Date }
  | { type: "ACTIVATE"; taskId: string; actualStart: Date };

function triggerMet(trigger: StartTrigger, phases: Map<PhaseKey, SnapshotPhase>, tasks: SnapshotTask[]): boolean {
  switch (trigger.type) {
    case "PROJECT_CREATED":
      return false; // started together with the project
    case "PHASE_COMPLETE":
      return phases.get(trigger.phase)?.status === "COMPLETED";
    case "PHASE_STARTED": {
      const s = phases.get(trigger.phase)?.status;
      return s === "ACTIVE" || s === "COMPLETED";
    }
    case "TASK_COMPLETE":
      return tasks.some((t) => t.key === trigger.taskKey && t.status === "COMPLETED");
  }
}

/**
 * Plans every consequence of the current state, iterating to a fixed point
 * (completing a phase can open the next Start task, and so on).
 */
export function planAdvance(input: Snapshot): AdvanceOp[] {
  const phases = new Map(input.phases.map((p) => [p.key, { ...p }]));
  const tasks = input.tasks.map((t) => ({ ...t }));
  const ops: AdvanceOp[] = [];

  for (let pass = 0; pass < 20; pass++) {
    const before = ops.length;
    const byKey = new Map(tasks.map((t) => [t.key, t]));

    // 1. Complete phases whose stage tasks are all approved.
    for (const p of phases.values()) {
      if (p.status !== "ACTIVE" || p.stageCount === 0) continue;
      const stages = tasks.filter((t) => t.kind === "STAGE" && t.phaseKey === p.key);
      if (stages.length < p.stageCount || stages.some((t) => t.status !== "COMPLETED")) continue;
      const actualEnd = stages.reduce<Date>((m, t) => (t.actualEnd && t.actualEnd > m ? t.actualEnd : m), p.actualStart ?? input.today);
      ops.push({ type: "COMPLETE_PHASE", phaseKey: p.key, actualEnd });
      p.status = "COMPLETED";
      p.actualEnd = actualEnd;
    }

    // 2. Design-approval style gates: created once their phase completes.
    for (const p of phases.values()) {
      if (p.status !== "COMPLETED" || !p.approvalKey || byKey.has(p.approvalKey)) continue;
      ops.push({ type: "CREATE_APPROVAL", phaseKey: p.key, templateKey: p.approvalKey, actualStart: p.actualEnd ?? input.today });
      tasks.push({ id: `new:${p.approvalKey}`, key: p.approvalKey, kind: "APPROVAL", phaseKey: p.key, status: "IN_PROGRESS", afterKey: null, actualEnd: null });
    }

    // 3. Open Start tasks for phases whose trigger has fired.
    for (const p of phases.values()) {
      if (p.status !== "LOCKED" || !triggerMet(p.startTrigger, phases, tasks)) continue;
      ops.push({ type: "OPEN_START_TASK", phaseKey: p.key });
      p.status = "AWAITING_START";
    }

    // 4. Activate stages whose phase is running and whose predecessor is approved.
    for (const t of tasks) {
      if (t.kind !== "STAGE" || t.status !== "NOT_STARTED") continue;
      const phase = phases.get(t.phaseKey);
      if (phase?.status !== "ACTIVE") continue;
      const pred = t.afterKey ? byKey.get(t.afterKey) : null;
      if (t.afterKey && pred?.status !== "COMPLETED") continue;
      const actualStart = pred?.actualEnd ?? phase.actualStart ?? input.today;
      ops.push({ type: "ACTIVATE", taskId: t.id, actualStart });
      t.status = "IN_PROGRESS";
    }

    if (ops.length === before) break;
  }
  return ops;
}

/** Can this stage be started now without an override? */
export function sequenceBlocker(
  task: { kind: TaskKindKey; afterKey: string | null; phaseKey: PhaseKey },
  phaseStatus: PhaseStatusKey | undefined,
  predecessor: { name: string; status: TaskStatusKey } | null,
): string | null {
  if (phaseStatus !== "ACTIVE") return "Its phase hasn't been started yet.";
  if (task.afterKey && predecessor && predecessor.status !== "COMPLETED") return `"${predecessor.name}" isn't approved yet.`;
  return null;
}
