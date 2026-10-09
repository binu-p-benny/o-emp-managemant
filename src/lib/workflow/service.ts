// Workflow service — every state change goes through here, inside a
// transaction, with server-side permission checks. Pure rules live in
// engine.ts (state machine), dates.ts (planned dates) and access.ts.

import type { DelayType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { dateOnly, isDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { canHandOver, isDeptHead, taskPermissions, type Actor, type TaskPermissions } from "./access";
import { autoDelayDays, computePlannedDates, downstreamTaskIds, type EngineAnchors, type EngineTask } from "./dates";
import { applyReviewAction, planAdvance, sequenceBlocker, type ReviewAction, type Snapshot } from "./engine";
import { INTERIOR_RULE } from "./template-def";
import { loadTemplates, type TaskTpl, type Templates } from "./templates";
import { isConstruction, type PhaseKey } from "./types";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

const TX = { timeout: 30_000, maxWait: 10_000 };

export class WorkflowError extends Error {}

/** Thrown to roll back a change that needs a reason before it can be saved. */
export class NeedsReasonError extends Error {
  constructor(
    public kind: "milestone" | "interior" | "sequence",
    message: string,
  ) {
    super(message);
  }
}

const today = () => dateOnly(todayKey());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function parseDay(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  if (!isDateKey(value)) throw new WorkflowError(`${field} must be a valid date.`);
  return dateOnly(value);
}

// ─── Loading ────────────────────────────────────────────────────────────────

const taskInclude = { assignees: { select: { userId: true } } } satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

async function loadCtx(db: Db, projectId: string) {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      projectCode: true,
      projectName: true,
      projectCategory: true,
      startDate: true,
      constructionKickoff: true,
      constructionStartedAt: true,
      designApprovedAt: true,
    },
  });
  const phases = await db.projectPhase.findMany({ where: { projectId } });
  const tasks = await db.task.findMany({ where: { projectId }, include: taskInclude, orderBy: [{ order: "asc" }] });
  const templates = await loadTemplates(db);
  return { project, phases, tasks, templates };
}
type Ctx = Awaited<ReturnType<typeof loadCtx>>;

function tplOf(ctx: { templates: Templates }, templateKey: string): TaskTpl {
  const tpl = ctx.templates.tasks.get(templateKey);
  if (!tpl) throw new WorkflowError(`Unknown workflow template "${templateKey}".`);
  return tpl;
}

