import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysUTC, computePlannedDates, downstreamTaskIds, dueState, type EngineAnchors, type EngineTask } from "./dates";
import { TASKS } from "./template-def";
import type { OffsetRule, PhaseKey } from "./types";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);

function task(key: string, over: Partial<EngineTask> = {}): EngineTask {
  const def = TASKS.find((t) => t.key === key);
  return {
    id: key,
    key,
    kind: def?.kind ?? "STAGE",
    phaseKey: (def?.phaseKey ?? "DESIGN_1") as PhaseKey,
    afterKey: def?.afterKey ?? null,
    rule: (def?.offsetRule ?? null) as OffsetRule | null,
    durationDays: def?.durationDays ?? null,
    plannedSource: def?.offsetRule ? "AUTO" : "CUSTOM",
    plannedStart: null,
    plannedEnd: null,
    shiftDays: 0,
    actualStart: null,
    actualEnd: null,
    status: "NOT_STARTED",
    ...over,
  };
}

const anchors = (over: Partial<EngineAnchors> = {}): EngineAnchors => ({
  projectStart: d("2026-01-01"),
  kickoff: null,
  designApprovedAt: null,
  phases: {},
  ...over,
});

describe("date engine — Design Phase 1 offsets", () => {
  const keys = ["d1_site_visit", "d1_concept_plan", "d1_final_plan", "d1_elevation_start", "d1_elevation_confirm"];
  it("derives day 0 / +10 / +15 / +22 / +30 from the project start", () => {
    const out = computePlannedDates(keys.map((k) => task(k)), anchors());
    assert.deepEqual(
      keys.map((k) => iso(out.get(k)!.plannedEnd)),
      ["2026-01-01", "2026-01-11", "2026-01-16", "2026-01-23", "2026-01-31"],
    );
    // each stage starts when the previous one is planned to end
    assert.equal(iso(out.get("d1_concept_plan")!.plannedStart), "2026-01-01");
    assert.equal(iso(out.get("d1_elevation_confirm")!.plannedStart), "2026-01-23");
  });

  it("recalculates AUTO dates when the project start (anchor) changes", () => {
    const out = computePlannedDates(keys.map((k) => task(k)), anchors({ projectStart: d("2026-03-01") }));
    assert.equal(iso(out.get("d1_final_plan")!.plannedEnd), "2026-03-16");
  });
});

describe("date engine — AUTO vs CUSTOM", () => {
  it("never overwrites a CUSTOM date, and successors chain off it", () => {
    const tasks = [
      task("d2_s1", { plannedSource: "AUTO" }),
      task("d2_s2", { plannedSource: "CUSTOM", plannedStart: d("2026-02-10"), plannedEnd: d("2026-02-20") }),
      task("d2_s3"),
    ];
    const out = computePlannedDates(tasks, anchors({ phases: { DESIGN_2: { actualStart: d("2026-02-01"), actualEnd: null } } }));
    assert.equal(out.has("d2_s2"), false, "custom task is left untouched");
    assert.equal(iso(out.get("d2_s1")!.plannedEnd), "2026-02-05"); // 4 days
    assert.equal(iso(out.get("d2_s3")!.plannedStart), "2026-02-20"); // follows custom S2
    assert.equal(iso(out.get("d2_s3")!.plannedEnd), "2026-02-22"); // 2 days
  });

  it("Design Phase 2 runs sequentially from the phase's actual start", () => {
    const keys = ["d2_s1", "d2_s2", "d2_s3", "d2_s4", "d2_s5a", "d2_s5b"];
    const out = computePlannedDates(keys.map((k) => task(k)), anchors({ phases: { DESIGN_2: { actualStart: d("2026-02-01"), actualEnd: null } } }));
    assert.deepEqual(
      keys.map((k) => iso(out.get(k)!.plannedEnd)),
      ["2026-02-05", "2026-02-09", "2026-02-11", "2026-02-14", "2026-02-18", "2026-02-21"],
    );
  });

  it("gives an unplanned CUSTOM task a provisional start but no end", () => {
    const out = computePlannedDates([task("c_plinth_beam"), task("c_gf_brickwork")], anchors());
    // plinth has no excavation in this set → nothing to chain from
    assert.equal(out.get("c_gf_brickwork")!.plannedEnd, null);
  });
});

