# Workflow engine: design notes & assumptions

The Enquiry → Design → Construction flow is template data (`WorkflowTemplate → PhaseTemplate → TaskTemplate`). Each project gets real `Task` rows as it reaches each phase.

| Piece | Where |
|---|---|
| Default template (offsets, durations, pools, review flags) | `src/lib/workflow/template-def.ts`, seeded into the DB |
| Date engine (`computePlannedDates`) | `src/lib/workflow/dates.ts` |
| State machine (review transitions, phase gating) | `src/lib/workflow/engine.ts` |
| Reminder rules | `src/lib/workflow/reminders.ts` (runner: `reminders-runner.ts`) |
| Permissions | `src/lib/workflow/access.ts` (enforced in `service.ts`) |
| All mutations (transactional) | `src/lib/workflow/service.ts` |
| Read models for the UI | `src/lib/workflow/queries.ts` |
| Unit tests | `src/lib/workflow/*.test.ts` (`npm test`) |
| Backfill for existing projects | `prisma/backfill-workflow.ts` (`npm run workflow:backfill`) |

The database copy of the template is the source of truth after seeding. Edit durations, offsets, review flags or pools there (e.g. with `npm run db:studio`); projects pick up the changes as tasks are generated. `npm run workflow:backfill -- --reset-templates` restores the defaults.

## Assumptions made

### Roles
1. **No Visualizer role exists**, and the brief says to use existing roles only. Elevation tasks therefore use the pool "anyone under the Architect Head" (Ar Design, Interior Design, Drafting). A visualizer is just a user in one of those roles; use their designation to tell them apart.
2. **Templates name roles by their stable key** (`HEAD_DESIGN`, `HEAD_SITE_OPS`, …) rather than the role's database id, so they survive re-seeding. This applies to `reviewerRoleKey`, `assigneeRoleKeys`, `preferredRoleKeys` and the phase `ownerRoleKey`.
3. **"Team under a head"** uses the new `User.reportsToId`. It was backfilled from the org chart (the first active user in the parent role) and can be edited on the employee form.
   - An assignee can hand a task only to someone with the same line manager who is also in the task's pool.
   - A head (or the MD) can assign anyone in the pool.
4. **The MD (super admin) can act as either head**: start phases, approve, plan construction. The Managing Partner sees everything but has no workflow actions. Hidden construction tasks are visible before kickoff only to Head - Site Operations, the MD and the Managing Partner.

### Model additions beyond the outline
5. Added the following to the outlined schema:
   - **`PhaseTemplate` and `ProjectPhase`**: per-project phase status (locked / waiting to start / active / completed), actual start and end, and who started it.
   - **`TaskKind.APPROVAL`**: the "Approve design" gate.
   - **`TaskEvent`**: audit trail for overrides, planned-date changes and backfills.
   - **`Task.shiftDays`**: accumulated client-side shifts.
   - **`Task.lastSubmittedAt`**: `submittedAt` stays the first submission, so on-time measurement is fair.
   - **`AppSetting`**: reminder settings.
6. **The legacy stage checklist (`ProjectStage`) is replaced** by this engine. Its 260 demo rows were exported to `storage/backups/ProjectStage-before-workflow-engine.json` before the migration dropped the table. The old `projects.workflow.update` permission was removed, because workflow rights now follow the role table in the brief.

### Sequencing and dates
7. **Final painting and handover** is tagged Phase 2 but comes after interior execution (Phase 3).
   - "Start Construction Phase 3" therefore opens once **Electrical**, the last finisher before interior work, is approved.
   - Phase 2 is only complete when Final painting and handover is approved.
8. **Construction Phase 4 (landscape)** can start early or in parallel. Its Start task is created at construction kickoff, and its planned date is interior execution's planned start.
   - Landscaping's planned window mirrors interior execution unless a duration is set in its template.
9. **Design Phase 3 (interior design)** opens in parallel with Phase 2, when Phase 1 completes. Its Start task has no automatic date; the Architect Head sets one.
   - Design Phase 4's Start task opens when Phase 3 completes, planned on Phase 3's actual end.
10. **Excavation "must finish by kickoff + 10"**: planned end = kickoff + 10, and planned start = the end of preliminary work (kickoff + 7).
11. **Custom-date tasks that haven't been planned yet** show a provisional start (the previous stage's planned end) and no end until the head sets one.
12. **Start tasks and the approval gate are single dates**, not ranges.
13. **Interior rule**: interior design's planned end must be on or before ground-floor brickwork's planned start (same day allowed).
    - It's checked whenever either task's planned dates are saved, including the construction plan.
    - An override needs a reason, which is stored as a task event.
14. **"Shift following tasks"** after a client-side delay moves every open downstream task by the delay days. Downstream means later in the sequence, or depending on the task through a date rule. The delayed task's own plan stays put, so its variance stays visible.
15. **All dates are calendar days.** "Today" means today in `APP_TIMEZONE` (Asia/Kolkata).

### Review
16. **"Final plan confirmed" and "Approve design"** are completed by the Architect Head directly: they *are* the approval, so there's no second review.
    - The site visit is completed by either assignee (the MD or the Architect Head).
    - Start tasks are never reviewed.
17. **Each task's reviewer** is resolved when the task is generated: the first active user holding the reviewer role. Anyone holding that role (or the MD) can also review.
18. **When sending work back, the reviewer may return it to someone else** in the pool. Logging the rework as a `REWORK` delay is an opt-in checkbox and is never done silently.

### Reminders
19. **Rules beyond the brief:**
    - Tasks in phases that haven't started are skipped.
    - Start tasks get only the "Start task waiting" reminder, not due/overdue ones.
    - Unassigned overdue work is chased with the department head.
    - Escalation thresholds are "more than N days" (> 3 days to the head, > 7 to the MD).
    - A "Start task waiting" threshold was added to Settings (default 2 days).
20. **Scheduling** happens in-process: `src/instrumentation.ts` checks every minute and runs once a day at the configured time, instead of using node-cron.
    - Notification dedupe keys make this safe even with several server instances.
    - For an external scheduler, set `REMINDERS_SCHEDULER=off` and call `GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`.
21. **At construction kickoff each worker gets one notification** summarising their newly visible tasks, rather than one per task.

### Backfill
22. **Existing projects** have their Design Phase 1 tasks marked completed, with actual dates equal to the planned dates (capped at today).
    - Unassigned team tasks are attributed to the first Ar Design user.
    - "Start Design Phase 2" is created for the Architect Head, planned on the Phase 1 completion date, or today if those dates are still in the future.
    - Phase 2 is **not** started.
    - Because Phase 3 runs in parallel, "Start Design Phase 3" is also created.
    - Completed projects are backfilled the same way, as the brief specifies.
23. **Demo data**: `npm run workflow:demo` plays the demo projects forward through the real service, as the users would. It does this on a freshly seeded database, or with `--continue` on an existing one.

### Scale
24. The head desks and My Tasks build per-project read models, which is fine for tens of active projects. Past that, a denormalised task query would be the next step.