function engineTasks(ctx: Ctx): EngineTask[] {
  return ctx.tasks.map((t) => {
    const tpl = ctx.templates.tasks.get(t.templateKey);
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
}

function anchorsOf(ctx: Ctx): EngineAnchors {
  return {
    projectStart: ctx.project.startDate,
    kickoff: ctx.project.constructionKickoff,
    designApprovedAt: ctx.project.designApprovedAt,
    phases: Object.fromEntries(ctx.phases.map((p) => [p.key, { actualStart: p.actualStart, actualEnd: p.actualEnd }])),
  };
}

function snapshotOf(ctx: Ctx): Snapshot {
  const tpls = [...ctx.templates.tasks.values()];
  return {
    today: today(),
    phases: ctx.templates.phases.map((p) => {
      const row = ctx.phases.find((r) => r.key === p.key);
      return {
        key: p.key,
        status: row?.status ?? "LOCKED",
        actualStart: row?.actualStart ?? null,
        actualEnd: row?.actualEnd ?? null,
        startTrigger: p.startTrigger,
        stageCount: tpls.filter((t) => t.phaseKey === p.key && t.kind === "STAGE").length,
        approvalKey: tpls.find((t) => t.phaseKey === p.key && t.kind === "APPROVAL")?.key ?? null,
      };
    }),
    tasks: ctx.tasks.map((t) => ({
      id: t.id,
      key: t.templateKey,
      kind: t.kind,
      phaseKey: t.phaseKey as PhaseKey,
      status: t.status,
      afterKey: ctx.templates.tasks.get(t.templateKey)?.afterKey ?? null,
      actualEnd: t.actualEnd,
    })),
  };
}

// ─── Directory helpers ──────────────────────────────────────────────────────

async function firstUserOfRole(db: Db, roleKey: string): Promise<string | null> {
  const u = await db.user.findFirst({ where: { isActive: true, role: { key: roleKey } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return u?.id ?? null;
}

async function usersOfRole(db: Db, roleKey: string): Promise<string[]> {
  return (await db.user.findMany({ where: { isActive: true, role: { key: roleKey } }, select: { id: true } })).map((u) => u.id);
}

async function ensureMember(db: Db, projectId: string, userId: string) {
  await db.projectMember.upsert({ where: { projectId_userId: { projectId, userId } }, create: { projectId, userId }, update: {} });
}

export async function actorFor(db: Db, userId: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: { select: { key: true, isSuperAdmin: true } } } });
  return { id: u.id, name: u.name, roleKey: u.role.key, isSuperAdmin: u.role.isSuperAdmin, reportsToId: u.reportsToId };
}

// ─── Generation ─────────────────────────────────────────────────────────────

async function assignDefaults(tx: Tx, ctx: Ctx, task: { id: string; name: string; visible: boolean }, tpl: TaskTpl, silent: boolean) {
  for (const roleKey of tpl.defaultAssigneeRoleKeys) {
    const userId = await firstUserOfRole(tx, roleKey);
    if (!userId) continue;
    await tx.taskAssignee.upsert({ where: { taskId_userId: { taskId: task.id, userId } }, create: { taskId: task.id, userId }, update: {} });
    await ensureMember(tx, ctx.project.id, userId);
    if (!silent && task.visible) {
      await notify(tx, { userIds: [userId], type: "ASSIGNED", taskId: task.id, projectId: ctx.project.id, message: `${ctx.project.projectCode}: "${task.name}" is assigned to you.` });
    }
  }
}

/** Creates the stage tasks for every phase in this phase's task group (e.g. all 18 construction tasks). */
async function generateGroupTasks(tx: Tx, ctx: Ctx, phaseKey: PhaseKey, silent = false) {
  const phase = ctx.templates.phaseByKey.get(phaseKey)!;
  const groupPhases = new Set(ctx.templates.phases.filter((p) => p.taskGroup === phase.taskGroup).map((p) => p.key));
  const existing = new Set((await tx.task.findMany({ where: { projectId: ctx.project.id }, select: { templateKey: true } })).map((t) => t.templateKey));
  const tpls = [...ctx.templates.tasks.values()].filter((t) => t.kind === "STAGE" && groupPhases.has(t.phaseKey) && !existing.has(t.key)).sort((a, b) => a.order - b.order);
  for (const tpl of tpls) {
    const visible = !isConstruction(tpl.phaseKey) || !!ctx.project.constructionStartedAt;
    const reviewerId = tpl.requiresReview && tpl.reviewerRoleKey ? await firstUserOfRole(tx, tpl.reviewerRoleKey) : null;
    const task = await tx.task.create({
      data: {
        projectId: ctx.project.id,
        templateKey: tpl.key,
        kind: "STAGE",
        phaseKey: tpl.phaseKey,
        phase: tpl.phase,
        constructionPhase: tpl.constructionPhase,
        order: tpl.order,
        name: tpl.name,
        plannedSource: tpl.offsetRule ? "AUTO" : "CUSTOM",
        visible,
        reviewerId,
      },
    });
    await assignDefaults(tx, ctx, task, tpl, silent);
  }
}

async function openStartTask(tx: Tx, ctx: Ctx, phaseKey: PhaseKey, silent = false) {
  const phase = ctx.templates.phaseByKey.get(phaseKey)!;
  const tpl = tplOf(ctx, `start_${phaseKey}`);
  const exists = await tx.task.findUnique({ where: { projectId_templateKey: { projectId: ctx.project.id, templateKey: tpl.key } } });
  if (!exists) {
    const task = await tx.task.create({
      data: {
        projectId: ctx.project.id,
        templateKey: tpl.key,
        kind: "PHASE_START",
        phaseKey,
        phase: phase.phase,
        constructionPhase: phase.constructionPhase,
        startsPhaseKey: phaseKey,
        startsPhase: phase.phase,
        startsConstructionPhase: phase.constructionPhase,
        order: 0,
        name: tpl.name,
        plannedSource: tpl.offsetRule ? "AUTO" : "CUSTOM",
      },
    });
    await assignDefaults(tx, ctx, task, tpl, true);
    if (!silent) {
      const heads = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((a) => a.userId);
      await notify(tx, {
        userIds: heads,
        type: "START_TASK_CREATED",
        taskId: task.id,
        projectId: ctx.project.id,
        message: `${ctx.project.projectCode}: "${tpl.name}" is waiting for you to start ${phase.name.split(":")[0]}.`,
      });
    }
  }
  await tx.projectPhase.update({ where: { projectId_key: { projectId: ctx.project.id, key: phaseKey } }, data: { status: "AWAITING_START" } });
  await generateGroupTasks(tx, ctx, phaseKey, true);
}

async function createApproval(tx: Tx, ctx: Ctx, phaseKey: PhaseKey, templateKey: string, actualStart: Date, silent: boolean) {
  const tpl = tplOf(ctx, templateKey);
  const phase = ctx.templates.phaseByKey.get(phaseKey)!;
  const task = await tx.task.create({
    data: {
      projectId: ctx.project.id,
      templateKey,
      kind: "APPROVAL",
      phaseKey,
      phase: phase.phase,
      constructionPhase: phase.constructionPhase,
      order: tpl.order,
      name: tpl.name,
      status: "IN_PROGRESS",
      actualStart, // the gate opens when its phase actually ended
      plannedSource: tpl.offsetRule ? "AUTO" : "CUSTOM",
    },
  });
  await assignDefaults(tx, ctx, task, tpl, silent);
}

// ─── Advance & recompute ────────────────────────────────────────────────────

/** Applies every consequence of the current state (phase completion, Start tasks, activation). */
async function advance(tx: Tx, projectId: string, silent = false) {
  for (let i = 0; i < 8; i++) {
    const ctx = await loadCtx(tx, projectId);
    const ops = planAdvance(snapshotOf(ctx)).filter((op) => !(op.type === "ACTIVATE" && op.taskId.startsWith("new:")));
    if (!ops.length) break;
    for (const op of ops) {
      switch (op.type) {
        case "COMPLETE_PHASE":
          await tx.projectPhase.update({ where: { projectId_key: { projectId, key: op.phaseKey } }, data: { status: "COMPLETED", actualEnd: op.actualEnd } });
          break;
        case "OPEN_START_TASK":
          await openStartTask(tx, ctx, op.phaseKey, silent);
          break;
        case "CREATE_APPROVAL":
          await createApproval(tx, ctx, op.phaseKey, op.templateKey, op.actualStart, silent);
          break;
        case "ACTIVATE":
          await tx.task.updateMany({ where: { id: op.taskId, status: "NOT_STARTED" }, data: { status: "IN_PROGRESS", actualStart: op.actualStart } });
          break;
      }
    }
  }
  await recompute(tx, projectId);
  await updateCurrentPhase(tx, projectId);
}

/** Recalculates planned dates for AUTO tasks (CUSTOM dates are never touched). */
export async function recompute(tx: Db, projectId: string) {
  const ctx = await loadCtx(tx, projectId);
  const next = computePlannedDates(engineTasks(ctx), anchorsOf(ctx));
  for (const t of ctx.tasks) {
    const n = next.get(t.id);
    if (!n) continue;
    if (iso(n.plannedStart) !== iso(t.plannedStart) || iso(n.plannedEnd) !== iso(t.plannedEnd)) {
      await tx.task.update({ where: { id: t.id }, data: { plannedStart: n.plannedStart, plannedEnd: n.plannedEnd } });
    }
  }
}

async function updateCurrentPhase(tx: Tx, projectId: string) {
  const [phases, project] = await Promise.all([
    tx.projectPhase.findMany({ where: { projectId }, select: { key: true, status: true } }),
    tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { designApprovedAt: true } }),
  ]);
  const st = (k: string) => phases.find((p) => p.key === k)?.status;
  let current: "DESIGN_1" | "DESIGN_2" | "CONSTRUCTION" = "DESIGN_1";
  if (st("DESIGN_1") === "COMPLETED") current = "DESIGN_2";
  if (project.designApprovedAt || phases.some((p) => isConstruction(p.key) && p.status !== "LOCKED")) current = "CONSTRUCTION";
  await tx.project.update({ where: { id: projectId }, data: { currentPhase: current } });
}

