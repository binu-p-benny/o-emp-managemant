// Read models for the workflow UI (serialisable: dates as "YYYY-MM-DD" strings).

import type { Prisma } from "@/generated/prisma/client";
import { dateOnly, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getReminderSettings } from "@/lib/settings";
import { isDeptHead, isOwner, taskPermissions, type Actor, type TaskPermissions } from "./access";
import { downstreamTaskIds, dueState, varianceDays, type DueState, type EngineTask } from "./dates";
import { sequenceBlocker } from "./engine";
import { CONSTRUCTION_TARGET_MONTHS, PHASES } from "./template-def";
import { loadTemplates } from "./templates";
import { interiorConflictOf } from "./service";
import { ROLES, isConstruction, type DelayTypeKey, type PhaseKey, type PhaseStatusKey, type StartTrigger, type TaskKindKey, type TaskStatusKey } from "./types";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const isoTime = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const viewInclude = {
  assignees: { include: { user: { select: { id: true, name: true, role: { select: { name: true } } } } }, orderBy: { assignedAt: "asc" } },
  reviewer: { select: { id: true, name: true } },
  plannedChangedBy: { select: { name: true } },
  delays: { orderBy: { flaggedAt: "desc" }, include: { flaggedBy: { select: { name: true } } } },
  reviews: { orderBy: { at: "asc" }, include: { byUser: { select: { name: true } } } },
  history: { orderBy: { at: "asc" }, include: { fromUser: { select: { name: true } }, toUser: { select: { name: true } }, changedBy: { select: { name: true } } } },
  events: { orderBy: { at: "asc" }, include: { byUser: { select: { name: true } } } },
} satisfies Prisma.TaskInclude;

export type PoolMember = { id: string; name: string; roleName: string; preferred: boolean; sameTeam: boolean };

export type TaskView = {
  id: string;
  projectId: string;
  templateKey: string;
  name: string;
  kind: TaskKindKey;
  phaseKey: PhaseKey;
  phaseName: string;
  order: number;
  status: TaskStatusKey;
  visible: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedSource: "AUTO" | "CUSTOM";
  originalAutoPlannedEnd: string | null;
  plannedChangedBy: string | null;
  hasAutoRule: boolean;
  milestone: boolean;
  requiresReview: boolean;
  multiAssignee: boolean;
  actualStart: string | null;
  actualEnd: string | null;
  submittedAt: string | null;
  lastSubmittedAt: string | null;
  reworkCount: number;
  variance: number | null;
  due: DueState;
  assignees: { id: string; name: string; roleName: string }[];
  reviewer: { id: string; name: string } | null;
  delays: { id: string; type: DelayTypeKey; reason: string; days: number; by: string; at: string; shifted: boolean }[];
  delayDays: number;
  reviews: { decision: string; note: string | null; by: string; at: string }[];
  history: { from: string | null; to: string; by: string; reason: string | null; at: string }[];
  events: { type: string; note: string | null; by: string | null; at: string }[];
  perms: TaskPermissions;
  blocker: string | null;
  pool: PoolMember[];
  downstreamCount: number;
};

export type PhaseView = {
  key: PhaseKey;
  name: string;
  shortName: string;
  status: PhaseStatusKey;
  actualStart: string | null;
  actualEnd: string | null;
  ownerRoleName: string;
  isConstruction: boolean;
  startTask: TaskView | null;
  tasks: TaskView[];
  done: number;
  total: number;
  opensWhen: string | null;
};

export type ProjectWorkflowView = {
  project: { id: string; code: string; name: string; startDate: string; currentPhase: string; designApprovedAt: string | null; constructionKickoff: string | null; constructionStartedAt: string | null };
  phases: PhaseView[];
  approvals: TaskView[];
  delaySummary: { count: number; days: number; byType: Record<DelayTypeKey, { count: number; days: number }> };
  interiorConflict: string | null;
  constructionTarget: { kickoff: string; earliest: string; latest: string; plannedFinish: string | null } | null;
  activeLabel: string;
  progress: { done: number; total: number };
  viewer: { isArchitectHead: boolean; isConstructionHead: boolean; isOwner: boolean };
  dueSoonDays: number;
};

