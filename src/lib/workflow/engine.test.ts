import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReviewAction, planAdvance, type ReviewableTask, type Snapshot, type SnapshotPhase, type SnapshotTask } from "./engine";
import { PHASES, TASKS } from "./template-def";
import type { PhaseKey, TaskStatusKey } from "./types";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const now = new Date("2026-05-10T10:00:00Z");
const today = d("2026-05-10");

describe("review workflow", () => {
  const base: ReviewableTask = { status: "IN_PROGRESS", requiresReview: true, submittedAt: null, reworkCount: 0 };

  it("submit → IN_REVIEW and records the first submission time", () => {
    const r = applyReviewAction(base, "SUBMIT", { now, today });
    assert.ok(r.ok);
    assert.equal(r.patch.status, "IN_REVIEW");
    assert.equal(r.patch.submittedAt, now);
    assert.equal(r.review?.decision, "SUBMITTED");
  });

  it("approve → COMPLETED with actual end = approval date", () => {
    const r = applyReviewAction({ ...base, status: "IN_REVIEW", submittedAt: now }, "APPROVE", { now, today });
    assert.ok(r.ok);
    assert.equal(r.patch.status, "COMPLETED");
    assert.equal(r.patch.actualEnd, today);
  });

  it("send back requires a reason, → REWORK and bumps reworkCount", () => {
    const inReview = { ...base, status: "IN_REVIEW" as const, submittedAt: now };
    const missing = applyReviewAction(inReview, "SEND_BACK", { now, today, note: "  " });
    assert.equal(missing.ok, false);
    const r = applyReviewAction(inReview, "SEND_BACK", { now, today, note: "Dimensions missing on S3" });
    assert.ok(r.ok);
    assert.equal(r.patch.status, "REWORK");
    assert.equal(r.patch.reworkCount, 1);
    assert.equal(r.review?.note, "Dimensions missing on S3");
  });

  it("resubmitting after rework keeps the FIRST submittedAt (fair on-time measure)", () => {
    const first = new Date("2026-05-01T09:00:00Z");
    const r = applyReviewAction({ ...base, status: "REWORK", submittedAt: first, reworkCount: 1 }, "SUBMIT", { now, today });
    assert.ok(r.ok);
    assert.equal(r.patch.status, "IN_REVIEW");
    assert.equal(r.patch.submittedAt, first);
    assert.equal(r.patch.lastSubmittedAt, now);
  });

  it("rejects invalid transitions", () => {
    assert.equal(applyReviewAction(base, "APPROVE", { now, today }).ok, false);
    assert.equal(applyReviewAction({ ...base, status: "COMPLETED" }, "SUBMIT", { now, today }).ok, false);
    assert.equal(applyReviewAction(base, "COMPLETE", { now, today }).ok, false, "reviewed tasks can't skip review");
    assert.equal(applyReviewAction({ ...base, requiresReview: false }, "SUBMIT", { now, today }).ok, false);
    assert.ok(applyReviewAction({ ...base, requiresReview: false }, "COMPLETE", { now, today }).ok);
  });
});

// ─── planAdvance ────────────────────────────────────────────────────────────

function phases(statuses: Partial<Record<PhaseKey, SnapshotPhase["status"]>>): SnapshotPhase[] {
  return PHASES.map((p) => ({
    key: p.key,
    status: statuses[p.key] ?? "LOCKED",
    actualStart: statuses[p.key] === "ACTIVE" || statuses[p.key] === "COMPLETED" ? d("2026-04-01") : null,
    actualEnd: null,
    startTrigger: p.startTrigger,
    stageCount: TASKS.filter((t) => t.phaseKey === p.key && t.kind === "STAGE").length,
    approvalKey: TASKS.find((t) => t.phaseKey === p.key && t.kind === "APPROVAL")?.key ?? null,
  }));
}

function tasksOf(phase: PhaseKey, status: (key: string, i: number) => TaskStatusKey): SnapshotTask[] {
  return TASKS.filter((t) => t.phaseKey === phase && t.kind === "STAGE").map((t, i) => ({
    id: t.key,
    key: t.key,
    kind: "STAGE",
    phaseKey: phase,
    status: status(t.key, i),
    afterKey: t.afterKey ?? null,
    actualEnd: status(t.key, i) === "COMPLETED" ? d("2026-04-20") : null,
  }));
}

