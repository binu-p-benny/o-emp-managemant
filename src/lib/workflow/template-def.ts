// Default workflow template (seeded into WorkflowTemplate → PhaseTemplate → TaskTemplate).
// After seeding, the database copy is the source of truth — durations, offsets,
// review flags and assignee pools can be edited there without code changes.

import { ROLES, type OffsetRule, type PhaseKey, type StartTrigger, type TaskKindKey } from "./types";

export type PhaseDef = {
  key: PhaseKey;
  phase: "DESIGN_1" | "DESIGN_2" | "DESIGN_3" | "DESIGN_4" | "CONSTRUCTION";
  constructionPhase: number | null;
  name: string;
  shortName: string;
  order: number;
  ownerRoleKey: string;
  taskGroup: string;
  startTrigger: StartTrigger;
  startPlannedRule: OffsetRule | null;
};

export type TaskDef = {
  key: string;
  phaseKey: PhaseKey;
  kind: TaskKindKey;
  order: number;
  name: string;
  durationDays?: number;
  requiresReview: boolean;
  reviewerRoleKey?: string;
  offsetRule: OffsetRule | null;
  afterKey?: string;
  assigneeRoleKeys: string[];
  preferredRoleKeys?: string[];
  defaultAssigneeRoleKeys?: string[];
  multiAssignee?: boolean;
  milestone?: boolean;
};

export const DEFAULT_TEMPLATE_KEY = "ORANZAI_STANDARD";
export const DEFAULT_TEMPLATE_NAME = "Oranzai standard: Enquiry → Design → Construction";

const DESIGN_TEAM = [ROLES.ARCHITECT, ROLES.INTERIOR_DESIGN, ROLES.DRAFTING]; // everyone under Architect Head
const SITE_TEAM = [ROLES.CIVIL_WORKS, ROLES.INTERIOR_WORKS]; // workers under Head - Site Operations

export const PHASES: PhaseDef[] = [
  {
    key: "DESIGN_1",
    phase: "DESIGN_1",
    constructionPhase: null,
    name: "Design Phase 1: Enquiry to Elevation",
    shortName: "Design 1",
    order: 1,
    ownerRoleKey: ROLES.ARCHITECT_HEAD,
    taskGroup: "DESIGN_1",
    startTrigger: { type: "PROJECT_CREATED" },
    startPlannedRule: null,
  },
  {
    key: "DESIGN_2",
    phase: "DESIGN_2",
    constructionPhase: null,
    name: "Design Phase 2: Working Drawings",
    shortName: "Design 2",
    order: 2,
    ownerRoleKey: ROLES.ARCHITECT_HEAD,
    taskGroup: "DESIGN_2",
    startTrigger: { type: "PHASE_COMPLETE", phase: "DESIGN_1" },
    startPlannedRule: { from: "PHASE_END", phase: "DESIGN_1" },
  },
  {
    key: "DESIGN_3",
    phase: "DESIGN_3",
    constructionPhase: null,
    name: "Design Phase 3: Interior design",
    shortName: "Design 3",
    order: 3,
    ownerRoleKey: ROLES.ARCHITECT_HEAD,
    taskGroup: "DESIGN_3",
    // Can start before construction, in parallel with Phase 2 — custom date.
    startTrigger: { type: "PHASE_COMPLETE", phase: "DESIGN_1" },
    startPlannedRule: null,
  },
  {
    key: "DESIGN_4",
    phase: "DESIGN_4",
    constructionPhase: null,
    name: "Design Phase 4: Interior working drawings",
    shortName: "Design 4",
    order: 4,
    ownerRoleKey: ROLES.ARCHITECT_HEAD,
    taskGroup: "DESIGN_4",
    startTrigger: { type: "PHASE_COMPLETE", phase: "DESIGN_3" },
    startPlannedRule: { from: "PHASE_END", phase: "DESIGN_3" },
  },
  {
    key: "CONSTRUCTION_1",
    phase: "CONSTRUCTION",
    constructionPhase: 1,
    name: "Construction Phase 1: up to gray works",
    shortName: "Construction 1",
    order: 5,
    ownerRoleKey: ROLES.CONSTRUCTION_HEAD,
    taskGroup: "CONSTRUCTION",
    startTrigger: { type: "TASK_COMPLETE", taskKey: "design_approval" },
    startPlannedRule: { from: "DESIGN_APPROVED" },
  },
  {
    key: "CONSTRUCTION_2",
    phase: "CONSTRUCTION",
    constructionPhase: 2,
    name: "Construction Phase 2: finishers",
    shortName: "Construction 2",
    order: 6,
    ownerRoleKey: ROLES.CONSTRUCTION_HEAD,
    taskGroup: "CONSTRUCTION",
    startTrigger: { type: "PHASE_COMPLETE", phase: "CONSTRUCTION_1" },
    startPlannedRule: { from: "PHASE_END", phase: "CONSTRUCTION_1" },
  },
  {
    key: "CONSTRUCTION_3",
    phase: "CONSTRUCTION",
    constructionPhase: 3,
    name: "Construction Phase 3: interior execution",
    shortName: "Construction 3",
    order: 7,
    ownerRoleKey: ROLES.CONSTRUCTION_HEAD,
    taskGroup: "CONSTRUCTION",
    // Phase 2's "Final painting and handover" comes after interior execution, so
    // Phase 3 opens once the last pre-interior finisher (Electrical) is approved.
    startTrigger: { type: "TASK_COMPLETE", taskKey: "c_electrical" },
    startPlannedRule: { from: "TASK_END", taskKey: "c_electrical", days: 0 },
  },
  {
    key: "CONSTRUCTION_4",
    phase: "CONSTRUCTION",
    constructionPhase: 4,
    name: "Construction Phase 4: landscape and compound wall",
    shortName: "Construction 4",
    order: 8,
    ownerRoleKey: ROLES.CONSTRUCTION_HEAD,
    taskGroup: "CONSTRUCTION",
    // Can start early / in parallel: available from construction kickoff,
    // planned alongside interior execution.
    startTrigger: { type: "PHASE_STARTED", phase: "CONSTRUCTION_1" },
    startPlannedRule: { from: "TASK_START", taskKey: "c_interior_execution" },
  },
];