function describeTrigger(t: StartTrigger, templates: Awaited<ReturnType<typeof loadTemplates>>): string | null {
  const phaseName = (k: string) => templates.phaseByKey.get(k)?.name.split(":")[0] ?? k;
  switch (t.type) {
    case "PROJECT_CREATED":
      return "Starts with the project";
    case "PHASE_COMPLETE":
      return `Opens when ${phaseName(t.phase)} is complete`;
    case "PHASE_STARTED":
      return `Available once ${phaseName(t.phase)} has started`;
    case "TASK_COMPLETE":
      return templates.tasks.get(t.taskKey)?.kind === "APPROVAL" ? "Opens when the design is approved" : `Opens when "${templates.tasks.get(t.taskKey)?.name ?? t.taskKey}" is approved`;
  }
}

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

export async function getProjectWorkflow(projectId: string, actor: Actor): Promise<ProjectWorkflowView | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, projectName: true, startDate: true, currentPhase: true, designApprovedAt: true, constructionKickoff: true, constructionStartedAt: true },
  });
  if (!project) return null;
  const [phases, tasks, templates, roles, users, settings] = await Promise.all([
    prisma.projectPhase.findMany({ where: { projectId } }),
    prisma.task.findMany({ where: { projectId }, include: viewInclude, orderBy: [{ order: "asc" }] }),
    loadTemplates(prisma),
    prisma.role.findMany({ select: { key: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, reportsToId: true, role: { select: { key: true, name: true } } }, orderBy: { name: "asc" } }),
    getReminderSettings(),
  ]);
  if (!phases.length) return null;

  const roleName = new Map(roles.map((r) => [r.key, r.name]));
  const today = dateOnly(todayKey());
  const engine: EngineTask[] = tasks.map((t) => {
    const tpl = templates.tasks.get(t.templateKey);
    return {
      id: t.id,
      key: t.templateKey,
      kind: t.kind,
      phaseKey: t.phaseKey as PhaseKey,
      afterKey: tpl?.afterKey ?? null,
      rule: tpl?.offsetRule ?? null,
      durationDays: tpl?.durationDays ?? null,
      plannedSource: t.plannedSource,
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      shiftDays: t.shiftDays,
      actualStart: t.actualStart,
      actualEnd: t.actualEnd,
      status: t.status,
    };
  });

  const views: TaskView[] = [];
  for (const t of tasks) {
    const tpl = templates.tasks.get(t.templateKey);
    const phaseTpl = templates.phaseByKey.get(t.phaseKey);
    if (!tpl || !phaseTpl) continue;
    const phaseStatus = phases.find((p) => p.key === t.phaseKey)?.status;
    const pred = tpl.afterKey ? tasks.find((x) => x.templateKey === tpl.afterKey) ?? null : null;
    const blocker = t.kind === "STAGE" && t.status === "NOT_STARTED" && phaseStatus === "ACTIVE" ? sequenceBlocker({ kind: t.kind, afterKey: tpl.afterKey, phaseKey: t.phaseKey as PhaseKey }, phaseStatus, pred) : null;
    const perms = taskPermissions(actor, {
      kind: t.kind,
      status: t.status,
      visible: t.visible,
      requiresReview: tpl.requiresReview,
      reviewerId: t.reviewerId,
      reviewerRoleKey: tpl.reviewerRoleKey,
      assigneeIds: t.assignees.map((a) => a.userId),
      ownerRoleKey: phaseTpl.ownerRoleKey,
      phaseStatus,
      blocker,
      hasAutoRule: !!tpl.offsetRule,
      plannedSource: t.plannedSource,
    });
    if (!perms.canSee) continue;
    const preferred = new Set(tpl.preferredRoleKeys);
    const pool = users
      .filter((u) => tpl.assigneeRoleKeys.includes(u.role.key))
      .map((u) => ({ id: u.id, name: u.name, roleName: u.role.name, preferred: preferred.has(u.role.key), sameTeam: !!actor.reportsToId && u.reportsToId === actor.reportsToId && u.id !== actor.id }))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name));
    views.push({
      id: t.id,
      projectId,
      templateKey: t.templateKey,
      name: t.name,
      kind: t.kind,
      phaseKey: t.phaseKey as PhaseKey,
      phaseName: phaseTpl.name,
      order: t.order,
      status: t.status,
      visible: t.visible,
      plannedStart: iso(t.plannedStart),
      plannedEnd: iso(t.plannedEnd),
      plannedSource: t.plannedSource,
      originalAutoPlannedEnd: iso(t.originalAutoPlannedEnd),
      plannedChangedBy: t.plannedChangedBy?.name ?? null,
      hasAutoRule: !!tpl.offsetRule,
      milestone: tpl.milestone,
      requiresReview: tpl.requiresReview,
      multiAssignee: tpl.multiAssignee,
      actualStart: iso(t.actualStart),
      actualEnd: iso(t.actualEnd),
      submittedAt: isoTime(t.submittedAt),
      lastSubmittedAt: isoTime(t.lastSubmittedAt),
      reworkCount: t.reworkCount,
      variance: varianceDays(t.plannedEnd, t.actualEnd),
      due: t.kind === "PHASE_START" || phaseStatus !== "ACTIVE" ? null : dueState(t, today, settings.dueSoonDays),
      assignees: t.assignees.map((a) => ({ id: a.user.id, name: a.user.name, roleName: a.user.role.name })),
      reviewer: t.reviewer ?? (tpl.reviewerRoleKey ? { id: "", name: roleName.get(tpl.reviewerRoleKey) ?? tpl.reviewerRoleKey } : null),
      delays: t.delays.map((d) => ({ id: d.id, type: d.type, reason: d.reason, days: d.delayDays, by: d.flaggedBy.name, at: d.flaggedAt.toISOString(), shifted: d.shiftedFollowing })),
      delayDays: t.delays.reduce((n, d) => n + d.delayDays, 0),
      reviews: t.reviews.map((r) => ({ decision: r.decision, note: r.note, by: r.byUser.name, at: r.at.toISOString() })),
      history: t.history.map((h) => ({ from: h.fromUser?.name ?? null, to: h.toUser.name, by: h.changedBy.name, reason: h.reason, at: h.at.toISOString() })),
      events: t.events.map((e) => ({ type: e.type, note: e.note, by: e.byUser?.name ?? null, at: e.at.toISOString() })),
      perms,
      blocker,
      pool,
      downstreamCount: t.kind === "STAGE" ? downstreamTaskIds(engine, t.templateKey).length : 0,
    });
  }

  const phaseViews: PhaseView[] = templates.phases.map((p) => {
    const row = phases.find((r) => r.key === p.key);
    const own = views.filter((v) => v.phaseKey === p.key);
    const stages = own.filter((v) => v.kind === "STAGE");
    const total = [...templates.tasks.values()].filter((t) => t.phaseKey === p.key && t.kind === "STAGE").length;
    return {
      key: p.key,
      name: p.name,
      shortName: PHASES.find((x) => x.key === p.key)?.shortName ?? p.name,
      status: row?.status ?? "LOCKED",
      actualStart: iso(row?.actualStart),
      actualEnd: iso(row?.actualEnd),
      ownerRoleName: roleName.get(p.ownerRoleKey) ?? p.ownerRoleKey,
      isConstruction: isConstruction(p.key),
      startTask: own.find((v) => v.kind === "PHASE_START") ?? null,
      tasks: stages,
      done: stages.filter((v) => v.status === "COMPLETED").length,
      total,
      opensWhen: describeTrigger(p.startTrigger, templates),
    };
  });

  const byType = { IN_HOUSE: { count: 0, days: 0 }, CLIENT_SIDE: { count: 0, days: 0 }, REWORK: { count: 0, days: 0 } } as ProjectWorkflowView["delaySummary"]["byType"];
  for (const t of views) for (const d of t.delays) (byType[d.type].count++, (byType[d.type].days += d.days));
  const conflict = interiorConflictOf(tasks);
  const constructionEnds = tasks.filter((t) => t.phase === "CONSTRUCTION" && t.kind === "STAGE").map((t) => t.plannedEnd).filter((d): d is Date => !!d);
  const kickoff = project.constructionKickoff;
  const active = phaseViews.filter((p) => p.status === "ACTIVE");
  const allStages = [...templates.tasks.values()].filter((t) => t.kind === "STAGE").length;

  return {
    project: {
      id: project.id,
      code: project.projectCode,
      name: project.projectName,
      startDate: iso(project.startDate)!,
      currentPhase: project.currentPhase,
      designApprovedAt: isoTime(project.designApprovedAt),
      constructionKickoff: iso(project.constructionKickoff),
      constructionStartedAt: isoTime(project.constructionStartedAt),
    },
    phases: phaseViews,
    approvals: views.filter((v) => v.kind === "APPROVAL"),
    delaySummary: { count: Object.values(byType).reduce((n, x) => n + x.count, 0), days: Object.values(byType).reduce((n, x) => n + x.days, 0), byType },
    interiorConflict: conflict?.message ?? null,
    constructionTarget: kickoff
      ? {
          kickoff: iso(kickoff)!,
          earliest: iso(addMonths(kickoff, CONSTRUCTION_TARGET_MONTHS[0]))!,
          latest: iso(addMonths(kickoff, CONSTRUCTION_TARGET_MONTHS[1]))!,
          plannedFinish: iso(constructionEnds.reduce<Date | null>((m, d) => (!m || d > m ? d : m), null)),
        }
      : null,
    activeLabel: active.length ? active.map((p) => p.shortName).join(" + ") : phaseViews.find((p) => p.status === "AWAITING_START")?.shortName ? `Waiting to start ${phaseViews.find((p) => p.status === "AWAITING_START")!.shortName}` : "—",
    progress: { done: views.filter((v) => v.kind === "STAGE" && v.status === "COMPLETED").length, total: allStages },
    viewer: { isArchitectHead: isDeptHead(actor, ROLES.ARCHITECT_HEAD), isConstructionHead: isDeptHead(actor, ROLES.CONSTRUCTION_HEAD), isOwner: isOwner(actor) },
    dueSoonDays: settings.dueSoonDays,
  };
}

