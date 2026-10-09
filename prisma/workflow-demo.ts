// Demo progression: plays the workflow forward for the demo projects using
// the real service functions (and therefore the real permission checks), as
// if the team had been working on them. Each project advances until today:
// tasks whose (planned + slip) date is still in the future stay open.
//
//   npm run workflow:demo     (runs automatically as part of a fresh db:seed)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { todayKey } from "../src/lib/dates";
import type { Actor } from "../src/lib/workflow/access";
import * as wf from "../src/lib/workflow/service";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Planned durations the heads "type in" for custom-date tasks (days). */
const CUSTOM_DAYS: Record<string, number> = {
  d3_interior_design: 24,
  d4_interior_drawings: 14,
  c_gf_brickwork: 21,
  c_gf_slab: 14,
  c_lintel_brickwork: 14,
  c_ff_slab: 21,
  c_plaster_gf: 14,
  c_plaster_ff: 14,
  c_plaster_ext: 12,
  c_painting_putty: 10,
  c_doors_windows: 10,
  c_tiling: 18,
  c_sanitary: 7,
  c_electrical: 10,
  c_interior_execution: 45,
  c_final_painting: 12,
};

type Plan = {
  code: string;
  /** days late vs plan when a task is approved */
  slip?: Record<string, number>;
  /** first submission is sent back once */
  rework?: Record<string, string>;
  delays?: { key: string; type: "IN_HOUSE" | "CLIENT_SIDE"; days: number; reason: string; shift?: boolean }[];
  assignees: Record<string, string>; // templateKey or "*design" / "*site" → email
  /** leave the current task of these keys IN_REVIEW instead of approving */
  leaveInReview?: string[];
};

const PLANS: Plan[] = [
  {
    code: "EPC 165",
    assignees: { "*design": "architect@example.com", d2_s1: "drafting@example.com", d2_s2: "drafting@example.com", d2_s3: "drafting@example.com", d3_interior_design: "interior@example.com", "*site": "civil@example.com", c_interior_execution: "interiorworks@example.com" },
  },
  {
    code: "EPC 168",
    slip: { c_excavation: 2, c_ff_slab: 5, c_plaster_ext: 6, c_tiling: 3 },
    rework: { c_gf_slab: "Shuttering alignment off by 20 mm on grid C — rectify before pour." },
    delays: [{ key: "c_plaster_ext", type: "CLIENT_SIDE", days: 6, reason: "Client changed the external colour scheme; waiting for revised shade card.", shift: true }],
    assignees: { "*design": "architect@example.com", d2_s1: "drafting@example.com", d2_s2: "drafting@example.com", d2_s3: "drafting@example.com", d3_interior_design: "interior@example.com", "*site": "supervisor@example.com", c_interior_execution: "interiorworks@example.com" },
    leaveInReview: ["c_electrical"],
  },
  {
    code: "EPC 171",
    slip: { d1_concept_plan: 1, d2_s4: 2, c_excavation: 4 },
    rework: { d2_s5a: "Electrical layout misses the courtyard lighting points — please add.", c_plinth_beam: "Plinth level at grid B is 15 mm low — correct before backfilling." },
    delays: [{ key: "c_excavation", type: "IN_HOUSE", days: 4, reason: "JCB breakdown — replacement arrived after 3 days." }],
    assignees: { "*design": "architect@example.com", d2_s1: "drafting@example.com", d2_s2: "drafting@example.com", d2_s3: "drafting@example.com", d3_interior_design: "interior@example.com", d4_interior_drawings: "drafting@example.com", "*site": "civil@example.com" },
  },
  {
    code: "EPC 172",
    slip: { d2_s1: 3 },
    rework: { d2_s2: "Foundation layout needs column sizes from the structural consultant." },
    delays: [{ key: "d2_s1", type: "CLIENT_SIDE", days: 3, reason: "Client asked to move the bar counter — revised brief received late.", shift: true }],
    assignees: { "*design": "interior@example.com", d2_s1: "drafting@example.com", d2_s2: "drafting@example.com", d2_s3: "drafting@example.com", d2_s4: "architect@example.com", d3_interior_design: "interior@example.com" },
    leaveInReview: ["d2_s3", "d2_s4"],
  },
];

const actors = new Map<string, Actor>();
async function actorByEmail(email: string): Promise<Actor> {
  if (!actors.has(email)) {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    actors.set(email, await wf.actorFor(prisma, u.id));
  }
  return actors.get(email)!;
}
async function actorByRole(roleKey: string): Promise<Actor> {
  const u = await prisma.user.findFirstOrThrow({ where: { role: { key: roleKey }, isActive: true }, orderBy: { createdAt: "asc" } });
  return actorByEmail(u.email);
}