// ─── Project lifecycle ──────────────────────────────────────────────────────

const NON_WORKFLOW_CATEGORY = "Office / Yard";

async function createPhaseRows(tx: Tx, ctx: Ctx) {
  await tx.projectPhase.createMany({
    data: ctx.templates.phases.map((p) => ({
      projectId: ctx.project.id,
      key: p.key,
      status: p.startTrigger.type === "PROJECT_CREATED" ? "ACTIVE" : "LOCKED",
      actualStart: p.startTrigger.type === "PROJECT_CREATED" ? ctx.project.startDate : null,
    })),
    skipDuplicates: true,
  });
}

/** New project: Design Phase 1 starts on the project start date (day 0). */
export async function initProjectWorkflow(tx: Tx, projectId: string) {
  let ctx = await loadCtx(tx, projectId);
  if (ctx.project.projectCategory === NON_WORKFLOW_CATEGORY || ctx.phases.length) return;
  await createPhaseRows(tx, ctx);
  ctx = await loadCtx(tx, projectId);
  for (const p of ctx.templates.phases.filter((x) => x.startTrigger.type === "PROJECT_CREATED")) await generateGroupTasks(tx, ctx, p.key);
  await advance(tx, projectId);
}

/**
 * Existing project (pre-workflow): Design Phase 1 is treated as done. Its tasks
 * are backfilled as completed and a pending "Start Design Phase 2" task goes to
 * the Architect Head — Phase 2 is NOT started automatically.
 */
export async function backfillProjectWorkflow(tx: Tx, projectId: string): Promise<boolean> {
  let ctx = await loadCtx(tx, projectId);
  if (ctx.project.projectCategory === NON_WORKFLOW_CATEGORY || ctx.phases.length) return false;
  await createPhaseRows(tx, ctx);
  ctx = await loadCtx(tx, projectId);
  await generateGroupTasks(tx, ctx, "DESIGN_1", true);
  await recompute(tx, projectId);

  ctx = await loadCtx(tx, projectId);
  const now = today();
  const architect = await firstUserOfRole(tx, "AR_DESIGN");
  for (const t of ctx.tasks.filter((x) => x.phaseKey === "DESIGN_1")) {
    const end = t.plannedEnd && t.plannedEnd < now ? t.plannedEnd : now;
    await tx.task.update({ where: { id: t.id }, data: { status: "COMPLETED", actualStart: t.plannedStart ?? ctx.project.startDate, actualEnd: end } });
    if (!t.assignees.length && architect) await tx.taskAssignee.create({ data: { taskId: t.id, userId: architect } });
    await tx.taskEvent.create({ data: { taskId: t.id, type: "BACKFILLED", note: "Design Phase 1 marked complete when the workflow engine was introduced." } });
  }
  await advance(tx, projectId);
  return true;
}