/** Real sequence: design phases in order; construction by its 1–18 list order (final painting follows interior). */
export function bySequence(a: TaskView, b: TaskView): number {
  const rank = (t: TaskView) => (isConstruction(t.phaseKey) ? 100 : PHASES.findIndex((p) => p.key === t.phaseKey) * 10);
  const kind = (t: TaskView) => (t.kind === "PHASE_START" ? -1 : t.kind === "APPROVAL" ? 1 : 0);
  if (isConstruction(a.phaseKey) && isConstruction(b.phaseKey) && a.kind === "STAGE" && b.kind === "STAGE") return a.order - b.order;
  return rank(a) - rank(b) || kind(a) - kind(b) || a.order - b.order;
}

export function allTasks(view: ProjectWorkflowView): TaskView[] {
  return [...view.phases.flatMap((p) => (p.startTask ? [p.startTask, ...p.tasks] : p.tasks)), ...view.approvals];
}

/** Projects that have a workflow and are visible to the actor (by id). */
async function workflowProjects(projectIds?: string[]) {
  return prisma.project.findMany({
    where: { phases: { some: {} }, ...(projectIds ? { id: { in: projectIds } } : {}) },
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { projectCode: "asc" },
  });
}

export type ProjectTasks = { project: { id: string; code: string; name: string }; tasks: TaskView[]; view: ProjectWorkflowView };

