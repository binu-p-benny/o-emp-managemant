// Who may do what on a workflow task. Enforced in the service layer; the UI
// only uses the same answers to decide which buttons to show.

import { ROLES, type TaskKindKey, type TaskStatusKey } from "./types";

export type Actor = {
  id: string;
  name: string;
  roleKey: string;
  isSuperAdmin: boolean;
  reportsToId: string | null;
};

/** MD and Managing Partner see everything. */
export const isOwner = (a: Actor) => a.isSuperAdmin || a.roleKey === ROLES.MANAGING_PARTNER;

/** Department head for a phase = the role that owns it (MD can act as any head). */
export const isDeptHead = (a: Actor, ownerRoleKey: string) => a.isSuperAdmin || a.roleKey === ownerRoleKey;

export type TaskAccessInput = {
  kind: TaskKindKey;
  status: TaskStatusKey;
  visible: boolean;
  requiresReview: boolean;
  reviewerId: string | null;
  reviewerRoleKey: string | null;
  assigneeIds: string[];
  ownerRoleKey: string;
  phaseStatus: string | undefined;
  /** Reason the stage can't start yet (predecessor not approved), if any. */
  blocker: string | null;
  hasAutoRule: boolean;
  plannedSource: "AUTO" | "CUSTOM";
};

export type TaskPermissions = {
  canSee: boolean;
  canStartPhase: boolean;
  canStart: boolean;
  startNeedsOverride: boolean;
  canSubmit: boolean;
  canComplete: boolean;
  canReview: boolean;
  canSetDates: boolean;
  canResetAuto: boolean;
  canEditActual: boolean;
  canFlagDelay: boolean;
  canReassign: boolean;
  /** Can only reassign within their own team (same line manager). */
  reassignWithinTeamOnly: boolean;
};

export function taskPermissions(actor: Actor, t: TaskAccessInput): TaskPermissions {
  const head = isDeptHead(actor, t.ownerRoleKey);
  const assignee = t.assigneeIds.includes(actor.id);
  const reviewer = t.reviewerId === actor.id || actor.roleKey === t.reviewerRoleKey || actor.isSuperAdmin;
  const open = t.status !== "COMPLETED";
  const stage = t.kind === "STAGE";
  const phaseActive = t.phaseStatus === "ACTIVE";

  return {
    canSee: t.visible || head || isOwner(actor),
    canStartPhase: t.kind === "PHASE_START" && open && head && t.phaseStatus === "AWAITING_START",
    canStart: stage && t.status === "NOT_STARTED" && phaseActive && (t.blocker ? head : assignee || head),
    startNeedsOverride: !!t.blocker,
    canSubmit: t.requiresReview && (t.status === "IN_PROGRESS" || t.status === "REWORK") && assignee,
    canComplete: t.kind !== "PHASE_START" && !t.requiresReview && t.status === "IN_PROGRESS" && (assignee || head),
    canReview: t.status === "IN_REVIEW" && reviewer,
    canSetDates: head && open,
    canResetAuto: head && open && t.plannedSource === "CUSTOM" && t.hasAutoRule,
    canEditActual: (head || reviewer) && t.kind !== "PHASE_START",
    canFlagDelay: stage && (assignee || head),
    canReassign: open && t.kind !== "PHASE_START" && (head || assignee),
    reassignWithinTeamOnly: !head,
  };
}

/** Assignee → another assignee: allowed only within the same team (same line manager). */
export function canHandOver(actor: Actor, target: { reportsToId: string | null; id: string }): boolean {
  if (target.id === actor.id) return false;
  return !!actor.reportsToId && target.reportsToId === actor.reportsToId;
}