export async function onProjectSaved(projectId: string, { isNew }: { isNew: boolean }) {
  await prisma.$transaction(async (tx) => {
    const has = await tx.projectPhase.count({ where: { projectId } });
    if (isNew || !has) await initProjectWorkflow(tx, projectId);
    else {
      // Start date may have moved: Phase 1 anchors on it until Phase 1 completes.
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { startDate: true } });
      await tx.projectPhase.updateMany({ where: { projectId, key: "DESIGN_1", status: "ACTIVE" }, data: { actualStart: p.startDate } });
      await recompute(tx, projectId);
    }
  }, TX);
}

// ─── Task-level helpers ─────────────────────────────────────────────────────

type TaskCtx = { ctx: Ctx; task: TaskRow; tpl: TaskTpl; ownerRoleKey: string; perms: TaskPermissions };

async function loadTask(tx: Tx, actor: Actor, taskId: string): Promise<TaskCtx> {
  const t = await tx.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!t) throw new WorkflowError("Task not found.");
  const ctx = await loadCtx(tx, t.projectId);
  const task = ctx.tasks.find((x) => x.id === taskId)!;
  const tpl = tplOf(ctx, task.templateKey);
  const ownerRoleKey = ctx.templates.phaseByKey.get(task.phaseKey)!.ownerRoleKey;
  const perms = taskPermissions(actor, accessInput(ctx, task, tpl, ownerRoleKey));
  if (!perms.canSee) throw new WorkflowError("Task not found.");
  return { ctx, task, tpl, ownerRoleKey, perms };
}

export function accessInput(ctx: Pick<Ctx, "phases" | "tasks">, task: TaskRow, tpl: TaskTpl, ownerRoleKey: string) {
  const phaseStatus = ctx.phases.find((p) => p.key === task.phaseKey)?.status;
  const pred = tpl.afterKey ? ctx.tasks.find((x) => x.templateKey === tpl.afterKey) ?? null : null;
  const blocker =
    task.kind === "STAGE" && task.status === "NOT_STARTED" && phaseStatus === "ACTIVE"
      ? sequenceBlocker({ kind: task.kind, afterKey: tpl.afterKey, phaseKey: task.phaseKey as PhaseKey }, phaseStatus, pred)
      : null;
  return {
    kind: task.kind,
    status: task.status,
    visible: task.visible,
    requiresReview: tpl.requiresReview,
    reviewerId: task.reviewerId,
    reviewerRoleKey: tpl.reviewerRoleKey,
    assigneeIds: task.assignees.map((a) => a.userId),
    ownerRoleKey,
    phaseStatus,
    blocker,
    hasAutoRule: !!tpl.offsetRule,
    plannedSource: task.plannedSource,
  };
}

function deny(message = "You don't have permission to do that."): never {
  throw new WorkflowError(message);
}

async function reviewerIds(tx: Tx, task: TaskRow, tpl: TaskTpl): Promise<string[]> {
  if (task.reviewerId) return [task.reviewerId];
  return tpl.reviewerRoleKey ? usersOfRole(tx, tpl.reviewerRoleKey) : [];
}

async function deptHeadIds(tx: Tx, ownerRoleKey: string) {
  return usersOfRole(tx, ownerRoleKey);
}

function label(ctx: Ctx, task: { name: string }) {
  return `${ctx.project.projectCode}: "${task.name}"`;
}

// ─── Phase start ────────────────────────────────────────────────────────────