/** Every open task assigned to the actor (plus ones completed in the last 7 days), grouped by project. */
export async function listMyTasks(actor: Actor): Promise<ProjectTasks[]> {
  const mine = await prisma.taskAssignee.findMany({ where: { userId: actor.id }, select: { task: { select: { projectId: true } } } });
  const projects = await workflowProjects([...new Set(mine.map((m) => m.task.projectId))]);
  const recent = dateOnly(todayKey()).getTime() - 7 * 86_400_000;
  const out: ProjectTasks[] = [];
  for (const p of projects) {
    const view = await getProjectWorkflow(p.id, actor);
    if (!view) continue;
    const tasks = allTasks(view).filter(
      (t) => t.visible && t.assignees.some((a) => a.id === actor.id) && (t.status !== "COMPLETED" || (t.actualEnd && Date.parse(t.actualEnd) >= recent)),
    );
    if (tasks.length) out.push({ project: { id: p.id, code: p.projectCode, name: p.projectName }, tasks: tasks.sort(bySequence), view });
  }
  return out;
}

/** Tasks waiting for this reviewer, oldest submission first. */
export async function listReviewQueue(actor: Actor): Promise<{ project: ProjectTasks["project"]; task: TaskView; view: ProjectWorkflowView }[]> {
  const pending = await prisma.task.findMany({ where: { status: "IN_REVIEW" }, select: { projectId: true } });
  const projects = await workflowProjects([...new Set(pending.map((t) => t.projectId))]);
  const out: { project: ProjectTasks["project"]; task: TaskView; view: ProjectWorkflowView }[] = [];
  for (const p of projects) {
    const view = await getProjectWorkflow(p.id, actor);
    if (!view) continue;
    for (const t of allTasks(view)) if (t.perms.canReview) out.push({ project: { id: p.id, code: p.projectCode, name: p.projectName }, task: t, view });
  }
  return out.sort((a, b) => (a.task.lastSubmittedAt ?? "").localeCompare(b.task.lastSubmittedAt ?? ""));
}

