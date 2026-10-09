import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_REMINDER_SETTINGS, computeReminders, type ReminderTask } from "./reminders";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d("2026-10-09");
const ctx = { today, todayKey: "2026-10-09", settings: DEFAULT_REMINDER_SETTINGS, mdIds: ["md"] };

function t(over: Partial<ReminderTask>): ReminderTask {
  return {
    id: "t1",
    projectId: "p1",
    projectCode: "EPC 171",
    name: "S3",
    kind: "STAGE",
    status: "IN_PROGRESS",
    plannedEnd: today,
    visible: true,
    phaseActive: true,
    assigneeIds: ["arch"],
    reviewerIds: ["head"],
    deptHeadIds: ["head"],
    lastSubmittedAt: null,
    createdAt: d("2026-10-01"),
    ...over,
  };
}

const types = (rs: ReturnType<typeof computeReminders>) => rs.map((r) => `${r.type}>${r.userId}`).sort();

describe("daily reminders", () => {
  it("due soon / due today", () => {
    assert.deepEqual(types(computeReminders([t({ plannedEnd: d("2026-10-11") })], ctx)), ["DUE_SOON>arch"]);
    assert.deepEqual(types(computeReminders([t({ plannedEnd: d("2026-10-12") })], ctx)), [], "3 days out is not 'soon'");
    assert.deepEqual(types(computeReminders([t({})], ctx)), ["DUE_TODAY>arch"]);
  });

  it("escalation levels: assignee only → + department head (>3 days) → + MD (>7 days)", () => {
    assert.deepEqual(types(computeReminders([t({ plannedEnd: d("2026-10-06") })], ctx)), ["OVERDUE>arch"]); // 3 days late
    assert.deepEqual(types(computeReminders([t({ plannedEnd: d("2026-10-05") })], ctx)), ["ESCALATION>head", "OVERDUE>arch"]); // 4 days
    assert.deepEqual(types(computeReminders([t({ plannedEnd: d("2026-10-01") })], ctx)), ["ESCALATION>head", "ESCALATION>md", "OVERDUE>arch"]); // 8 days
  });

  it("skips tasks with no planned date, not yet visible, completed, or in a phase that hasn't started", () => {
    assert.deepEqual(computeReminders([t({ plannedEnd: null })], ctx), []);
    assert.deepEqual(computeReminders([t({ plannedEnd: d("2026-10-01"), visible: false })], ctx), []);
    assert.deepEqual(computeReminders([t({ plannedEnd: d("2026-10-01"), status: "COMPLETED" })], ctx), []);
    assert.deepEqual(computeReminders([t({ plannedEnd: d("2026-10-01"), phaseActive: false })], ctx), []);
  });

  it("dedupes: one notification per task, type, user and day", () => {
    const rs = computeReminders([t({ plannedEnd: d("2026-10-01"), assigneeIds: ["head"], deptHeadIds: ["head"] }), t({ plannedEnd: d("2026-10-01"), assigneeIds: ["head"] })], ctx);
    const keys = rs.map((r) => r.dedupeKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((k) => k.endsWith(":2026-10-09")));
    assert.ok(keys.includes("OVERDUE:t1:head:2026-10-09"));
  });

  it("reminds the reviewer when a review has waited more than 2 days", () => {
    const rs = computeReminders([t({ status: "IN_REVIEW", lastSubmittedAt: d("2026-10-06"), plannedEnd: d("2026-10-20") })], ctx);
    assert.deepEqual(types(rs), ["REVIEW_WAITING>head"]);
    assert.deepEqual(computeReminders([t({ status: "IN_REVIEW", lastSubmittedAt: d("2026-10-08"), plannedEnd: d("2026-10-20") })], ctx), []);
  });

  it("reminds the head about a Start task pending more than 2 days (no due/overdue noise for it)", () => {
    const start = t({ kind: "PHASE_START", assigneeIds: ["head"], createdAt: d("2026-10-05"), plannedEnd: d("2026-10-01") });
    assert.deepEqual(types(computeReminders([start], ctx)), ["START_TASK_WAITING>head"]);
    assert.deepEqual(computeReminders([{ ...start, createdAt: d("2026-10-08") }], ctx), []);
  });

  it("unassigned overdue work is chased with the department head", () => {
    assert.deepEqual(types(computeReminders([t({ assigneeIds: [], plannedEnd: d("2026-10-08") })], ctx)), ["OVERDUE>head"]);
  });
});
