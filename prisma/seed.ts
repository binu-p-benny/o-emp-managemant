// Seeds the org chart (roles + permissions) and, on an empty database, demo data:
// one user per role, projects around Kochi, 3 weeks of attendance, POs, BoQ, site logs.
//
//   npm run db:seed                 → roles/permissions always; demo data only if no projects exist
//   SEED_DEMO=false npm run db:seed → roles/permissions only (use this in production)
//
// Every demo account uses DEMO_PASSWORD from src/lib/demo-accounts.ts. Change it (or skip demo data) outside development.

import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/lib/demo-accounts";
import { PERMISSIONS, PERMISSION_KEYS, ROLE_SEEDS, isSelfService } from "../src/lib/permissions";
import * as wf from "../src/lib/workflow/service";
import { runDailyReminders } from "../src/lib/workflow/reminders-runner";
import { ensureWorkflowTemplates } from "../src/lib/workflow/templates";
import { seedSampleKpis } from "../src/lib/kpi-sample";
import { backfillReportsTo, backfillWorkflow } from "./backfill-workflow";
import { runWorkflowDemo } from "./workflow-demo";

const CHECKS_IN = new Set(ROLE_SEEDS.filter((r) => r.permissions.includes("attendance.self")).map((r) => r.key));

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const TZ_OFFSET_MIN = 330; // demo data is laid out in IST
const DAY = 86_400_000;

// deterministic pseudo-random so re-seeding gives the same picture
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

function dateKey(offsetDays: number): string {
  const now = new Date(Date.now() + TZ_OFFSET_MIN * 60_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY).toISOString().slice(0, 10);
}
const dateOnly = (key: string) => new Date(`${key}T00:00:00Z`);
/** IST wall-clock time on a given date → UTC instant */
const istAt = (key: string, minutes: number) => new Date(dateOnly(key).getTime() + (minutes - TZ_OFFSET_MIN) * 60_000);

function offsetPoint(lat: number, lng: number, meters: number) {
  const bearing = rand() * 2 * Math.PI;
  return {
    lat: lat + (meters * Math.cos(bearing)) / 111_320,
    lng: lng + (meters * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(a));
}

async function seedAccess() {
  for (const key of PERMISSION_KEYS) {
    const p = PERMISSIONS[key];
    await prisma.permission.upsert({ where: { key }, create: { key, label: p.label, group: p.group }, update: { label: p.label, group: p.group } });
  }
  // create/update roles, then wire up the hierarchy
  for (const [i, r] of ROLE_SEEDS.entries()) {
    const data = {
      name: r.name,
      department: r.department,
      description: r.description,
      isSuperAdmin: r.isSuperAdmin ?? false,
      approvalLimit: r.approvalLimit ?? null,
      sortOrder: i,
    };
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    if (existing) {
      await prisma.role.update({ where: { key: r.key }, data });
    } else {
      await prisma.role.create({ data: { key: r.key, ...data, permissions: { connect: r.permissions.map((key) => ({ key })) } } });
    }
  }
  for (const r of ROLE_SEEDS) {
    const parent = r.parentKey ? await prisma.role.findUniqueOrThrow({ where: { key: r.parentKey } }) : null;
    await prisma.role.update({ where: { key: r.key }, data: { parentId: parent?.id ?? null } });
  }
  // The super admin holds every access permission; self-service duties (check-in) stay opt-in.
  await prisma.role.update({ where: { key: "MD" }, data: { permissions: { set: PERMISSION_KEYS.filter((k) => !isSelfService(k)).map((key) => ({ key })) } } });
  // Drop permissions that no longer exist in the catalogue (e.g. the old stage tracker's).
  await prisma.permission.deleteMany({ where: { key: { notIn: PERMISSION_KEYS } } });
  await ensureWorkflowTemplates(prisma);
  console.log(`✓ ${PERMISSION_KEYS.length} permissions, ${ROLE_SEEDS.length} roles`);
}

function selfieSvg(name: string, hue: number) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="hsl(${hue} 35% 85%)"/><circle cx="200" cy="165" r="80" fill="hsl(${hue} 30% 55%)"/><rect x="80" y="260" width="240" height="200" rx="110" fill="hsl(${hue} 30% 45%)"/><path d="M120 150 a80 72 0 0 1 160 0 z" fill="#facc15"/><text x="200" y="185" font-family="sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text><rect y="352" width="400" height="48" fill="rgba(17,24,39,.7)"/><text x="16" y="383" font-family="sans-serif" font-size="18" fill="#fff">Demo selfie · seed data</text></svg>`;
}

