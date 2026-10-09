// Loads six months of SAMPLE KPI points for every employee (owners excluded).
// Placeholder data for the KPI page — replace with real scores when available.
//
//   npm run kpi:sample

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { seedSampleKpis } from "../src/lib/kpi-sample";

async function main() {
  // Make sure the permission exists (the MD has it as super admin).
  await prisma.permission.upsert({
    where: { key: "kpi.view" },
    create: { key: "kpi.view", label: "View employee KPI points", group: "Employees" },
    update: {},
  });
  await prisma.role.update({ where: { key: "MD" }, data: { permissions: { connect: { key: "kpi.view" } } } }).catch(() => undefined);
  const r = await seedSampleKpis(prisma);
  console.log(`✓ ${r.rows} KPI rows for ${r.months[0]} … ${r.months.at(-1)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