async function driveProject(plan: Plan, today: Date) {
  const project = await prisma.project.findUnique({ where: { projectCode: plan.code } });
  if (!project) return null;
  const architectHead = await actorByRole("HEAD_DESIGN");
  const siteHead = await actorByRole("HEAD_SITE_OPS");
  const reworked = new Set<string>();
  const delayed = new Set<string>();
  let steps = 0;

  for (; steps < 400; steps++) {
    const tasks = await prisma.task.findMany({ where: { projectId: project.id }, include: { assignees: true }, orderBy: { order: "asc" } });
    const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id } });
    const phaseStatus = (k: string) => phases.find((p) => p.key === k)?.status;
    const phaseEnd = (k: string) => phases.find((p) => p.key === k)?.actualEnd ?? null;

    let acted = false;
    for (const t of tasks) {
      // ── Start tasks ──
      if (t.kind === "PHASE_START" && t.status === "NOT_STARTED" && phaseStatus(t.phaseKey) === "AWAITING_START") {
        const head = t.phaseKey.startsWith("CONSTRUCTION") ? siteHead : architectHead;
        let planned = t.plannedEnd;
        if (!planned && t.phaseKey === "DESIGN_3") {
          // Interior design runs in parallel: the Architect Head sets a custom start ~10 days after Phase 1.
          const d1End = phaseEnd("DESIGN_1");
          if (!d1End) continue;
          await wf.setPlannedDates(head, t.id, { plannedEnd: iso(plus(d1End, 10)) });
          acted = true;
          break;
        }
        if (!planned) continue;
        if (t.phaseKey === "CONSTRUCTION_1") {
          // Head - Site Operations plans the 18 construction tasks, then starts on kickoff.
          const kickoff = plus(planned, 7);
          if (kickoff >= today) continue;
          await planConstruction(project.id, siteHead, kickoff, plan);
          await wf.startPhase(siteHead, { taskId: t.id, startDate: iso(kickoff), kickoff: iso(kickoff) });
        } else {
          const start = plus(planned, 1);
          if (start >= today) continue;
          planned = start;
          await wf.startPhase(head, { taskId: t.id, startDate: iso(start) });
        }
        acted = true;
        break;
      }
      if (t.kind === "PHASE_START") continue;

      // ── Work ──
      if (t.status !== "IN_PROGRESS" && t.status !== "IN_REVIEW" && t.status !== "REWORK") continue;
      const tpl = await prisma.taskTemplate.findUniqueOrThrow({ where: { key: t.templateKey } });

      // Custom-date tasks get a plan from the head first.
      if (!t.plannedEnd && CUSTOM_DAYS[t.templateKey]) {
        const head = t.phase === "CONSTRUCTION" ? siteHead : architectHead;
        const start = t.actualStart ?? t.plannedStart ?? today;
        await wf.setPlannedDates(head, t.id, { plannedStart: iso(start), plannedEnd: iso(plus(start, CUSTOM_DAYS[t.templateKey])), interiorOverrideReason: "Demo data" });
        acted = true;
        break;
      }
      if (!t.plannedEnd) continue;
      const doneOn = plus(t.plannedEnd, plan.slip?.[t.templateKey] ?? 0);
      const finishBy = t.actualStart && doneOn < t.actualStart ? t.actualStart : doneOn;

      // Assign if needed.
      if (!t.assignees.length && tpl.requiresReview) {
        const email = plan.assignees[t.templateKey] ?? plan.assignees[t.phase === "CONSTRUCTION" ? "*site" : "*design"];
        if (email) {
          const head = t.phase === "CONSTRUCTION" ? siteHead : architectHead;
          const to = await actorByEmail(email);
          await wf.reassignTask(head, t.id, { toUserId: to.id });
          acted = true;
          break;
        }
      }

      // Delays flagged by the department head once a task runs late.
      const delay = plan.delays?.find((d) => d.key === t.templateKey);
      if (delay && !delayed.has(t.templateKey) && finishBy <= today) {
        delayed.add(t.templateKey);
        const head = t.phase === "CONSTRUCTION" ? siteHead : architectHead;
        await wf.flagDelay(head, t.id, { type: delay.type, reason: delay.reason, delayDays: delay.days, shiftFollowing: !!delay.shift });
        acted = true;
        break;
      }

      if (finishBy >= today) continue; // still in progress today

      if (!tpl.requiresReview) {
        const doer = t.assignees[0] ? await actorByEmail((await prisma.user.findUniqueOrThrow({ where: { id: t.assignees[0].userId } })).email) : architectHead;
        await wf.completeTask(doer, t.id, iso(finishBy));
        acted = true;
        break;
      }

      const assignee = t.assignees[0] ? await prisma.user.findUniqueOrThrow({ where: { id: t.assignees[0].userId } }) : null;
      if (!assignee) continue;
      const worker = await actorByEmail(assignee.email);
      const reviewer = t.phase === "CONSTRUCTION" ? siteHead : architectHead;

      if (t.status === "IN_PROGRESS" || t.status === "REWORK") {
        await wf.submitTask(worker, t.id, t.status === "REWORK" ? "Corrected as requested." : undefined);
        acted = true;
        break;
      }
      // IN_REVIEW
      if (plan.leaveInReview?.includes(t.templateKey) && plus(finishBy, 3) >= today) continue;
      const reason = plan.rework?.[t.templateKey];
      if (reason && !reworked.has(t.templateKey)) {
        reworked.add(t.templateKey);
        await wf.sendBackTask(reviewer, t.id, { note: reason, logDelayDays: 1 });
      } else {
        await wf.approveTask(reviewer, t.id, undefined, iso(finishBy));
      }
      acted = true;
      break;
    }
    if (!acted) break;
  }
  return steps;
}