describe("date engine — construction milestones & plinth beam offset", () => {
  const construction = () => [task("c_preliminary"), task("c_excavation"), task("c_plinth_beam"), task("c_gf_brickwork")];

  it("has no construction dates until kickoff is set", () => {
    const out = computePlannedDates(construction(), anchors());
    assert.equal(out.get("c_preliminary")!.plannedEnd, null);
  });

  it("derives preliminary (+7), excavation (by +10) and plinth (excavation planned end + 37)", () => {
    const out = computePlannedDates(construction(), anchors({ kickoff: d("2026-06-01") }));
    assert.equal(iso(out.get("c_preliminary")!.plannedStart), "2026-06-01");
    assert.equal(iso(out.get("c_preliminary")!.plannedEnd), "2026-06-08");
    assert.equal(iso(out.get("c_excavation")!.plannedStart), "2026-06-08");
    assert.equal(iso(out.get("c_excavation")!.plannedEnd), "2026-06-11");
    assert.equal(iso(out.get("c_plinth_beam")!.plannedEnd), "2026-07-18"); // 06-11 + 37
    assert.equal(iso(out.get("c_gf_brickwork")!.plannedStart), "2026-07-18"); // provisional
  });

  it("moves the plinth beam once excavation's actual end is known", () => {
    const tasks = construction();
    tasks[1] = { ...tasks[1], status: "COMPLETED", actualEnd: d("2026-06-15") };
    const out = computePlannedDates(tasks, anchors({ kickoff: d("2026-06-01") }));
    assert.equal(iso(out.get("c_plinth_beam")!.plannedStart), "2026-06-15");
    assert.equal(iso(out.get("c_plinth_beam")!.plannedEnd), "2026-07-22"); // 06-15 + 37
  });

  it("the Phase 4 Start task is a single day: interior execution's planned start", () => {
    const interior = task("c_interior_execution", { plannedStart: d("2026-12-01"), plannedEnd: d("2027-01-15") });
    const start: EngineTask = { ...task("start_CONSTRUCTION_4"), kind: "PHASE_START", phaseKey: "CONSTRUCTION_4", rule: { from: "TASK_START", taskKey: "c_interior_execution" }, plannedSource: "AUTO", afterKey: null };
    const out = computePlannedDates([interior, start], anchors());
    assert.equal(iso(out.get("start_CONSTRUCTION_4")!.plannedStart), "2026-12-01");
    assert.equal(iso(out.get("start_CONSTRUCTION_4")!.plannedEnd), "2026-12-01");
  });

  it("landscaping shares the interior execution planned start", () => {
    const interior = task("c_interior_execution", { plannedStart: d("2026-12-01"), plannedEnd: d("2027-01-15") });
    const out = computePlannedDates([interior, task("c_landscaping")], anchors({ kickoff: d("2026-06-01") }));
    assert.equal(iso(out.get("c_landscaping")!.plannedStart), "2026-12-01");
    assert.equal(iso(out.get("c_landscaping")!.plannedEnd), "2027-01-15");
  });
});

describe("date engine — client-side shift", () => {
  it("shifting every downstream task by N moves the chain by exactly N (no double counting)", () => {
    const keys = ["d2_s1", "d2_s2", "d2_s3"];
    const a = anchors({ phases: { DESIGN_2: { actualStart: d("2026-02-01"), actualEnd: null } } });
    const tasks = keys.map((k) => task(k));
    const down = downstreamTaskIds(tasks, "d2_s1");
    assert.deepEqual(down.sort(), ["d2_s2", "d2_s3"]);
    const shifted = tasks.map((t) => (down.includes(t.id) ? { ...t, shiftDays: 3 } : t));
    const out = computePlannedDates(shifted, a);
    assert.equal(iso(out.get("d2_s1")!.plannedEnd), "2026-02-05"); // the delayed task itself keeps its plan
    assert.equal(iso(out.get("d2_s2")!.plannedEnd), "2026-02-12"); // 02-09 + 3
    assert.equal(iso(out.get("d2_s3")!.plannedEnd), "2026-02-14"); // 02-11 + 3
  });
});

describe("dueState", () => {
  const today = d("2026-05-10");
  it("classifies overdue / due today / due soon", () => {
    assert.equal(dueState({ status: "IN_PROGRESS", plannedEnd: addDaysUTC(today, -1) }, today, 2), "overdue");
    assert.equal(dueState({ status: "IN_PROGRESS", plannedEnd: today }, today, 2), "due-today");
    assert.equal(dueState({ status: "IN_PROGRESS", plannedEnd: addDaysUTC(today, 2) }, today, 2), "due-soon");
    assert.equal(dueState({ status: "IN_PROGRESS", plannedEnd: addDaysUTC(today, 3) }, today, 2), null);
    assert.equal(dueState({ status: "COMPLETED", plannedEnd: addDaysUTC(today, -5) }, today, 2), null);
    assert.equal(dueState({ status: "IN_PROGRESS", plannedEnd: null }, today, 2), null);
  });
});
