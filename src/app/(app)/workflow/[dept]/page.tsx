import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ConstructionPlanner } from "@/components/workflow/construction-planner";
import { PhaseStatusBadge, fmtDay } from "@/components/workflow/chips";
import { startContextFor } from "@/components/workflow/start-context";
import { TaskFilterChips, matchesFilter, parseTaskFilter } from "@/components/workflow/task-filters";
import { TaskRow } from "@/components/workflow/task-row";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { isDeptHead, isOwner } from "@/lib/workflow/access";
import { getDesk } from "@/lib/workflow/queries";
import { actorFor } from "@/lib/workflow/service";
import { ROLES } from "@/lib/workflow/types";

const DEPTS = {
  design: { title: "Design Desk", head: ROLES.ARCHITECT_HEAD, headName: "Head - Architectural Designs" },
  construction: { title: "Construction Desk", head: ROLES.CONSTRUCTION_HEAD, headName: "Head - Site Operations" },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ dept: string }> }): Promise<Metadata> {
  const { dept } = await params;
  return { title: DEPTS[dept as keyof typeof DEPTS]?.title ?? "Workflow" };
}

export default async function DeskPage({ params, searchParams }: { params: Promise<{ dept: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { dept } = await params;
  if (dept !== "design" && dept !== "construction") notFound();
  const conf = DEPTS[dept];
  const user = await requireUser();
  const actor = await actorFor(prisma, user.id);
  if (!isDeptHead(actor, conf.head) && !isOwner(actor)) redirect("/forbidden");
  const filter = parseTaskFilter((await searchParams).filter);
  const desk = await getDesk(actor, dept);

  const team = desk.projects.flatMap((p) => p.tasks);
  const overdue = team.filter((t) => t.due === "overdue").length;
  const dueSoon = team.filter((t) => t.due === "due-soon" || t.due === "due-today").length;
  const inReview = team.filter((t) => t.status === "IN_REVIEW").length;
  const base = `/workflow/${dept}`;

  return (
    <div className="space-y-6">
      <PageHeader title={conf.title} subtitle={`${conf.headName}: start phases, ${dept === "design" ? "approve the final plan and design" : "plan and kick off construction"}, and watch the team's workload.`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Phases waiting to start" value={desk.startTasks.length} icon="flag" tone={desk.startTasks.length ? "amber" : "gray"} />
        <Stat label="Open team tasks" value={team.length} hint={`${inReview} in review`} icon="clipboard" tone="blue" />
        <Stat label="Due soon" value={dueSoon} icon="clock" tone={dueSoon ? "amber" : "gray"} href={`${base}?filter=due-soon#team`} />
        <Stat label="Overdue" value={overdue} icon="alert" tone={overdue ? "red" : "gray"} href={`${base}?filter=overdue#team`} />
      </div>

      <Card title="Waiting for you to start">
        {desk.startTasks.length === 0 ? (
          <EmptyState icon="check" title="No phases are waiting to be started" />
        ) : (
          <ul>
            {desk.startTasks.map(({ project, task, view }) => (
              <TaskRow key={task.id} task={task} project={{ id: project.id, code: project.code }} startContext={startContextFor(view, task)} />
            ))}
          </ul>
        )}
      </Card>

      {dept === "design" && (
        <Card title="Approvals">
          {desk.approvals.length === 0 ? (
            <EmptyState icon="check" title="No final plans or designs waiting for approval" />
          ) : (
            <ul>
              {desk.approvals.map(({ project, task }) => (
                <TaskRow key={task.id} task={task} project={{ id: project.id, code: project.code }} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {dept === "construction" && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Construction planning</h2>
          {desk.projects.filter((p) => p.view.phases.some((ph) => ph.key === "CONSTRUCTION_1" && ph.status !== "LOCKED")).length === 0 && (
            <Card>
              <EmptyState icon="building" title="No projects handed over yet">
                Construction appears here once the Architect Head approves a design.
              </EmptyState>
            </Card>
          )}
          {desk.projects
            .filter((p) => p.view.phases.some((ph) => ph.key === "CONSTRUCTION_1" && ph.status !== "LOCKED"))
            .map(({ project, view }) => {
              const c1 = view.phases.find((ph) => ph.key === "CONSTRUCTION_1")!;
              const tasks = view.phases.filter((ph) => ph.isConstruction).flatMap((ph) => ph.tasks).sort((a, b) => a.order - b.order);
              const waiting = c1.status === "AWAITING_START";
              return (
                <details key={project.id} open={waiting} className="card group overflow-hidden">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                    <span className="font-semibold">{project.code}</span>
                    <span className="text-sm text-stone-500">{project.name}</span>
                    <PhaseStatusBadge status={c1.status} />
                    <span className="ml-auto text-xs text-stone-500">
                      Kickoff {fmtDay(view.project.constructionKickoff)} · {tasks.filter((t) => t.status === "COMPLETED").length}/{tasks.length} done
                    </span>
                  </summary>
                  <div className="border-t border-stone-100">
                    {waiting && <p className="bg-gold-50 px-4 py-2 text-sm text-gold-800">Plan the dates and assign workers, then use “Start phase” on the Start Construction Phase 1 task above — that click is the kickoff. Workers can&apos;t see these tasks until then.</p>}
                    <ConstructionPlanner projectId={project.id} kickoff={view.project.constructionKickoff} tasks={tasks} readOnly={!isDeptHead(actor, conf.head)} />
                  </div>
                </details>
              );
            })}
        </section>
      )}

      <section id="team" className="space-y-3 scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Team tasks</h2>
          <TaskFilterChips tasks={team} active={filter} href={(f) => (f === "open" ? `${base}#team` : `${base}?filter=${f}#team`)} />
        </div>
        {desk.projects.every((p) => !p.tasks.some((t) => matchesFilter(t, filter))) ? (
          <Card>
            <EmptyState icon="check" title="No team tasks match this filter" />
          </Card>
        ) : (
          desk.projects
            .filter((p) => p.tasks.some((t) => matchesFilter(t, filter)))
            .map((p) => (
              <Card
                key={p.project.id}
                title={
                  <Link href={`/projects/${p.project.id}?tab=workflow`} className="hover:text-brand-600">
                    {p.project.code} <span className="font-normal text-stone-500">· {p.view.activeLabel}</span>
                  </Link>
                }
              >
                <ul>
                  {p.tasks
                    .filter((t) => matchesFilter(t, filter))
                    .map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                </ul>
              </Card>
            ))
        )}
      </section>

      <Card title="Team workload">
        {desk.workload.length === 0 ? (
          <EmptyState icon="users" title="No open tasks assigned" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Due soon</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">In review</th>
                  <th className="text-right">Rework</th>
                </tr>
              </thead>
              <tbody>
                {desk.workload.map((w) => (
                  <tr key={w.userId}>
                    <td className="font-medium">{w.name}</td>
                    <td className="text-stone-500">{w.roleName}</td>
                    <td className="text-right tabular-nums">{w.open}</td>
                    <td className={cn("text-right tabular-nums", w.dueSoon > 0 && "font-semibold text-amber-700")}>{w.dueSoon}</td>
                    <td className={cn("text-right tabular-nums", w.overdue > 0 && "font-semibold text-red-600")}>{w.overdue}</td>
                    <td className="text-right tabular-nums">{w.inReview}</td>
                    <td className={cn("text-right tabular-nums", w.rework > 0 && "font-semibold text-orange-700")}>{w.rework}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
