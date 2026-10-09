# Oranzai Builders · Work Hub

*Premium. Affordable. Luxury.* — KPI-focused work & employee management for [Oranzai Builders](https://oranzaibuilders.com/) (Thottakkattukara, Aluva, Kochi): role-based access mirroring the org chart, geo-fenced selfie attendance, and project tracking across the company's service lines — architecture, turnkey projects, interiors and construction — from enquiry to handover.

Branding (name, tagline, emerald #134332 / gold #A47A2C palette, DM Serif display type) lives in [src/lib/config.ts](src/lib/config.ts) and the `@theme` tokens in [src/app/globals.css](src/app/globals.css). The emblem in [src/components/logo.tsx](src/components/logo.tsx) is a placeholder in the brand colours — swap in the official logo file when available.

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL · Prisma 7 · Auth.js v5 (credentials + JWT) · Tailwind CSS 4 · Leaflet/OpenStreetMap · S3-compatible storage (optional).

## Quick start

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npx prisma migrate dev        # creates the database + tables
npm run db:seed               # roles, permissions and demo data
npm run dev                   # http://localhost:3000
```

Demo accounts (one per box on the org chart) are listed on the login page when `NEXT_PUBLIC_SHOW_DEMO_LOGINS=true` — click one to sign in as that role. They all share `DEMO_PASSWORD` from [src/lib/demo-accounts.ts](src/lib/demo-accounts.ts); turn demo logins off in production.

| Account | Role |
|---|---|
| md@example.com | Managing Director · **Owner** (super admin) |
| partner@example.com | Managing Partner · **Owner** |
| hr@example.com · sales@ · accounts@ | HR cum Admin · Sales · Accounts |
| design.head@ · architect@ · interior@ · drafting@ | Head – Architectural Designs and team |
| site.head@ · civil@ · supervisor@ · interiorworks@ | Head – Site Operations and team |
| procurement@ · costing@ | Head – Procurement · Head – Costing |

`civil@example.com` is left without a check-in today, so you can try the attendance flow as that user.

### Testing check-in on a phone

Camera and GPS only work in a **secure context** (HTTPS or `localhost`). To test from a phone on your LAN:

```bash
npx next dev --experimental-https -H 0.0.0.0
```

Then open `https://<your-pc-ip>:3000` on the phone and accept the self-signed certificate. In production, serve the app over HTTPS.

## What's in the box

### 1. Role-based access (RBAC)
- Every box on the org chart is a `Role` with a parent, so the hierarchy is data, not code. Defaults are in [src/lib/permissions.ts](src/lib/permissions.ts).
- **Permissions** decide which menu items and modules appear, plus what a user can do (e.g. `attendance.review`, `projects.edit`, `procurement.po.approve`).
- **Visibility** has three levels: "all" permissions or super admin see everything; heads see everyone in their **org-chart subtree**; everyone else sees only their own records and assigned projects.
- **Owners (MD & Managing Partner) don't check in.** Checking in (`attendance.self`) is a *duty*, not an access right, so even super admin doesn't imply it. Owners see everyone's work and attendance, and are left out of headcounts, attendance rates and registers.
- The **MD** is the super admin. Under **Roles & Access** they can edit any role's permissions, reporting line and PO approval limit. Changes apply on the next page load.
- The login screen has hand-drawn construction illustrations for each department context (site, design studio, office, procurement & costing). The dashboard banner uses the signed-in user's department scene.

### 2. Attendance
- **Check-in/out** (`/attendance/check-in`) uses a live camera selfie with no file upload. The capture time, GPS coordinates and distance are burned into the image. Captures older than 3 minutes are rejected.
- GPS is read with `watchPosition` (high accuracy), and its accuracy is stored. A best-effort place name is pre-filled as the employee's "attendance location", and the employee can edit it.
- The **server** recomputes the haversine distance to the project and compares it with the project's **Attendance Radius**. Each project chooses its out-of-range policy: **Flag** (allow, then queue for review) or **Block** (refuse the check-in).
- Check-ins default to the employee's **main project** (set on the Members tab or the employee form). Employees can pick any other project they're assigned to.
- **Views:**
  - **My Attendance:** day, week or month calendar.
  - **Team Attendance:** day table, or a week/month register with day/hour totals.
  - **Review Queue:** selfie plus a map showing the project pin, radius circle and employee pin, with approve/reject. A reject needs a note.
- **CSV export** follows the current filters and is scoped to what the viewer can see.

### 3. Projects
- **Add/Edit** uses the *Project Setting* layout with three tabs: **Project Details**, **Members** and **Location Structure**.
- Project Details adds **latitude/longitude**, set from a map picker. You can search the address, click the map, drag the pin, or use "My location". A live circle previews the attendance radius.
- **List** offers filters (stage, category, branch, team/role, text), a table on desktop with cards on mobile, a map view of all sites, and workflow progress per project.
- The **View** page has KPI tiles plus tabs:
  - **Overview:** all fields, plus a map with the radius circle and today's check-ins.
  - **Workflow:** the phase-by-phase workflow (see section 6), with planned vs actual dates, AUTO/CUSTOM chips, reviews and delays.
  - **Attendance**, **Members**, **Location Structure**, **Site Logs**, **BoQ** and **Purchase Orders**.
- Project categories follow Oranzai's service lines: Turnkey Project, Construction, Architectural Design, Interior Design & Fit-out, Renovation, Survey & Valuation.
- Projects with category **Office / Yard** (e.g. HQ at Aluva) are attendance geofences only. They have no workflow.

### 4. Department modules
- **Site Logs:** daily work done, manpower, weather and issues per project.
- **Costing & BoQ:** BoQ items per project, with section totals and estimate vs. project value.
- **Procurement:** vendors, plus purchase orders with an **approval chain up the org chart**:
  - A PO goes first to the nearest role above the person who raised it that can approve POs.
  - If the amount is within that role's limit, the PO is approved. Otherwise it is endorsed and escalated to the next role up. The MD can approve anything.
  - Default limits: Site Ops ₹2L, Procurement ₹5L, Managing Partner ₹10L.

### 5. Dashboards
All dashboards are scoped by role:
- **MD / Managing Partner:** company-wide KPIs.
- **Heads:** their team.
- **Employees:** their own attendance and assigned projects.

KPIs include present today, on-site rate, items awaiting review, hours, a 14-day on-site headcount chart, active projects with current phase and overdue stages, and a "needs attention" list.

### 6. Workflow engine (Enquiry → Design → Construction)
Template-driven phases, Start handoffs, review/rework, delays and reminders. Design notes and every assumption made are in [docs/workflow-engine.md](docs/workflow-engine.md).

- **Phases:** Design 1 (enquiry → elevation, day 0/+10/+15/+22/+30) → Design 2 (S1–S5-B, sequential) → **Approve design** → Construction 1–4. Design 3–4 (interior) run in parallel.
- **Start handoffs:** a phase never starts by itself. When one ends, a "Start <next phase>" task goes to the owning head (Head - Architectural Designs or Head - Site Operations), and their **Start phase** click sets the actual start.
- **Dates:** every task has a planned and an actual date.
  - AUTO dates come from offset rules and are recalculated when anchors move: start date, phase start, kickoff, excavation's actual end.
  - Setting a date by hand makes it CUSTOM, keeps the original auto value and who changed it, and can be reset to auto.
- **Review:** the assignee submits for review; the reviewer approves, or sends it back with a reason (counted as rework, optionally logged as a delay). Nothing downstream starts while a task is in review or rework.
- **Delays:** in-house, client-side or rework, each with a reason and days. A client-side delay can (on request) shift the following tasks.
- **Screens:**
  - **My Tasks**
  - **Design Desk** and **Construction Desk**, for the heads: Start tasks, approvals, the 18-task construction planner, team tasks and workload
  - **Task Reviews**
  - the **notification bell** and **Notifications** page
  - **Settings** (MD only: reminder time and thresholds)
- **Reminders:** a daily job (09:00 Asia/Kolkata by default) sends due-soon, due-today, overdue, escalation (head > 3 days, MD > 7 days), review-waiting and start-waiting notifications, at most one per task, type, person and day.

| Command | What it does |
|---|---|
| `npm test` | Unit tests: date engine, review workflow, phase gating, reminders |
| `npm run workflow:backfill` | Adds workflows to pre-existing projects (Design Phase 1 complete, "Start Design Phase 2" pending for the Architect Head). Idempotent. |
| `npm run workflow:demo` | Plays the demo projects forward through the real service (runs during a fresh `db:seed`) |

### 7. Employee KPIs (MD)
**Departments → Employee KPIs** (`/kpi`, permission `kpi.view`, which only the MD has by default; grant it to other roles from Roles & Access).

- **Ranking page:** each employee's KPI points out of 100 for a chosen month, with rating, change from last month, a 6-month trend, and four metric scores: attendance & punctuality /20, tasks on time /30, quality /25, and a role-specific KPI /25. It can be filtered by month and department.
- **Detail page:** `/kpi/[id]` shows one employee's breakdown, monthly chart and remarks.
- Owners (MD, Managing Partner) are not scored.

The points are stored per employee per month in `EmployeeKpi` and are **sample data**. The app does not calculate them yet. `npm run kpi:sample` reloads six months of placeholder scores, and a fresh `db:seed` loads them too.

## Configuration

See [.env.example](.env.example). The key settings:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. URL-encode special characters in the password. |
| `AUTH_SECRET` | Auth.js signing secret (`npx auth secret`) |
| `APP_TIMEZONE` | Day boundaries for "today" and the daily/weekly/monthly views (default `Asia/Kolkata`) |
| `S3_*` | Set `S3_BUCKET` to store selfies in S3 / R2 / MinIO. Otherwise files go to `./storage`. Files are always served through an auth-checked route, never publicly. |
| `NEXT_PUBLIC_MAP_TILE_URL` | Tile server. Defaults to OpenStreetMap; use a commercial provider (MapTiler, Mapbox raster, etc.) for production traffic. |
| `NEXT_PUBLIC_COMPANY_BRANCHES` | Options for the Company Branch dropdown |
| `REMINDERS_SCHEDULER` | `off` disables the in-process daily reminder job (then call `/api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`) |
| `CRON_SECRET` | Shared secret for the external reminder endpoint |

## Production checklist
- Run `npx prisma migrate deploy`, then `SEED_DEMO=false npm run db:seed` (roles, permissions and workflow templates only). Create the MD account, then add employees from the app. For projects created before the workflow engine, run `npm run workflow:backfill` once.
- Set `NEXT_PUBLIC_SHOW_DEMO_LOGINS=false`.
- Serve over HTTPS, which camera and GPS require.
- Configure S3-compatible storage and a map tile provider.

## Project layout

```
prisma/schema.prisma        data model (roles, users, projects, workflow, attendance, BoQ, POs…)
prisma/seed.ts              org chart + demo data
prisma/backfill-workflow.ts workflow backfill for existing projects
src/auth.ts                 Auth.js config
src/lib/permissions.ts      permission catalogue + default role matrix
src/lib/scope.ts            row-level visibility (team subtree, assigned projects)
src/lib/workflow/           workflow engine: template, date engine, state machine, reminders, service, queries
docs/workflow-engine.md     workflow design notes & assumptions
src/app/api/attendance      check-in/out endpoint (geofence check) + CSV export
src/app/api/files           auth-checked file streaming (selfies)
src/app/(app)/…             pages: dashboard, attendance, projects, employees, modules, admin
src/actions/…               server actions
src/components/…            UI kit, maps (Leaflet), project form, illustrations
```