export async function startPhase(
  actor: Actor,
  input: { taskId: string; startDate?: string; kickoff?: string; assignments?: { taskId: string; userId: string }[] },
) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, perms } = await loadTask(tx, actor, input.taskId);
    if (task.kind !== "PHASE_START" || !task.startsPhaseKey) throw new WorkflowError("This isn't a Start task.");
    if (!perms.canStartPhase) deny("Only the head who owns this phase can start it.");
    const phaseKey = task.startsPhaseKey as PhaseKey;
    const start = parseDay(input.startDate, "Start date") ?? today();
    const isFirstConstruction = phaseKey === "CONSTRUCTION_1";

    await tx.projectPhase.update({
      where: { projectId_key: { projectId: ctx.project.id, key: phaseKey } },
      data: { status: "ACTIVE", actualStart: start, startedById: actor.id, startedAt: new Date() },
    });
    await tx.task.update({ where: { id: task.id }, data: { status: "COMPLETED", actualStart: start, actualEnd: start } });
    await tx.taskEvent.create({ data: { taskId: task.id, type: "PHASE_STARTED", byUserId: actor.id, note: `${phaseKey} started` } });

    if (isFirstConstruction) {
      // Construction kickoff: workers can now see their tasks.
      const kickoff = parseDay(input.kickoff, "Kickoff date") ?? ctx.project.constructionKickoff ?? start;
      await tx.project.update({ where: { id: ctx.project.id }, data: { constructionKickoff: kickoff, constructionStartedAt: new Date() } });
      await tx.task.updateMany({ where: { projectId: ctx.project.id, phase: "CONSTRUCTION" }, data: { visible: true } });
      // One message per worker (not one per task) now that their tasks are visible.
      const hidden = ctx.tasks.filter((t) => t.phase === "CONSTRUCTION" && !t.visible && t.kind === "STAGE");
      const byWorker = new Map<string, typeof hidden>();
      for (const t of hidden) for (const a of t.assignees) byWorker.set(a.userId, [...(byWorker.get(a.userId) ?? []), t]);
      for (const [userId, tasks] of byWorker) {
        const first = tasks.sort((a, b) => a.order - b.order)[0];
        await notify(tx, {
          userIds: [userId],
          type: "ASSIGNED",
          taskId: first.id,
          projectId: ctx.project.id,
          message: `${ctx.project.projectCode}: construction has started — ${tasks.length} task${tasks.length === 1 ? " is" : "s are"} assigned to you, starting with "${first.name}".`,
          except: actor.id,
        });
      }
    }

    for (const a of input.assignments ?? []) {
      if (!a.userId) continue;
      await assignInternal(tx, actor, a.taskId, a.userId, { asHead: true });
    }
    await advance(tx, ctx.project.id);
    return { projectId: ctx.project.id };
  }, TX);
}

// ─── Review flow ────────────────────────────────────────────────────────────

async function review(actor: Actor, taskId: string, action: ReviewAction, opts: { note?: string | null; actualEnd?: string; logDelayDays?: number | null; reassignTo?: string | null } = {}) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, tpl, ownerRoleKey, perms } = await loadTask(tx, actor, taskId);
    if (action === "SUBMIT" && !perms.canSubmit) deny("Only the assignee can submit this task for review.");
    if ((action === "APPROVE" || action === "SEND_BACK") && !perms.canReview) deny("Only the reviewer can approve or send back this task.");
    if (action === "COMPLETE" && !perms.canComplete) deny("You can't complete this task.");

    const now = new Date();
    const result = applyReviewAction({ status: task.status, requiresReview: tpl.requiresReview, submittedAt: task.submittedAt, reworkCount: task.reworkCount }, action, {
      now,
      today: today(),
      note: opts.note,
    });
    if (!result.ok) throw new WorkflowError(result.error);
    const patch = { ...result.patch };
    if (patch.actualEnd && opts.actualEnd) patch.actualEnd = parseDay(opts.actualEnd, "Completion date")!;
    await tx.task.update({ where: { id: task.id }, data: patch });
    if (result.review) await tx.taskReview.create({ data: { taskId: task.id, decision: result.review.decision, note: result.review.note, byUserId: actor.id } });

    const assignees = task.assignees.map((a) => a.userId);
    if (action === "SUBMIT") {
      await notify(tx, { userIds: await reviewerIds(tx, task, tpl), type: "REVIEW_REQUESTED", taskId: task.id, projectId: ctx.project.id, message: `${label(ctx, task)} was submitted for your review by ${actor.name}.`, except: actor.id });
    }
    if (action === "APPROVE") {
      await notify(tx, { userIds: assignees, type: "APPROVED", taskId: task.id, projectId: ctx.project.id, message: `${label(ctx, task)} was approved by ${actor.name}.`, except: actor.id });
    }
    if (action === "SEND_BACK") {
      if (opts.reassignTo) await assignInternal(tx, actor, task.id, opts.reassignTo, { asHead: true, reason: "Reassigned on rework" });
      const after = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((a) => a.userId);
      await notify(tx, { userIds: after, type: "SENT_BACK", taskId: task.id, projectId: ctx.project.id, message: `${label(ctx, task)} was sent back for rework: ${result.review?.note}`, except: actor.id });
      // Rework time is real delay — logged only when the reviewer chose to.
      if (opts.logDelayDays != null) {
        await tx.taskDelay.create({ data: { taskId: task.id, type: "REWORK", reason: result.review?.note ?? "Rework", delayDays: Math.max(0, Math.round(opts.logDelayDays)), flaggedById: actor.id } });
      }
    }
    if (action === "COMPLETE" && task.kind === "APPROVAL") {
      // Approval date = the completion date entered (defaults to today).
      const approvedAt = opts.actualEnd && patch.actualEnd ? patch.actualEnd : now;
      await tx.project.update({ where: { id: ctx.project.id }, data: { designApprovedAt: approvedAt, designApprovedById: actor.id } });
    }
    if (patch.status === "COMPLETED") {
      await tx.taskEvent.create({ data: { taskId: task.id, type: "COMPLETED", byUserId: actor.id } });
      await advance(tx, ctx.project.id);
    }
    void ownerRoleKey;
    return { projectId: ctx.project.id };
  }, TX);
}

