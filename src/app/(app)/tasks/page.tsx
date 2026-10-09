import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { startContextFor } from "@/components/workflow/start-context";
import { TaskFilterChips, matchesFilter, parseTaskFilter } from "@/components/workflow/task-filters";
import { TaskRow } from "@/components/workflow/task-row";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listMyTasks } from "@/lib/workflow/queries";
import { actorFor } from "@/lib/workflow/service";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const filter = parseTaskFilter((await searchParams).filter);
  const groups = await listMyTasks(await actorFor(prisma, user.id));
  const all = groups.flatMap((g) => g.tasks);
  const shown = groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => matchesFilter(t, filter)) })).filter((g) => g.tasks.length);

  return (
    <div>
      <PageHeader title="My tasks" subtitle="Everything assigned to you across projects. Overdue work is highlighted red, due-soon amber." />
      <div className="mb-4">
        <TaskFilterChips tasks={all} active={filter} href={(f) => (f === "open" ? "/tasks" : `/tasks?filter=${f}`)} />
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="check" title={filter === "open" ? "Nothing assigned to you right now" : "No tasks match this filter"}>
            New work appears here when a head assigns you a stage or a phase is handed to you.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {shown.map((g) => (
            <Card
              key={g.project.id}
              title={
                <Link href={`/projects/${g.project.id}?tab=workflow`} className="hover:text-brand-600">
                  {g.project.code} <span className="font-normal text-stone-500">· {g.project.name}</span>
                </Link>
              }
              actions={<span className="text-xs text-stone-500">{g.view.activeLabel}</span>}
            >
              <ul>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} startContext={startContextFor(g.view, t)} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
