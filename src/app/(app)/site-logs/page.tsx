import type { Metadata } from "next";
import Link from "next/link";
import { createSiteLog } from "@/actions/modules";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { projectWhere } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Site logs" };

export default async function SiteLogsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requirePermission("sitelogs.view");
  const { project } = await searchParams;
  const visible = await projectWhere(user);

  const projects = await prisma.project.findMany({
    where: { AND: [visible, { projectStage: { notIn: ["Cancelled"] } }] },
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { projectCode: "asc" },
  });
  const projectIds = projects.map((p) => p.id);
  const logs = await prisma.siteLog.findMany({
    where: { projectId: project && projectIds.includes(project) ? project : { in: projectIds } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 60,
    include: { project: { select: { id: true, projectCode: true } }, author: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader title="Site logs" subtitle="Daily progress, manpower and issues from site." />
      <div className="grid gap-6 lg:grid-cols-3">
        {can(user, "sitelogs.create") && (
          <Card title="New daily log" className="h-fit lg:order-2">
            <ActionForm action={createSiteLog} className="grid gap-3 p-4" submitLabel={<><Icon name="check" /> Save log</>}>
              <label className="block">
                <span className="label">Project</span>
                <select name="projectId" defaultValue={project ?? user.mainProjectId ?? ""} required className="input">
                  <option value="">Select…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.projectCode} — {p.projectName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Date</span>
                  <input type="date" name="date" defaultValue={todayKey()} max={todayKey()} required className="input" />
                </label>
                <label className="block">
                  <span className="label">Manpower</span>
                  <input type="number" name="manpower" min={0} className="input" placeholder="12" />
                </label>
              </div>
              <label className="block">
                <span className="label">Weather</span>
                <select name="weather" className="input" defaultValue="">
                  <option value="">—</option>
                  <option>Sunny</option>
                  <option>Cloudy</option>
                  <option>Light rain</option>
                  <option>Heavy rain</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Work done</span>
                <textarea name="workDone" rows={4} required className="input" placeholder="Roof slab shuttering completed for Block A…" />
              </label>
              <label className="block">
                <span className="label">Issues / hold-ups</span>
                <textarea name="issues" rows={2} className="input" placeholder="Steel delivery delayed by 2 days" />
              </label>
            </ActionForm>
          </Card>
        )}

        <div className="space-y-3 lg:col-span-2">
          <form action="/site-logs" className="flex gap-2">
            <select name="project" defaultValue={project ?? ""} className="input w-72">
              <option value="">All my projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary">Filter</button>
          </form>
          <Card>
            {logs.length === 0 ? (
              <EmptyState icon="clipboard" title="No site logs yet" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {logs.map((l) => (
                  <li key={l.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">
                        <Link href={`/projects/${l.project.id}?tab=sitelogs`} className="hover:text-brand-600">
                          {l.project.projectCode}
                        </Link>{" "}
                        · {formatDate(l.date)}
                      </p>
                      <p className="text-xs text-stone-500">
                        {l.author.name}
                        {l.manpower != null ? ` · ${l.manpower} workers` : ""}
                        {l.weather ? ` · ${l.weather}` : ""}
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-stone-700">{l.workDone}</p>
                    {l.issues && (
                      <p className="mt-1 flex items-start gap-1 text-red-700">
                        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {l.issues}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