export const submitTask = (actor: Actor, taskId: string, note?: string) => review(actor, taskId, "SUBMIT", { note });
export const approveTask = (actor: Actor, taskId: string, note?: string, actualEnd?: string) => review(actor, taskId, "APPROVE", { note, actualEnd });
export const completeTask = (actor: Actor, taskId: string, actualEnd?: string) => review(actor, taskId, "COMPLETE", { actualEnd });
export const sendBackTask = (actor: Actor, taskId: string, input: { note: string; logDelayDays?: number | null; reassignTo?: string | null }) =>
  review(actor, taskId, "SEND_BACK", { note: input.note, logDelayDays: input.logDelayDays, reassignTo: input.reassignTo });

/** Start a stage by hand — the head may override sequence with a reason. */
export async function startTask(actor: Actor, taskId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, perms } = await loadTask(tx, actor, taskId);
    if (!perms.canStart) deny("This stage can't be started yet.");
    if (perms.startNeedsOverride && !reason?.trim()) throw new NeedsReasonError("sequence", "The previous stage isn't approved yet — give a reason to start this one early.");
    await tx.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS", actualStart: today() } });
    await tx.taskEvent.create({ data: { taskId: task.id, type: perms.startNeedsOverride ? "SEQUENCE_OVERRIDE" : "STARTED", note: reason?.trim() || null, byUserId: actor.id } });
    return { projectId: ctx.project.id };
  }, TX);
}

// ─── Planned & actual dates ─────────────────────────────────────────────────

function interiorConflict<T extends { templateKey: string; name: string; plannedStart: Date | null; plannedEnd: Date | null }>(tasks: T[]) {
  const interior = tasks.find((t) => t.templateKey === INTERIOR_RULE.interiorKey);
  const brick = tasks.find((t) => t.templateKey === INTERIOR_RULE.brickworkKey);
  if (!interior?.plannedEnd || !brick?.plannedStart || interior.plannedEnd <= brick.plannedStart) return null;
  return { interior, brick, message: `"${interior.name}" is planned to finish ${iso(interior.plannedEnd)}, after "${brick.name}" starts ${iso(brick.plannedStart)}. Interior design must finish before ground floor brickwork begins.` };
}

export function interiorConflictOf<T extends { templateKey: string; name: string; plannedStart: Date | null; plannedEnd: Date | null }>(tasks: T[]) {
  return interiorConflict(tasks);
}

async function setPlannedInternal(
  tx: Tx,
  actor: Actor,
  tc: TaskCtx,
  input: { plannedStart?: string | null; plannedEnd: string; reason?: string | null },
) {
  const { task, tpl } = tc;
  const end = parseDay(input.plannedEnd, "Planned end")!;
  const start = parseDay(input.plannedStart, "Planned start") ?? task.plannedStart;
  if (start && start > end) throw new WorkflowError(`${task.name}: planned start can't be after planned end.`);
  if (tpl.milestone && tpl.offsetRule && !input.reason?.trim()) throw new NeedsReasonError("milestone", `"${task.name}" is a milestone with a hard auto date — give a reason to override it.`);
  if (iso(end) === iso(task.plannedEnd) && iso(start) === iso(task.plannedStart) && task.plannedSource === "CUSTOM") return false;
  await tx.task.update({
    where: { id: task.id },
    data: {
      plannedStart: start,
      plannedEnd: end,
      plannedSource: "CUSTOM",
      shiftDays: 0,
      originalAutoPlannedEnd: task.plannedSource === "AUTO" ? task.plannedEnd : task.originalAutoPlannedEnd,
      plannedChangedById: actor.id,
      plannedChangedAt: new Date(),
    },
  });
  await tx.taskEvent.create({
    data: {
      taskId: task.id,
      type: "PLANNED_CHANGED",
      note: input.reason?.trim() || null,
      byUserId: actor.id,
      data: { from: { start: iso(task.plannedStart), end: iso(task.plannedEnd), source: task.plannedSource }, to: { start: iso(start), end: iso(end) } },
    },
  });
  return true;
}

async function checkInterior(tx: Tx, projectId: string, touchedTaskIds: string[], overrideReason: string | null | undefined, actor: Actor) {
  const tasks = await tx.task.findMany({ where: { projectId }, select: { id: true, templateKey: true, name: true, plannedStart: true, plannedEnd: true } });
  const conflict = interiorConflict(tasks);
  if (!conflict || !touchedTaskIds.some((id) => id === conflict.interior.id || id === conflict.brick.id)) return;
  if (!overrideReason?.trim()) throw new NeedsReasonError("interior", conflict.message);
  await tx.taskEvent.create({ data: { taskId: conflict.interior.id, type: "INTERIOR_RULE_OVERRIDE", note: overrideReason.trim(), byUserId: actor.id, data: { brickworkStart: iso(conflict.brick.plannedStart), interiorEnd: iso(conflict.interior.plannedEnd) } } });
}

