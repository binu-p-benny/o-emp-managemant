// Workflow templates in the database (seeded from template-def.ts).

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ALL_TASK_DEFS, DEFAULT_TEMPLATE_KEY, DEFAULT_TEMPLATE_NAME, PHASES } from "./template-def";
import type { OffsetRule, PhaseKey, StartTrigger, TaskKindKey } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Creates any missing template rows. Existing rows are left alone so edits
 * made in the database survive — pass `overwrite: true` to reset to defaults.
 */
export async function ensureWorkflowTemplates(db: Db, { overwrite = false } = {}) {
  const wf = await db.workflowTemplate.upsert({
    where: { key: DEFAULT_TEMPLATE_KEY },
    create: { key: DEFAULT_TEMPLATE_KEY, name: DEFAULT_TEMPLATE_NAME },
    update: overwrite ? { name: DEFAULT_TEMPLATE_NAME } : {},
  });
  const phaseIds = new Map<string, string>();
  for (const p of PHASES) {
    const data = {
      phase: p.phase,
      constructionPhase: p.constructionPhase,
      name: p.name,
      order: p.order,
      ownerRoleKey: p.ownerRoleKey,
      taskGroup: p.taskGroup,
      startTrigger: p.startTrigger as unknown as Prisma.InputJsonValue,
      startPlannedRule: (p.startPlannedRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    };
    const row = await db.phaseTemplate.upsert({
      where: { key: p.key },
      create: { key: p.key, workflowTemplateId: wf.id, ...data },
      update: overwrite ? data : {},
    });
    phaseIds.set(p.key, row.id);
  }
  for (const t of ALL_TASK_DEFS) {
    const phase = PHASES.find((p) => p.key === t.phaseKey)!;
    const data = {
      phaseTemplateId: phaseIds.get(t.phaseKey)!,
      kind: t.kind,
      phase: phase.phase,
      constructionPhase: phase.constructionPhase,
      order: t.order,
      name: t.name,
      durationDays: t.durationDays ?? null,
      requiresReview: t.requiresReview,
      reviewerRoleKey: t.reviewerRoleKey ?? null,
      offsetRule: (t.offsetRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      afterKey: t.afterKey ?? null,
      assigneeRoleKeys: t.assigneeRoleKeys,
      preferredRoleKeys: t.preferredRoleKeys ?? [],
      defaultAssigneeRoleKeys: t.defaultAssigneeRoleKeys ?? [],
      multiAssignee: t.multiAssignee ?? false,
      milestone: t.milestone ?? false,
    };
    await db.taskTemplate.upsert({ where: { key: t.key }, create: { key: t.key, ...data }, update: overwrite ? data : {} });
  }
}

export type PhaseTpl = {
  key: PhaseKey;
  phase: "DESIGN_1" | "DESIGN_2" | "DESIGN_3" | "DESIGN_4" | "CONSTRUCTION";
  constructionPhase: number | null;
  name: string;
  order: number;
  ownerRoleKey: string;
  taskGroup: string;
  startTrigger: StartTrigger;
};

export type TaskTpl = {
  key: string;
  phaseKey: PhaseKey;
  kind: TaskKindKey;
  phase: PhaseTpl["phase"];
  constructionPhase: number | null;
  order: number;
  name: string;
  durationDays: number | null;
  requiresReview: boolean;
  reviewerRoleKey: string | null;
  offsetRule: OffsetRule | null;
  afterKey: string | null;
  assigneeRoleKeys: string[];
  preferredRoleKeys: string[];
  defaultAssigneeRoleKeys: string[];
  multiAssignee: boolean;
  milestone: boolean;
};

export type Templates = { phases: PhaseTpl[]; phaseByKey: Map<string, PhaseTpl>; tasks: Map<string, TaskTpl> };

export async function loadTemplates(db: Db): Promise<Templates> {
  const [phaseRows, taskRows] = await Promise.all([
    db.phaseTemplate.findMany({ orderBy: { order: "asc" } }),
    db.taskTemplate.findMany({ include: { phaseTemplate: { select: { key: true } } } }),
  ]);
  if (!phaseRows.length) throw new Error("Workflow templates are missing — run `npm run db:seed` or `npm run workflow:backfill`.");
  const phases: PhaseTpl[] = phaseRows.map((p) => ({
    key: p.key as PhaseKey,
    phase: p.phase,
    constructionPhase: p.constructionPhase,
    name: p.name,
    order: p.order,
    ownerRoleKey: p.ownerRoleKey,
    taskGroup: p.taskGroup,
    startTrigger: p.startTrigger as unknown as StartTrigger,
  }));
  const tasks = new Map<string, TaskTpl>(
    taskRows.map((t) => [
      t.key,
      {
        key: t.key,
        phaseKey: t.phaseTemplate.key as PhaseKey,
        kind: t.kind,
        phase: t.phase,
        constructionPhase: t.constructionPhase,
        order: t.order,
        name: t.name,
        durationDays: t.durationDays,
        requiresReview: t.requiresReview,
        reviewerRoleKey: t.reviewerRoleKey,
        offsetRule: (t.offsetRule ?? null) as OffsetRule | null,
        afterKey: t.afterKey,
        assigneeRoleKeys: t.assigneeRoleKeys,
        preferredRoleKeys: t.preferredRoleKeys,
        defaultAssigneeRoleKeys: t.defaultAssigneeRoleKeys,
        multiAssignee: t.multiAssignee,
        milestone: t.milestone,
      },
    ]),
  );
  return { phases, phaseByKey: new Map(phases.map((p) => [p.key, p])), tasks };
}