async function planConstruction(projectId: string, siteHead: Actor, kickoff: Date, plan: Plan) {
  // Kickoff first so the auto milestones (preliminary, excavation, plinth beam) are computed…
  await wf.saveConstructionPlan(siteHead, projectId, { kickoff: iso(kickoff), rows: [] });
  const tasks = await prisma.task.findMany({ where: { projectId, phase: "CONSTRUCTION", kind: "STAGE" }, include: { assignees: true }, orderBy: { order: "asc" } });
  // …then chain the custom-date tasks from the plinth beam's planned end.
  let cursor = tasks.find((t) => t.templateKey === "c_plinth_beam")?.plannedEnd ?? plus(kickoff, 47);
  const rows: { taskId: string; plannedStart: string | null; plannedEnd: string | null; assigneeId: string | null }[] = [];
  const userId = async (email?: string) => (email ? ((await prisma.user.findUnique({ where: { email } }))?.id ?? null) : null);
  for (const t of tasks) {
    const days = CUSTOM_DAYS[t.templateKey];
    const assigneeId = await userId(plan.assignees[t.templateKey] ?? plan.assignees["*site"]);
    if (!days) {
      // auto-dated milestones / landscaping: just assign
      rows.push({ taskId: t.id, plannedStart: null, plannedEnd: null, assigneeId });
      continue;
    }
    const start = cursor;
    const end = plus(start, days);
    rows.push({ taskId: t.id, plannedStart: iso(start), plannedEnd: iso(end), assigneeId });
    cursor = end;
  }
  await wf.saveConstructionPlan(siteHead, projectId, {
    kickoff: iso(kickoff),
    rows,
    interiorOverrideReason: "Interior design runs late on this project; approved by the MD.",
  });
}

export async function runWorkflowDemo({ resume = false } = {}) {
  const today = new Date(`${todayKey()}T00:00:00Z`);
  const out: string[] = [];
  for (const plan of PLANS) {
    const p = await prisma.project.findUnique({ where: { projectCode: plan.code }, select: { id: true } });
    if (!p) continue;
    // Only drive projects still at the backfilled starting point (unless resuming a previous demo run).
    const started = await prisma.projectPhase.count({ where: { projectId: p.id, key: { not: "DESIGN_1" }, status: { in: ["ACTIVE", "COMPLETED"] } } });
    if (started && !resume) {
      out.push(`${plan.code}: already progressed — skipped`);
      continue;
    }
    const steps = await driveProject(plan, today);
    const phases = await prisma.projectPhase.findMany({ where: { projectId: p.id, status: { in: ["ACTIVE", "AWAITING_START"] } }, select: { key: true, status: true } });
    out.push(`${plan.code}: ${steps} steps → ${phases.map((x) => `${x.key} ${x.status === "ACTIVE" ? "active" : "waiting"}`).join(", ") || "all phases complete"}`);
  }
  // The simulated history produced a burst of notifications — keep only the ones about still-open work unread.
  await prisma.notification.updateMany({ where: { readAt: null, OR: [{ taskId: null }, { task: { status: "COMPLETED" } }] }, data: { readAt: new Date() } });
  return out;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/workflow-demo.ts")) {
  runWorkflowDemo({ resume: process.argv.includes("--continue") })
    .then((lines) => lines.forEach((l) => console.log("•", l)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
