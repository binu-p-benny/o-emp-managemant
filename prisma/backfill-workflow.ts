// Backfill for projects that existed before the workflow engine:
//   • seeds the workflow templates (create-only; pass --reset-templates to overwrite edits)
//   • fills User.reportsToId from the org chart where it's missing
//   • for every project without a workflow: Design Phase 1 → completed, and a
//     pending "Start Design Phase 2" task assigned to the Architect Head
//     (Head - Architectural Designs). Phase 2 is NOT started automatically.
// Idempotent — safe to run more than once.
//
//   npm run workflow:backfill

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { backfillProjectWorkflow } from "../src/lib/workflow/service";
import { ensureWorkflowTemplates } from "../src/lib/workflow/templates";

export async function backfillReportsTo() {
  const users = await prisma.user.findMany({ where: { reportsToId: null }, include: { role: { select: { parentId: true } } } });
  let n = 0;
  for (const u of users) {
    if (!u.role.parentId) continue;
    const manager = await prisma.user.findFirst({ where: { roleId: u.role.parentId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (manager && manager.id !== u.id) {
      await prisma.user.update({ where: { id: u.id }, data: { reportsToId: manager.id } });
      n++;
    }
  }
  return n;
}

export async function backfillWorkflow({ resetTemplates = false } = {}) {
  await ensureWorkflowTemplates(prisma, { overwrite: resetTemplates });
  const managers = await backfillReportsTo();
  const projects = await prisma.project.findMany({ where: { phases: { none: {} } }, select: { id: true, projectCode: true }, orderBy: { projectCode: "asc" } });
  const done: string[] = [];
  for (const p of projects) {
    const changed = await prisma.$transaction((tx) => backfillProjectWorkflow(tx, p.id), { timeout: 60_000, maxWait: 10_000 });
    if (changed) done.push(p.projectCode);
  }
  return { managers, backfilled: done };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/backfill-workflow.ts")) {
  backfillWorkflow({ resetTemplates: process.argv.includes("--reset-templates") })
    .then((r) => {
      console.log(`✓ workflow templates ready`);
      console.log(`✓ line managers filled: ${r.managers}`);
      console.log(r.backfilled.length ? `✓ backfilled ${r.backfilled.length} project(s): ${r.backfilled.join(", ")}` : "• no projects needed a backfill");
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