const designReview = { requiresReview: true, reviewerRoleKey: ROLES.ARCHITECT_HEAD };
const siteReview = { requiresReview: true, reviewerRoleKey: ROLES.CONSTRUCTION_HEAD };

function construction(
  order: number,
  key: string,
  name: string,
  constructionPhase: 1 | 2 | 3 | 4,
  offsetRule: OffsetRule | null,
  extra: Partial<TaskDef> = {},
): TaskDef {
  return {
    key,
    phaseKey: `CONSTRUCTION_${constructionPhase}` as PhaseKey,
    kind: "STAGE",
    order,
    name,
    offsetRule,
    assigneeRoleKeys: SITE_TEAM,
    preferredRoleKeys: [ROLES.CIVIL_WORKS],
    ...siteReview,
    ...extra,
  };
}

export const TASKS: TaskDef[] = [
  // ── Design Phase 1: Enquiry to Elevation (day 0 = project start) ──
  {
    key: "d1_site_visit",
    phaseKey: "DESIGN_1",
    kind: "STAGE",
    order: 1,
    name: "Site visit / survey",
    offsetRule: { from: "PROJECT_START", days: 0 },
    requiresReview: false,
    assigneeRoleKeys: [ROLES.MD, ROLES.ARCHITECT_HEAD],
    defaultAssigneeRoleKeys: [ROLES.MD, ROLES.ARCHITECT_HEAD],
    multiAssignee: true,
  },
  {
    key: "d1_concept_plan",
    phaseKey: "DESIGN_1",
    kind: "STAGE",
    order: 2,
    name: "Concept / initial plan",
    offsetRule: { from: "PROJECT_START", days: 10 },
    afterKey: "d1_site_visit",
    assigneeRoleKeys: DESIGN_TEAM,
    preferredRoleKeys: [ROLES.ARCHITECT],
    ...designReview,
  },
  {
    key: "d1_final_plan",
    phaseKey: "DESIGN_1",
    kind: "STAGE",
    order: 3,
    name: "Final plan confirmed",
    offsetRule: { from: "PROJECT_START", days: 15 },
    afterKey: "d1_concept_plan",
    requiresReview: false, // the confirmation is itself the Architect Head's approval
    assigneeRoleKeys: [ROLES.ARCHITECT_HEAD],
    defaultAssigneeRoleKeys: [ROLES.ARCHITECT_HEAD],
  },
  {
    key: "d1_elevation_start",
    phaseKey: "DESIGN_1",
    kind: "STAGE",
    order: 4,
    name: "Elevation start",
    offsetRule: { from: "PROJECT_START", days: 22 },
    afterKey: "d1_final_plan",
    assigneeRoleKeys: DESIGN_TEAM,
    ...designReview,
  },
  {
    key: "d1_elevation_confirm",
    phaseKey: "DESIGN_1",
    kind: "STAGE",
    order: 5,
    name: "Elevation confirmation",
    offsetRule: { from: "PROJECT_START", days: 30 },
    afterKey: "d1_elevation_start",
    assigneeRoleKeys: DESIGN_TEAM,
    ...designReview,
  },

  // ── Design Phase 2: Working Drawings (sequential, calendar days) ──
  ...(
    [
      ["d2_s1", "S1", 4, true],
      ["d2_s2", "S2", 4, true],
      ["d2_s3", "S3", 2, true],
      ["d2_s4", "S4", 3, false],
      ["d2_s5a", "S5-A", 4, false],
      ["d2_s5b", "S5-B", 3, false],
    ] as const
  ).map(
    ([key, name, days, draftingFirst], i, all): TaskDef => ({
      key,
      phaseKey: "DESIGN_2",
      kind: "STAGE",
      order: i + 1,
      name,
      durationDays: days,
      offsetRule: i === 0 ? { from: "PHASE_START" } : { from: "PREVIOUS" },
      afterKey: i === 0 ? undefined : all[i - 1][0],
      assigneeRoleKeys: DESIGN_TEAM,
      preferredRoleKeys: draftingFirst ? [ROLES.DRAFTING] : [],
      ...designReview,
    }),
  ),
  {
    key: "design_approval",
    phaseKey: "DESIGN_2",
    kind: "APPROVAL",
    order: 99,
    name: "Approve design",
    offsetRule: { from: "PHASE_END", phase: "DESIGN_2" },
    requiresReview: false,
    assigneeRoleKeys: [ROLES.ARCHITECT_HEAD],
    defaultAssigneeRoleKeys: [ROLES.ARCHITECT_HEAD],
  },

  // ── Design Phase 3 & 4: Interior (custom dates) ──
  {
    key: "d3_interior_design",
    phaseKey: "DESIGN_3",
    kind: "STAGE",
    order: 1,
    name: "Interior design",
    offsetRule: null,
    assigneeRoleKeys: DESIGN_TEAM,
    preferredRoleKeys: [ROLES.INTERIOR_DESIGN],
    ...designReview,
  },
  {
    key: "d4_interior_drawings",
    phaseKey: "DESIGN_4",
    kind: "STAGE",
    order: 1,
    name: "Interior working drawings / interior drafting",
    offsetRule: null,
    assigneeRoleKeys: DESIGN_TEAM,
    preferredRoleKeys: [ROLES.INTERIOR_DESIGN, ROLES.DRAFTING],
    ...designReview,
  },

  // ── Construction (10–12 months) — tasks in list order ──
  construction(1, "c_preliminary", "Preliminary work", 1, { from: "KICKOFF", days: 7 }, { durationDays: 7, milestone: true }),
  construction(2, "c_excavation", "Excavation", 1, { from: "KICKOFF", days: 10 }, { afterKey: "c_preliminary", milestone: true }),
  construction(3, "c_plinth_beam", "Plinth beam standing", 1, { from: "TASK_END", taskKey: "c_excavation", days: 37 }, { afterKey: "c_excavation", milestone: true }),
  construction(4, "c_gf_brickwork", "Ground floor brickwork", 1, null, { afterKey: "c_plinth_beam" }),
  construction(5, "c_gf_slab", "Ground floor slab", 1, null, { afterKey: "c_gf_brickwork" }),
  construction(6, "c_lintel_brickwork", "Brickwork, lintel level", 1, null, { afterKey: "c_gf_slab" }),
  construction(7, "c_ff_slab", "First floor slab", 1, null, { afterKey: "c_lintel_brickwork" }),
  construction(8, "c_plaster_gf", "Plastering, ground floor", 2, null, { afterKey: "c_ff_slab" }),
  construction(9, "c_plaster_ff", "Plastering, first floor", 2, null, { afterKey: "c_plaster_gf" }),
  construction(10, "c_plaster_ext", "Plastering, external", 2, null, { afterKey: "c_plaster_ff" }),
  construction(11, "c_painting_putty", "Painting (up to putty)", 2, null, { afterKey: "c_plaster_ext" }),
  construction(12, "c_doors_windows", "Doors and windows", 2, null, { afterKey: "c_painting_putty" }),
  construction(13, "c_tiling", "Tiling", 2, null, { afterKey: "c_doors_windows" }),
  construction(14, "c_sanitary", "Sanitary", 2, null, { afterKey: "c_tiling" }),
  construction(15, "c_electrical", "Electrical", 2, null, { afterKey: "c_sanitary" }),
  construction(16, "c_interior_execution", "Interior (execution)", 3, null, { afterKey: "c_electrical", preferredRoleKeys: [ROLES.INTERIOR_WORKS] }),
  construction(17, "c_final_painting", "Final painting and handover", 2, null, { afterKey: "c_interior_execution" }),
  construction(18, "c_landscaping", "Landscaping and compound wall", 4, { from: "TASK_START", taskKey: "c_interior_execution" }),
];

/** Start tasks — one per phase that opens by handoff (Section 2.0). */
export const START_TASKS: TaskDef[] = PHASES.filter((p) => p.startTrigger.type !== "PROJECT_CREATED").map((p) => ({
  key: `start_${p.key}`,
  phaseKey: p.key,
  kind: "PHASE_START",
  order: 0,
  name: `Start ${p.name.split(":")[0]}`,
  offsetRule: p.startPlannedRule,
  requiresReview: false,
  assigneeRoleKeys: [p.ownerRoleKey],
  defaultAssigneeRoleKeys: [p.ownerRoleKey],
}));

export const ALL_TASK_DEFS: TaskDef[] = [...TASKS, ...START_TASKS];

/** Interior design must finish before ground floor brickwork starts. */
export const INTERIOR_RULE = { interiorKey: "d3_interior_design", brickworkKey: "c_gf_brickwork" } as const;

/** Overall construction target window (months from kickoff). */
export const CONSTRUCTION_TARGET_MONTHS = [10, 12] as const;