async function seedDemo() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r]));

  // ── Users ──
  const users = new Map<string, { id: string; name: string; roleKey: string }>();
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const u = await prisma.user.upsert({
      where: { email: a.email },
      create: {
        email: a.email,
        name: a.name,
        designation: a.designation,
        employeeCode: `EMP-${String(i + 1).padStart(3, "0")}`,
        phone: `+91 98470 ${String(10000 + i * 731).slice(0, 5)}`,
        passwordHash,
        roleId: roles.get(a.roleKey)!.id,
      },
      update: {},
    });
    users.set(a.email, { id: u.id, name: u.name, roleKey: a.roleKey });
  }
  const U = (email: string) => users.get(email)!.id;
  console.log(`✓ ${users.size} demo users (password: DEMO_PASSWORD in src/lib/demo-accounts.ts)`);

  // ── Projects ──
  type P = {
    code: string;
    name: string;
    stage: string;
    category: string;
    startOffset: number;
    endOffset: number;
    address: string;
    lat: number;
    lng: number;
    branch: string;
    radius: number;
    policy?: "FLAG" | "BLOCK";
    value?: number;
    orientation?: string;
    dimension?: string;
    scope?: string;
  };
  const projectDefs: P[] = [
    {
      code: "HO-ALUVA",
      name: "Oranzai Builders HQ — Thottakkattukara, Aluva",
      stage: "Ongoing",
      category: "Office / Yard",
      startOffset: -900,
      endOffset: 2000,
      address: "Thottakkattukara, Aluva, Kochi, Kerala 683108",
      lat: 10.1076,
      lng: 76.3516,
      branch: "Aluva (HQ)",
      radius: 150,
      scope: "Head office — architecture & interior design studio, accounts, HR and sales. Attendance geofence for office staff.",
    },
    {
      code: "EPC 171",
      name: "EPC 171 Mr Nidheesh & Family",
      stage: "Ongoing",
      category: "Turnkey Project",
      startOffset: -150,
      endOffset: 210,
      address: "Near Infopark Phase 1, Kakkanad, Kochi, Kerala 682042",
      lat: 10.0159,
      lng: 76.3419,
      branch: "Aluva (HQ)",
      radius: 250,
      value: 7_200_000,
      orientation: "East facing",
      dimension: "2,850 sq ft · G+1 · 12 cents",
      scope: "Design & build residence — architecture, structure, MEP, interiors and landscaping. Contemporary sloped-roof elevation with courtyard.",
    },
    {
      code: "EPC 168",
      name: "EPC 168 Dr Anjali Menon Residence",
      stage: "Ongoing",
      category: "Construction",
      startOffset: -330,
      endOffset: 100,
      address: "Ayyanthole, Thrissur, Kerala 680003",
      lat: 10.5276,
      lng: 76.2144,
      branch: "Aluva (HQ)",
      radius: 200,
      value: 9_500_000,
      orientation: "North facing",
      dimension: "3,400 sq ft · G+1 · 15 cents",
      scope: "Turnkey residence with home clinic on ground floor. Structure, finishes, interiors, landscaping.",
    },
    {
      code: "EPC 172",
      name: "EPC 172 Café Arabica Fit-out, MG Road",
      stage: "Design",
      category: "Interior Design & Fit-out",
      startOffset: -48,
      endOffset: 110,
      address: "MG Road, Ernakulam, Kochi, Kerala 682035",
      lat: 9.97,
      lng: 76.285,
      branch: "Aluva (HQ)",
      radius: 120,
      policy: "BLOCK",
      value: 2_800_000,
      orientation: "West facing (street front)",
      dimension: "1,650 sq ft · ground floor shell",
      scope: "Commercial café interior fit-out — space planning, bar counter, kitchen, lighting, furniture.",
    },
    {
      code: "EPC 174",
      name: "EPC 174 Mr Harikrishnan Residence (Enquiry)",
      stage: "Enquiry",
      category: "Architectural Design",
      startOffset: -6,
      endOffset: 380,
      address: "Chevayur, Kozhikode, Kerala 673017",
      lat: 11.2876,
      lng: 75.8186,
      branch: "Aluva (HQ)",
      radius: 250,
      value: 6_000_000,
      dimension: "~2,400 sq ft · G+1 (proposed)",
      scope: "New residence — site survey done, concept plan in progress.",
    },
    {
      code: "EPC 165",
      name: "EPC 165 Joseph Villa Renovation",
      stage: "Completed",
      category: "Renovation",
      startOffset: -420,
      endOffset: -40,
      address: "Kadungalloor, Aluva, Kerala 683110",
      lat: 10.0993,
      lng: 76.3286,
      branch: "Aluva (HQ)",
      radius: 300,
      value: 3_100_000,
      orientation: "South facing",
      dimension: "1,900 sq ft · single storey",
      scope: "Renovation — new roof, kitchen, bathrooms, flooring and repainting.",
    },
  ];

  const projects = new Map<string, { id: string; lat: number; lng: number; radius: number; code: string }>();
  const today = dateKey(0);
  for (const p of projectDefs) {
    const start = dateOnly(dateKey(p.startOffset));
    const created = await prisma.project.create({
      data: {
        projectCode: p.code,
        projectName: p.name,
        projectStage: p.stage,
        projectCategory: p.category,
        startDate: start,
        endDate: dateOnly(dateKey(p.endOffset)),
        address: p.address,
        latitude: p.lat,
        longitude: p.lng,
        companyBranch: p.branch,
        attendanceRadius: p.radius,
        outOfRangePolicy: p.policy ?? "FLAG",
        projectValue: p.value ?? null,
        orientation: p.orientation ?? null,
        dimension: p.dimension ?? null,
        scopeOfWork: p.scope ?? null,
      },
    });
    projects.set(p.code, { id: created.id, lat: p.lat, lng: p.lng, radius: p.radius, code: p.code });
  }
  console.log(`✓ ${projects.size} projects`);

  // ── Members & main projects ──
  const P = (code: string) => projects.get(code)!.id;
  const assignments: [string, string, string, boolean][] = [
    // email, project, project role, main?
    ["site.head@example.com", "EPC 171", "Project Manager", true],
    ["site.head@example.com", "EPC 168", "Project Manager", false],
    ["site.head@example.com", "EPC 165", "Project Manager", false],
    ["civil@example.com", "EPC 171", "Site Engineer", true],
    ["civil@example.com", "EPC 168", "Structural Engineer", false],
    ["supervisor@example.com", "EPC 168", "Site Supervisor", true],
    ["interiorworks@example.com", "EPC 172", "Interior Site Engineer", true],
    ["interiorworks@example.com", "EPC 168", "Interior Site Engineer", false],
    ["design.head@example.com", "HO-ALUVA", "Principal Architect", true],
    ["design.head@example.com", "EPC 171", "Lead Architect", false],
    ["design.head@example.com", "EPC 172", "Design Lead", false],
    ["design.head@example.com", "EPC 174", "Lead Architect", false],
    ["architect@example.com", "HO-ALUVA", "Architect", true],
    ["architect@example.com", "EPC 171", "Project Architect", false],
    ["architect@example.com", "EPC 174", "Project Architect", false],
    ["interior@example.com", "HO-ALUVA", "Interior Designer", true],
    ["interior@example.com", "EPC 172", "Interior Designer", false],
    ["interior@example.com", "EPC 171", "Interior Designer", false],
    ["drafting@example.com", "HO-ALUVA", "Draughtsman", true],
    ["drafting@example.com", "EPC 171", "Draughtsman", false],
    ["drafting@example.com", "EPC 168", "Draughtsman", false],
    ["hr@example.com", "HO-ALUVA", "HR & Admin", true],
    ["sales@example.com", "HO-ALUVA", "Business Development", true],
    ["sales@example.com", "EPC 174", "Client Relations", false],
    ["accounts@example.com", "HO-ALUVA", "Accounts", true],
    ["partner@example.com", "HO-ALUVA", "Managing Partner", false],
    ["procurement@example.com", "HO-ALUVA", "Procurement", true],
    ["costing@example.com", "HO-ALUVA", "Quantity Surveyor", true],
    ["costing@example.com", "EPC 171", "Quantity Surveyor", false],
    ["md@example.com", "HO-ALUVA", "Managing Director", false],
  ];
  for (const [email, code, projectRole, main] of assignments) {
    await prisma.projectMember.create({ data: { userId: U(email), projectId: P(code), projectRole } });
    if (main) await prisma.user.update({ where: { id: U(email) }, data: { mainProjectId: P(code) } });
  }

  // ── Location structure ──
  const tree = async (code: string, nodes: [string, string, [string, string, string[]][]][]) => {
    let order = 0;
    for (const [type, name, children] of nodes) {
      const parent = await prisma.projectLocation.create({ data: { projectId: P(code), name, type, sortOrder: order++ } });
      for (const [ctype, cname, rooms] of children) {
        const child = await prisma.projectLocation.create({ data: { projectId: P(code), parentId: parent.id, name: cname, type: ctype, sortOrder: order++ } });
        for (const room of rooms) await prisma.projectLocation.create({ data: { projectId: P(code), parentId: child.id, name: room, type: "Room", sortOrder: order++ } });
      }
    }
  };
  await tree("EPC 171", [
    ["Block", "Block A — Main house", [["Floor", "Ground Floor", ["Living", "Dining", "Kitchen", "Bedroom 1", "Courtyard"]], ["Floor", "First Floor", ["Bedroom 2", "Bedroom 3", "Family Lounge", "Balcony"]]]],
    ["Block", "Block B — Car porch & utility", [["Zone", "Utility", ["Work area", "Store"]]]],
  ]);
  await tree("EPC 172", [["Zone", "Café floor", [["Area", "Front of house", ["Seating", "Bar counter"]], ["Area", "Back of house", ["Kitchen", "Washrooms", "Store"]]]]]);
  await tree("EPC 168", [["Block", "Residence", [["Floor", "Ground Floor", ["Clinic", "Living", "Kitchen"]], ["Floor", "First Floor", ["Bedrooms", "Terrace"]]]]]);

  // ── Selfie placeholders ──
  const storageRoot = path.resolve(process.env.STORAGE_DIR || "./storage");
  const selfieUrl = new Map<string, string>();
  let hue = 10;
  for (const [, u] of users) {
    const key = `selfies/${u.id}/seed.svg`;
    await fs.mkdir(path.join(storageRoot, path.dirname(key)), { recursive: true });
    await fs.writeFile(path.join(storageRoot, key), selfieSvg(u.name, (hue += 47) % 360));
    selfieUrl.set(u.id, `/api/files/${key}`);
  }

  // ── Attendance: last 21 days + this morning ──
  const offsiteLabels = ["Vendor yard, Kalamassery", "Cement godown, Aluva", "Client's office, Kaloor", "Tile showroom, Palarivattom", "Home — WFH", "Hardware store, Vyttila"];
  const reviewerFor: Record<string, string> = {
    CIVIL_WORKS: "site.head@example.com",
    INTERIOR_WORKS: "site.head@example.com",
    HEAD_SITE_OPS: "md@example.com",
    AR_DESIGN: "design.head@example.com",
    INTERIOR_DESIGN: "design.head@example.com",
    DRAFTING: "design.head@example.com",
  };
  const nowMs = Date.now();
  let count = 0;
  const mainOf = new Map((await prisma.user.findMany({ select: { id: true, mainProjectId: true } })).map((u) => [u.id, u.mainProjectId]));
  const byId = new Map([...projects.values()].map((p) => [p.id, p]));

  for (const [email, u] of users) {
    if (!CHECKS_IN.has(u.roleKey)) continue; // owners (MD, Managing Partner) have no check-in duty
    const project = byId.get(mainOf.get(u.id)!);
    if (!project) continue;
    for (let d = -21; d <= 0; d++) {
      const key = dateKey(d);
      if (dateOnly(key).getUTCDay() === 0) continue; // Sunday
      if (d === 0 && email === "civil@example.com") continue; // leave for a live check-in demo
      if (d < 0 && rand() < 0.08) continue; // leave / absent

      const outOfRange = rand() < (u.roleKey.startsWith("HEAD") ? 0.04 : 0.1) && project.code !== "EPC 172";
      const inPt = outOfRange ? offsetPoint(project.lat, project.lng, 400 + rand() * 1800) : offsetPoint(project.lat, project.lng, rand() * project.radius * 0.6);
      const dist = haversine(inPt.lat, inPt.lng, project.lat, project.lng);
      const inAt = istAt(key, 8 * 60 + 35 + Math.floor(rand() * 60));
      if (inAt.getTime() > nowMs) continue;

      const recent = d >= -3;
      const reviewStatus = !outOfRange ? "NOT_REQUIRED" : recent ? "PENDING" : rand() < 0.8 ? "APPROVED" : "REJECTED";
      const reviewer = reviewerFor[u.roleKey] ?? "hr@example.com";
      const checkIn = await prisma.attendance.create({
        data: {
          userId: u.id,
          projectId: project.id,
          type: "CHECK_IN",
          selfieUrl: selfieUrl.get(u.id)!,
          latitude: inPt.lat,
          longitude: inPt.lng,
          accuracyMeters: 5 + Math.round(rand() * 25),
          locationLabel: outOfRange ? pick(offsiteLabels) : `${project.code} site`,
          distanceMeters: dist,
          radiusMeters: project.radius,
          inRange: !outOfRange,
          timestamp: inAt,
          deviceInfo: "Seed data",
          reviewStatus,
          ...(reviewStatus === "APPROVED" || reviewStatus === "REJECTED"
            ? {
                reviewedById: U(reviewer),
                reviewedAt: new Date(inAt.getTime() + 3 * 3_600_000),
                reviewNote: reviewStatus === "APPROVED" ? "Material pickup — confirmed by phone" : "No site visit scheduled; marked as absent",
              }
            : {}),
        },
      });
      count++;

      const outAt = istAt(key, 17 * 60 + 20 + Math.floor(rand() * 75));
      if (outAt.getTime() > nowMs) continue;
      const outPt = offsetPoint(project.lat, project.lng, rand() * project.radius * 0.7);
      await prisma.attendance.create({
        data: {
          userId: u.id,
          projectId: project.id,
          type: "CHECK_OUT",
          selfieUrl: selfieUrl.get(u.id)!,
          latitude: outPt.lat,
          longitude: outPt.lng,
          accuracyMeters: 5 + Math.round(rand() * 25),
          locationLabel: `${project.code} site`,
          distanceMeters: haversine(outPt.lat, outPt.lng, project.lat, project.lng),
          radiusMeters: project.radius,
          inRange: true,
          timestamp: outAt,
          deviceInfo: "Seed data",
          checkInId: checkIn.id,
        },
      });
      count++;
    }
  }
  console.log(`✓ ${count} attendance records`);

  // ── Site logs ──
  const work171 = [
    "Excavation completed for footings F1–F8; soil found hard at 1.5 m.",
    "PCC 1:4:8 laid for footings F1–F8. Curing in progress.",
    "Footing reinforcement checked by structural engineer; concreting done for F1–F4.",
    "Column starters up to plinth level for grid A & B. Shuttering for plinth beam started.",
    "Plinth beam concreting completed (M25, 6.2 cum). Curing started.",
    "Plinth filling with quarry dust in progress; compaction in 15 cm layers.",
  ];
  const work168 = [
    "Internal plastering — first floor bedrooms completed.",
    "Flooring: vitrified tiles laid in living & dining (620 sqft).",
    "Electrical wiring pulled for ground floor; DB fixed.",
    "Bathroom wall tiling — 2 of 4 bathrooms completed.",
    "Door frames fixed for first floor; window shutters received.",
  ];
  for (let i = 0; i < 6; i++) {
    await prisma.siteLog.create({
      data: { projectId: P("EPC 171"), authorId: U("civil@example.com"), date: dateOnly(dateKey(-(6 - i) * 2)), weather: pick(["Sunny", "Cloudy", "Light rain"]), manpower: 8 + Math.floor(rand() * 10), workDone: work171[i], issues: i === 3 ? "TMT 12 mm short by 400 kg — PO raised." : null },
    });
  }
  for (let i = 0; i < 5; i++) {
    await prisma.siteLog.create({
      data: { projectId: P("EPC 168"), authorId: U("supervisor@example.com"), date: dateOnly(dateKey(-(5 - i) * 2)), weather: pick(["Sunny", "Cloudy", "Heavy rain"]), manpower: 10 + Math.floor(rand() * 8), workDone: work168[i], issues: i === 1 ? "Heavy rain — external plastering stopped." : null },
    });
  }

  // ── BoQ ──
  const boq171: [string, string, string, string, number, number][] = [
    ["Civil", "C-01", "Earthwork excavation in foundation", "cum", 142, 450],
    ["Civil", "C-02", "PCC 1:4:8 below footings", "cum", 18.5, 6200],
    ["Structural", "S-01", "RCC M25 for footings & columns", "cum", 38, 8900],
    ["Structural", "S-02", "RCC M25 for beams & slabs", "cum", 64, 9400],
    ["Structural", "S-03", "Fe500 TMT reinforcement", "kg", 9800, 78],
    ["Masonry", "M-01", "Solid block masonry 20 cm", "cum", 96, 6100],
    ["Finishes", "F-01", "Internal plastering 12 mm", "sqm", 820, 310],
    ["Finishes", "F-02", "Vitrified tile flooring 800×800", "sqm", 240, 1450],
    ["Electrical", "E-01", "Concealed wiring — points", "nos", 165, 1150],
    ["Plumbing", "P-01", "CPVC water supply & SWR drainage", "LS", 1, 285000],
    ["Interior", "I-01", "Modular kitchen (marine ply, acrylic)", "rmt", 7.5, 42000],
    ["Interior", "I-02", "Wardrobes (3 nos)", "sqft", 210, 1650],
    ["Landscape", "L-01", "Courtyard landscaping & paving", "LS", 1, 180000],
  ];
  for (const [i, [section, itemCode, description, unit, quantity, rate]] of boq171.entries()) {
    await prisma.boqItem.create({ data: { projectId: P("EPC 171"), section, itemCode, description, unit, quantity, rate, sortOrder: i } });
  }
  const boq172: [string, string, string, number, number][] = [
    ["Interior", "Bar counter with quartz top", "rmt", 6, 38000],
    ["Interior", "Gypsum false ceiling with cove", "sqm", 140, 1100],
    ["Electrical", "Decorative & track lighting", "LS", 1, 240000],
    ["Finishes", "Epoxy flooring", "sqm", 150, 950],
    ["Interior", "Loose furniture — 48 covers", "LS", 1, 620000],
  ];
  for (const [i, [section, description, unit, quantity, rate]] of boq172.entries()) {
    await prisma.boqItem.create({ data: { projectId: P("EPC 172"), section, description, unit, quantity, rate, sortOrder: i } });
  }

  // ── Vendors & purchase orders ──
  const vendors = new Map<string, string>();
  for (const [name, category, contactPerson, phone] of [
    ["Malabar Cements & Steels", "Cement & Steel", "Shibu K", "+91 94470 11223"],
    ["Periyar Aggregates", "Aggregates", "Rajan P", "+91 94460 22334"],
    ["Kerala Tiles Gallery", "Tiles & Sanitary", "Noushad M", "+91 98950 33445"],
    ["Volt Electricals", "Electrical", "Biju Thomas", "+91 97440 44556"],
    ["WoodCraft Interiors", "Joinery", "Prakash V", "+91 90370 55667"],
  ] as const) {
    const v = await prisma.vendor.create({ data: { name, category, contactPerson, phone, gstin: `32AAB${Math.floor(rand() * 1e5)}C1Z${Math.floor(rand() * 9)}` } });
    vendors.set(name, v.id);
  }
  const R = (key: string) => roles.get(key)!.id;
  const year = new Date().getFullYear();
  const pos: {
    project: string;
    vendor: string;
    description: string;
    amount: number;
    by: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    awaiting?: string;
    trail: [string, string, "APPROVED" | "ESCALATED" | "REJECTED", string | null][];
    daysAgo: number;
  }[] = [
    { project: "EPC 171", vendor: "Malabar Cements & Steels", description: "OPC 53 grade cement — 400 bags", amount: 164_000, by: "civil@example.com", status: "PENDING", awaiting: "HEAD_SITE_OPS", trail: [], daysAgo: 1 },
    {
      project: "EPC 168",
      vendor: "Kerala Tiles Gallery",
      description: "Vitrified tiles 800×800 — 2,400 sqft incl. skirting",
      amount: 310_000,
      by: "supervisor@example.com",
      status: "PENDING",
      awaiting: "MD",
      trail: [["site.head@example.com", "HEAD_SITE_OPS", "ESCALATED", "Rates checked against last order — OK"]],
      daysAgo: 2,
    },
    { project: "EPC 171", vendor: "Malabar Cements & Steels", description: "Fe500 TMT 8/10/12 mm — 3.2 MT", amount: 224_000, by: "procurement@example.com", status: "APPROVED", trail: [["md@example.com", "MD", "APPROVED", null]], daysAgo: 9 },
    {
      project: "EPC 172",
      vendor: "WoodCraft Interiors",
      description: "Bar counter & back-bar joinery — factory made",
      amount: 480_000,
      by: "interiorworks@example.com",
      status: "APPROVED",
      trail: [
        ["site.head@example.com", "HEAD_SITE_OPS", "ESCALATED", null],
        ["md@example.com", "MD", "APPROVED", "Go ahead — 40% advance"],
      ],
      daysAgo: 6,
    },
    { project: "EPC 168", vendor: "Volt Electricals", description: "Modular switches, DB & MCBs — ground floor", amount: 48_500, by: "supervisor@example.com", status: "APPROVED", trail: [["site.head@example.com", "HEAD_SITE_OPS", "APPROVED", null]], daysAgo: 12 },
    { project: "EPC 171", vendor: "Periyar Aggregates", description: "M-sand — 20 loads", amount: 96_000, by: "civil@example.com", status: "REJECTED", trail: [["site.head@example.com", "HEAD_SITE_OPS", "REJECTED", "Rate above contracted ₹4,200/load — get re-quote"]], daysAgo: 4 },
  ];
  for (const [i, po] of pos.entries()) {
    const createdAt = new Date(nowMs - po.daysAgo * DAY);
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${year}-${String(i + 1).padStart(3, "0")}`,
        projectId: P(po.project),
        vendorId: vendors.get(po.vendor)!,
        description: po.description,
        amount: po.amount,
        status: po.status,
        createdById: U(po.by),
        awaitingRoleId: po.awaiting ? R(po.awaiting) : null,
        createdAt,
        approvals: {
          create: po.trail.map(([email, roleKey, decision, note], j) => ({
            approverId: U(email),
            roleId: R(roleKey),
            decision,
            note,
            createdAt: new Date(createdAt.getTime() + (j + 1) * 5 * 3_600_000),
          })),
        },
      },
    });
  }
  console.log(`✓ site logs, BoQ, ${vendors.size} vendors, ${pos.length} purchase orders`);

  // ── Workflow ──
  // Line managers from the org chart.
  await backfillReportsTo();
  // EPC 174 is a fresh enquiry: Design Phase 1 runs live from its start date.
  await prisma.$transaction((tx) => wf.initProjectWorkflow(tx, P("EPC 174")), { timeout: 60_000 });
  const md = await wf.actorFor(prisma, U("md@example.com"));
  const archHead = await wf.actorFor(prisma, U("design.head@example.com"));
  const siteVisit = await prisma.task.findUniqueOrThrow({ where: { projectId_templateKey: { projectId: P("EPC 174"), templateKey: "d1_site_visit" } } });
  await wf.completeTask(md, siteVisit.id, dateKey(-5));
  const concept = await prisma.task.findUniqueOrThrow({ where: { projectId_templateKey: { projectId: P("EPC 174"), templateKey: "d1_concept_plan" } } });
  await wf.reassignTask(archHead, concept.id, { toUserId: U("architect@example.com") });
  // Older projects: Design Phase 1 backfilled as complete, then played forward to today.
  const backfill = await backfillWorkflow();
  console.log(`✓ workflow: backfilled ${backfill.backfilled.join(", ")}`);
  for (const line of await runWorkflowDemo()) console.log(`  · ${line}`);
  const reminders = await runDailyReminders();
  console.log(`✓ reminders: ${reminders.sent} notifications`);
  const kpis = await seedSampleKpis(prisma);
  console.log(`✓ ${kpis.rows} sample KPI rows (${kpis.months[0]} … ${kpis.months.at(-1)})`);
}

async function main() {
  await seedAccess();
  if (process.env.SEED_DEMO === "false") return;
  if ((await prisma.project.count()) > 0) {
    console.log("• Projects already exist — skipping demo data. (Run `npm run workflow:backfill` to add workflows to existing projects.)");
    return;
  }
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