export async function setPlannedDates(
  actor: Actor,
  taskId: string,
  input: { plannedStart?: string | null; plannedEnd: string; reason?: string | null; interiorOverrideReason?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const tc = await loadTask(tx, actor, taskId);
    if (!tc.perms.canSetDates) deny("Only the department head can change planned dates.");
    await setPlannedInternal(tx, actor, tc, input);
    await recompute(tx, tc.ctx.project.id);
    await checkInterior(tx, tc.ctx.project.id, [taskId], input.interiorOverrideReason, actor);
    return { projectId: tc.ctx.project.id };
  }, TX);
}

export async function resetPlannedToAuto(actor: Actor, taskId: string) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, perms } = await loadTask(tx, actor, taskId);
    if (!perms.canResetAuto) deny("This task has no automatic date to go back to.");
    await tx.task.update({ where: { id: task.id }, data: { plannedSource: "AUTO", originalAutoPlannedEnd: null, plannedChangedById: actor.id, plannedChangedAt: new Date() } });
    await tx.taskEvent.create({ data: { taskId: task.id, type: "RESET_TO_AUTO", byUserId: actor.id, data: { was: { start: iso(task.plannedStart), end: iso(task.plannedEnd) } } } });
    await recompute(tx, ctx.project.id);
    return { projectId: ctx.project.id };
  }, TX);
}

export async function setActualDates(actor: Actor, taskId: string, input: { actualStart?: string | null; actualEnd?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, perms } = await loadTask(tx, actor, taskId);
    if (!perms.canEditActual) deny("Only the department head or reviewer can edit actual dates.");
    const actualStart = input.actualStart === undefined ? task.actualStart : parseDay(input.actualStart, "Actual start");
    const actualEnd = input.actualEnd === undefined ? task.actualEnd : parseDay(input.actualEnd, "Actual end");
    if (actualEnd && task.status !== "COMPLETED") throw new WorkflowError("An actual end date can only be set once the task is completed.");
    if (actualStart && actualEnd && actualStart > actualEnd) throw new WorkflowError("Actual start can't be after actual end.");
    await tx.task.update({ where: { id: task.id }, data: { actualStart, actualEnd } });
    await tx.taskEvent.create({ data: { taskId: task.id, type: "ACTUAL_CHANGED", byUserId: actor.id, data: { start: iso(actualStart), end: iso(actualEnd) } } });
    await recompute(tx, ctx.project.id); // e.g. excavation's actual end moves the plinth beam
    return { projectId: ctx.project.id };
  }, TX);
}

// ─── Delays ─────────────────────────────────────────────────────────────────

export async function flagDelay(actor: Actor, taskId: string, input: { type: DelayType; reason: string; delayDays?: number | null; shiftFollowing?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, tpl, ownerRoleKey, perms } = await loadTask(tx, actor, taskId);
    if (!perms.canFlagDelay) deny("Only the assignee or the department head can flag a delay.");
    const reason = input.reason?.trim();
    if (!reason) throw new WorkflowError("A reason is required.");
    const days = input.delayDays != null && Number.isFinite(input.delayDays) ? Math.max(0, Math.round(input.delayDays)) : autoDelayDays(task.plannedEnd, task.actualEnd, today());
    const shift = !!input.shiftFollowing && input.type === "CLIENT_SIDE" && days > 0;
    await tx.taskDelay.create({ data: { taskId: task.id, type: input.type, reason, delayDays: days, flaggedById: actor.id, shiftedFollowing: shift } });

    if (shift) {
      const ids = downstreamTaskIds(engineTasks(ctx), task.templateKey);
      for (const t of ctx.tasks.filter((x) => ids.includes(x.id))) {
        const custom = t.plannedSource === "CUSTOM" && t.plannedEnd;
        await tx.task.update({
          where: { id: t.id },
          data: {
            shiftDays: { increment: days },
            ...(custom
              ? { plannedStart: t.plannedStart && new Date(t.plannedStart.getTime() + days * 86_400_000), plannedEnd: new Date(t.plannedEnd!.getTime() + days * 86_400_000) }
              : {}),
          },
        });
      }
      await tx.taskEvent.create({ data: { taskId: task.id, type: "SHIFTED_FOLLOWING", byUserId: actor.id, data: { days, tasks: ids.length } } });
      await recompute(tx, ctx.project.id);
    }

    const people = [...task.assignees.map((a) => a.userId), ...(await reviewerIds(tx, task, tpl)), ...(await deptHeadIds(tx, ownerRoleKey))];
    await notify(tx, { userIds: people, type: "DELAY_FLAGGED", taskId: task.id, projectId: ctx.project.id, message: `${label(ctx, task)}: ${input.type.replace("_", " ").toLowerCase()} delay of ${days} day(s) flagged by ${actor.name} — ${reason}`, except: actor.id });
    return { projectId: ctx.project.id };
  }, TX);
}

/** How many open tasks a client-side shift would move. */
export async function previewShift(taskId: string): Promise<number> {
  const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, templateKey: true } });
  const ctx = await loadCtx(prisma, t.projectId);
  return downstreamTaskIds(engineTasks(ctx), t.templateKey).length;
}

