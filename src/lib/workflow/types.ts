// Shared workflow types (client-safe: no server imports).

export const PHASE_KEYS = [
  "DESIGN_1",
  "DESIGN_2",
  "DESIGN_3",
  "DESIGN_4",
  "CONSTRUCTION_1",
  "CONSTRUCTION_2",
  "CONSTRUCTION_3",
  "CONSTRUCTION_4",
] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export type TaskStatusKey = "NOT_STARTED" | "IN_PROGRESS" | "IN_REVIEW" | "REWORK" | "COMPLETED";
export type TaskKindKey = "STAGE" | "PHASE_START" | "APPROVAL";
export type PhaseStatusKey = "LOCKED" | "AWAITING_START" | "ACTIVE" | "COMPLETED";
export type DelayTypeKey = "IN_HOUSE" | "CLIENT_SIDE" | "REWORK";

/** How a planned date is derived. `null` on a template means "custom date — set by a person". */
export type OffsetRule =
  | { from: "PROJECT_START"; days: number } // end = project start + days
  | { from: "PHASE_START"; days?: number } // first stage: start = phase actual start, end = start + duration
  | { from: "PREVIOUS"; days?: number } // start = previous stage's planned end, end = start + duration
  | { from: "KICKOFF"; days: number } // end = construction kickoff + days
  | { from: "TASK_END"; taskKey: string; days: number } // from another task's actual end (planned end until known)
  | { from: "TASK_START"; taskKey: string; days?: number } // same planned start as another task
  | { from: "PHASE_END"; phase: PhaseKey } // actual end of a phase (planned end until known)
  | { from: "DESIGN_APPROVED" }; // design approval date

/** When a phase's Start task is created. */
export type StartTrigger =
  | { type: "PROJECT_CREATED" } // phase starts with the project (no Start task)
  | { type: "PHASE_COMPLETE"; phase: PhaseKey }
  | { type: "TASK_COMPLETE"; taskKey: string }
  | { type: "PHASE_STARTED"; phase: PhaseKey };

/** Existing org-chart role keys used by the flow (no new head roles). */
export const ROLES = {
  MD: "MD",
  MANAGING_PARTNER: "MANAGING_PARTNER",
  ARCHITECT_HEAD: "HEAD_DESIGN", // "Head - Architectural Designs"
  ARCHITECT: "AR_DESIGN",
  INTERIOR_DESIGN: "INTERIOR_DESIGN",
  DRAFTING: "DRAFTING",
  CONSTRUCTION_HEAD: "HEAD_SITE_OPS", // "Head - Site Operations"
  CIVIL_WORKS: "CIVIL_WORKS",
  INTERIOR_WORKS: "INTERIOR_WORKS",
} as const;

export const STATUS_LABEL: Record<TaskStatusKey, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  REWORK: "Rework",
  COMPLETED: "Completed",
};

export const DELAY_LABEL: Record<DelayTypeKey, string> = {
  IN_HOUSE: "In-house",
  CLIENT_SIDE: "Client side",
  REWORK: "Rework",
};

export function phaseKeyOf(phase: string, constructionPhase: number | null | undefined): PhaseKey {
  return (phase === "CONSTRUCTION" ? `CONSTRUCTION_${constructionPhase ?? 1}` : phase) as PhaseKey;
}

export function isConstruction(key: string): boolean {
  return key.startsWith("CONSTRUCTION");
}