export type DeskView = {
  projects: ProjectTasks[];
  startTasks: { project: ProjectTasks["project"]; task: TaskView; view: ProjectWorkflowView }[];
  approvals: { project: ProjectTasks["project"]; task: TaskView; view: ProjectWorkflowView }[];
  workload: { userId: string; name: string; roleName: string; open: number; overdue: number; dueSoon: number; inReview: number; rework: number }[];
};

/** Head screens: pending Start tasks, approvals, team tasks and workload for one department. */
export async function getDesk(actor: Actor, dept: "design" | "construction"): Promise<DeskView> {
  const inDept = (k: string) => (dept === "construction" ? isConstruction(k) : !isConstruction(k));
  const projects = await workflowProjects();
  const desk: DeskView = { projects: [], startTasks: [], approvals: [], workload: [] };
  const load = new Map<string, DeskView["workload"][number]>();
  for (const p of projects) {
    const view = await getProjectWorkflow(p.id, actor);
    if (!view) continue;
    const proj = { id: p.id, code: p.projectCode, name: p.projectName };
    const tasks = allTasks(view).filter((t) => inDept(t.phaseKey));
    for (const t of tasks) {
      if (t.kind === "PHASE_START" && t.status !== "COMPLETED" && view.phases.find((ph) => ph.key === t.phaseKey)?.status === "AWAITING_START") desk.startTasks.push({ project: proj, task: t, view });
      if ((t.kind === "APPROVAL" || t.templateKey === "d1_final_plan") && t.status === "IN_PROGRESS") desk.approvals.push({ project: proj, task: t, view });
      if (t.kind !== "STAGE" || t.status === "COMPLETED") continue;
      for (const a of t.assignees) {
        const w = load.get(a.id) ?? { userId: a.id, name: a.name, roleName: a.roleName, open: 0, overdue: 0, dueSoon: 0, inReview: 0, rework: 0 };
        w.open++;
        if (t.due === "overdue") w.overdue++;
        if (t.due === "due-soon" || t.due === "due-today") w.dueSoon++;
        if (t.status === "IN_REVIEW") w.inReview++;
        if (t.status === "REWORK") w.rework++;
        load.set(a.id, w);
      }
    }
    const open = tasks.filter((t) => t.kind === "STAGE" && t.status !== "COMPLETED").sort(bySequence);
    if (open.length || (dept === "construction" && view.phases.some((ph) => ph.key === "CONSTRUCTION_1" && ph.status !== "LOCKED"))) {
      desk.projects.push({ project: proj, tasks: open, view });
    }
  }
  desk.workload = [...load.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  return desk;
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
