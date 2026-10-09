import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { StaticMap } from "@/components/maps";
import { Badge, Card, EmptyState, PageHeader, ProgressBar } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn, formatINRCompact, percent } from "@/lib/format";
import { COMPANY_BRANCHES, PROJECT_CATEGORIES, PROJECT_STAGES, STAGE_TONE } from "@/lib/project-schema";
import { projectWhere } from "@/lib/scope";
import { can, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Projects" };

type Search = { q?: string; stage?: string; category?: string; branch?: string; role?: string; layout?: string };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const layout = sp.layout === "map" ? "map" : "list";

  const where: Prisma.ProjectWhereInput = {
    AND: [
      await projectWhere(user),
      sp.stage ? { projectStage: sp.stage } : {},
      sp.category ? { projectCategory: sp.category } : {},
      sp.branch ? { companyBranch: sp.branch } : {},
      sp.role ? { members: { some: { user: { roleId: sp.role } } } } : {},
      sp.q
        ? { OR: [{ projectCode: { contains: sp.q, mode: "insensitive" } }, { projectName: { contains: sp.q, mode: "insensitive" } }, { address: { contains: sp.q, mode: "insensitive" } }] }
        : {},
    ],
  };

  const [projects, roles] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ startDate: "desc" }],
      include: { _count: { select: { members: true } } },
    }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  // Workflow progress = approved stage tasks / stages in the standard template.
  const [doneCounts, withWorkflow, stageTotal] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: projects.map((p) => p.id) }, kind: "STAGE", status: "COMPLETED" }, _count: { _all: true } }),
    prisma.projectPhase.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, distinct: ["projectId"], select: { projectId: true } }),
    prisma.taskTemplate.count({ where: { kind: "STAGE" } }),
  ]);
  const progress = new Map<string, { done: number; total: number }>(withWorkflow.map((w) => [w.projectId, { done: 0, total: stageTotal }]));
  for (const row of doneCounts) progress.set(row.projectId, { done: row._count._all, total: stageTotal });
  const pct = (id: string) => {
    const p = progress.get(id);
    return p ? percent(p.done, p.total) : 0;
  };

  const qs = (patch: Partial<Search>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
    return `/projects?${q.toString()}`;
  };
  const hasFilters = !!(sp.q || sp.stage || sp.category || sp.branch || sp.role);

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={can(user, "projects.view.all") ? "All company projects" : "Projects you or your team are assigned to"}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
              <Link href={qs({ layout: undefined })} className={cn("rounded-md px-3 py-1 font-medium", layout === "list" ? "bg-ink-900 text-white" : "text-stone-600")}>
                List
              </Link>
              <Link href={qs({ layout: "map" })} className={cn("rounded-md px-3 py-1 font-medium", layout === "map" ? "bg-ink-900 text-white" : "text-stone-600")}>
                Map
              </Link>
            </div>
            {can(user, "projects.create") && (
              <Link href="/projects/new" className="btn btn-primary">
                <Icon name="plus" /> Add project
              </Link>
            )}
          </>
        }
      />

      <form action="/projects" className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {layout === "map" && <input type="hidden" name="layout" value="map" />}
        <input name="q" defaultValue={sp.q} placeholder="Search code, name, address…" className="input col-span-2 sm:w-64" />
        <select name="stage" defaultValue={sp.stage ?? ""} className="input sm:w-36">
          <option value="">All stages</option>
          {PROJECT_STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select name="category" defaultValue={sp.category ?? ""} className="input sm:w-40">
          <option value="">All categories</option>
          {PROJECT_CATEGORIES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select name="branch" defaultValue={sp.branch ?? ""} className="input sm:w-40">
          <option value="">All branches</option>
          {COMPANY_BRANCHES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select name="role" defaultValue={sp.role ?? ""} className="input sm:w-52">
          <option value="">Any team / role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Filter</button>
        {hasFilters && (
          <Link href={layout === "map" ? "/projects?layout=map" : "/projects"} className="btn btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {projects.length === 0 ? (
        <Card>
          <EmptyState icon="building" title={hasFilters ? "No projects match these filters" : "No projects yet"}>
            {can(user, "projects.create") && !hasFilters ? "Add your first project to start tracking attendance on site." : null}
          </EmptyState>
        </Card>
      ) : layout === "map" ? (
        <Card>
          <StaticMap
            className="h-[520px] w-full"
            circles={projects.map((p) => ({ lat: p.latitude, lng: p.longitude, radius: p.attendanceRadius }))}
            markers={projects.map((p) => ({ lat: p.latitude, lng: p.longitude, color: "#134332", popup: `${p.projectCode}\n${p.projectName}\n${p.projectStage}` }))}
          />
          <ul className="grid gap-px bg-stone-100 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id} className="bg-white">
                <Link href={`/projects/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-stone-50">
                  <Icon name="pin" className="h-4 w-4 text-brand-500" />
                  <span className="font-semibold">{p.projectCode}</span>
                  <span className="truncate text-stone-500">{p.projectName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Project</th>
                    <th>Stage</th>
                    <th className="hidden xl:table-cell">Category</th>
                    <th>Schedule</th>
                    <th className="text-right">Radius</th>
                    <th className="text-center">Location</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td className="font-semibold whitespace-nowrap">
                        <Link href={`/projects/${p.id}`} className="hover:text-brand-600">
                          {p.projectCode}
                        </Link>
                      </td>
                      <td className="max-w-64">
                        <Link href={`/projects/${p.id}`} className="block truncate hover:text-brand-600">
                          {p.projectName}
                        </Link>
                        <span className="block truncate text-xs text-stone-500">
                          {p.companyBranch ?? "—"} · {p._count.members} members{p.projectValue ? ` · ${formatINRCompact(p.projectValue)}` : ""}
                        </span>
                      </td>
                      <td>
                        <Badge tone={STAGE_TONE[p.projectStage] ?? "gray"}>{p.projectStage}</Badge>
                      </td>
                      <td className="hidden text-stone-600 xl:table-cell">{p.projectCategory}</td>
                      <td className="text-xs whitespace-nowrap text-stone-600">
                        {formatDate(p.startDate)}
                        <span className="block text-stone-400">→ {formatDate(p.endDate)}</span>
                      </td>
                      <td className="text-right tabular-nums">{p.attendanceRadius} m</td>
                      <td className="text-center">
                        <span title={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`} className="inline-grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                          <Icon name="pin" className="h-4 w-4" />
                        </span>
                      </td>
                      <td className="w-32">
                        {progress.has(p.id) ? (
                          <div className="flex items-center gap-2">
                            <ProgressBar value={pct(p.id)} />
                            <span className="w-9 text-right text-xs tabular-nums text-stone-500">{pct(p.id)}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">No workflow</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="card block p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{p.projectCode}</p>
                      <p className="truncate text-sm text-stone-600">{p.projectName}</p>
                    </div>
                    <Badge tone={STAGE_TONE[p.projectStage] ?? "gray"}>{p.projectStage}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="pin" className="h-3.5 w-3.5 text-emerald-600" /> {p.attendanceRadius} m
                    </span>
                    <span>{p.projectCategory}</span>
                    <span>
                      {formatDate(p.startDate)} → {formatDate(p.endDate)}
                    </span>
                  </div>
                  {progress.has(p.id) && (
                    <div className="mt-3 flex items-center gap-2">
                      <ProgressBar value={pct(p.id)} />
                      <span className="text-xs tabular-nums text-stone-500">{pct(p.id)}%</span>
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