const snapshot = (p: SnapshotPhase[], t: SnapshotTask[]): Snapshot => ({ today, phases: p, tasks: t });

describe("phase gating", () => {
  it("activates the next stage only when the previous one is COMPLETED", () => {
    const t = tasksOf("DESIGN_2", (_, i) => (i === 0 ? "COMPLETED" : "NOT_STARTED"));
    const ops = planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "ACTIVE", DESIGN_3: "AWAITING_START" }), t));
    assert.deepEqual(ops, [{ type: "ACTIVATE", taskId: "d2_s2", actualStart: d("2026-04-20") }]);
  });

  for (const blocking of ["IN_REVIEW", "REWORK"] as const) {
    it(`nothing downstream starts while a task is ${blocking}`, () => {
      // S1 waiting on review: S2 must not activate
      const t = tasksOf("DESIGN_2", (_, i) => (i === 0 ? blocking : "NOT_STARTED"));
      assert.deepEqual(planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "ACTIVE", DESIGN_3: "AWAITING_START" }), t)), []);

      // last stage S5-B waiting: no phase completion and no design approval
      const last = tasksOf("DESIGN_2", (_, i) => (i === 5 ? blocking : "COMPLETED"));
      assert.deepEqual(planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "ACTIVE", DESIGN_3: "AWAITING_START" }), last)), []);

      // last Phase 1 task waiting: no Start Design Phase 2
      const d1 = tasksOf("DESIGN_1", (_, i) => (i === 4 ? blocking : "COMPLETED"));
      assert.deepEqual(planAdvance(snapshot(phases({ DESIGN_1: "ACTIVE" }), d1)), []);
    });
  }

  it("completing Design Phase 1 opens Start tasks for Phase 2 and (parallel) Phase 3 — not the phases themselves", () => {
    const ops = planAdvance(snapshot(phases({ DESIGN_1: "ACTIVE" }), tasksOf("DESIGN_1", () => "COMPLETED")));
    assert.deepEqual(
      ops.map((o) => o.type + ":" + ("phaseKey" in o ? o.phaseKey : "")),
      ["COMPLETE_PHASE:DESIGN_1", "OPEN_START_TASK:DESIGN_2", "OPEN_START_TASK:DESIGN_3"],
    );
  });

  it("completing Design Phase 2 creates the Approve design gate; approving it opens Start Construction Phase 1", () => {
    const d2 = tasksOf("DESIGN_2", () => "COMPLETED");
    const ops = planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "ACTIVE", DESIGN_3: "AWAITING_START" }), d2));
    assert.deepEqual(ops.map((o) => o.type), ["COMPLETE_PHASE", "CREATE_APPROVAL"]);

    const approval: SnapshotTask = { id: "appr", key: "design_approval", kind: "APPROVAL", phaseKey: "DESIGN_2", status: "COMPLETED", afterKey: null, actualEnd: today };
    const ops2 = planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "COMPLETED", DESIGN_3: "AWAITING_START" }), [...d2, approval]));
    assert.deepEqual(ops2, [{ type: "OPEN_START_TASK", phaseKey: "CONSTRUCTION_1" }]);
  });

  it("starting Construction Phase 1 makes landscaping (Phase 4) available in parallel", () => {
    const ops = planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "COMPLETED", CONSTRUCTION_1: "ACTIVE" }), []));
    assert.ok(ops.some((o) => o.type === "OPEN_START_TASK" && o.phaseKey === "CONSTRUCTION_4"));
  });

  it("does not activate stages of a phase that hasn't been started", () => {
    const t = tasksOf("DESIGN_2", () => "NOT_STARTED");
    assert.deepEqual(planAdvance(snapshot(phases({ DESIGN_1: "COMPLETED", DESIGN_2: "AWAITING_START", DESIGN_3: "AWAITING_START" }), t)), []);
  });
});