// ─── Assignment ─────────────────────────────────────────────────────────────

async function assignInternal(tx: Tx, actor: Actor, taskId: string, toUserId: string, opts: { asHead?: boolean; replaceUserId?: string | null; reason?: string | null } = {}) {
  const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { ...taskInclude, project: { select: { projectCode: true } } } });
  const ctxTpl = (await loadTemplates(tx)).tasks.get(task.templateKey);
  if (!ctxTpl) throw new WorkflowError("Unknown task template.");
  const target = await tx.user.findUnique({ where: { id: toUserId }, include: { role: { select: { key: true } } } });
  if (!target?.isActive) throw new WorkflowError("That person isn't an active employee.");
  if (!ctxTpl.assigneeRoleKeys.includes(target.role.key)) throw new WorkflowError(`${target.name} isn't in the assignee pool for "${task.name}".`);
  if (!opts.asHead && !canHandOver(actor, target)) throw new WorkflowError("You can only hand a task to someone in your own team.");

  const current = task.assignees.map((a) => a.userId);
  if (current.includes(toUserId)) return;
  const replace = opts.replaceUserId !== undefined ? opts.replaceUserId : ctxTpl.multiAssignee ? null : current[0] ?? null;
  if (replace) await tx.taskAssignee.deleteMany({ where: { taskId, userId: replace } });
  await tx.taskAssignee.create({ data: { taskId, userId: toUserId } });
  await tx.taskAssignmentHistory.create({ data: { taskId, fromUserId: replace, toUserId, changedById: actor.id, reason: opts.reason?.trim() || null } });
  await ensureMember(tx, task.projectId, toUserId);
  if (task.visible) {
    await notify(tx, {
      userIds: [toUserId],
      type: replace ? "REASSIGNED" : "ASSIGNED",
      taskId,
      projectId: task.projectId,
      message: `${task.project.projectCode}: "${task.name}" was ${replace ? "reassigned" : "assigned"} to you by ${actor.name}.`,
      except: actor.id,
    });
  }
}

export async function reassignTask(actor: Actor, taskId: string, input: { toUserId: string; replaceUserId?: string | null; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const { ctx, task, perms } = await loadTask(tx, actor, taskId);
    if (!perms.canReassign) deny("You can't reassign this task.");
    const asHead = !perms.reassignWithinTeamOnly;
    // An assignee hands over their own share of the task.
    const replace = asHead ? input.replaceUserId : actor.id;
    if (!asHead && !task.assignees.some((a) => a.userId === actor.id)) deny();
    await assignInternal(tx, actor, task.id, input.toUserId, { asHead, replaceUserId: replace, reason: input.reason });
    return { projectId: ctx.project.id };
  }, TX);
}

// ─── Construction planning (Head - Site Operations) ─────────────────────────

export async function saveConstructionPlan(
  actor: Actor,
  projectId: string,
  input: {
    kickoff: string | null;
    rows: { taskId: string; plannedStart?: string | null; plannedEnd?: string | null; assigneeId?: string | null }[];
    reason?: string | null;
    interiorOverrideReason?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    let ctx = await loadCtx(tx, projectId);
    const owner = ctx.templates.phaseByKey.get("CONSTRUCTION_1")!.ownerRoleKey;
    if (!isDeptHead(actor, owner)) deny("Only Head - Site Operations can plan construction.");
    if (!ctx.phases.some((p) => p.key === "CONSTRUCTION_1" && p.status !== "LOCKED")) throw new WorkflowError("Construction hasn't been handed over yet (design not approved).");

    const kickoff = parseDay(input.kickoff, "Kickoff");
    if (iso(kickoff) !== iso(ctx.project.constructionKickoff)) {
      await tx.project.update({ where: { id: projectId }, data: { constructionKickoff: kickoff } });
      await recompute(tx, projectId);
      ctx = await loadCtx(tx, projectId);
    }

    const touched: string[] = [];
    for (const row of input.rows) {
      const task = ctx.tasks.find((t) => t.id === row.taskId && t.phase === "CONSTRUCTION" && t.kind === "STAGE");
      if (!task) continue;
      if (row.plannedEnd && (row.plannedEnd !== iso(task.plannedEnd) || (row.plannedStart && row.plannedStart !== iso(task.plannedStart)))) {
        const tpl = tplOf(ctx, task.templateKey);
        const tc: TaskCtx = { ctx, task, tpl, ownerRoleKey: owner, perms: taskPermissions(actor, accessInput(ctx, task, tpl, owner)) };
        if (await setPlannedInternal(tx, actor, tc, { plannedStart: row.plannedStart, plannedEnd: row.plannedEnd, reason: input.reason })) touched.push(task.id);
      }
      if (row.assigneeId && !task.assignees.some((a) => a.userId === row.assigneeId)) {
        await assignInternal(tx, actor, task.id, row.assigneeId, { asHead: true });
      }
    }
    await recompute(tx, projectId);
    await checkInterior(tx, projectId, touched, input.interiorOverrideReason, actor);
    return { projectId, changed: touched.length };
  }, TX);
}
