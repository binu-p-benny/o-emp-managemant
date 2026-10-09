import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteProject } from "@/actions/projects";
import { RangeBadge, SelfieThumb } from "@/components/attendance-badges";
import { Icon } from "@/components/icons";
import { StaticMap } from "@/components/maps";
import { Avatar, Badge, Card, DescriptionList, EmptyState, LinkTabs, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { WorkflowBoard } from "@/components/workflow/workflow-board";
import { addDays, dateOnly, daysBetween, formatDate, formatDateTime, formatTime, startOfDay, toDateKey, todayKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn, formatINR, formatNumber, percent, toNumber } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { STAGE_TONE } from "@/lib/project-schema";
import { sortTree } from "@/lib/projects";
import { canViewProject } from "@/lib/scope";
import { can, requireUser } from "@/lib/session";
import { allTasks, getProjectWorkflow } from "@/lib/workflow/queries";
import { actorFor } from "@/lib/workflow/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id }, select: { projectCode: true } });
  return { title: p?.projectCode ?? "Project" };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const user = await requireUser();
  if (!(await canViewProject(user, id))) notFound();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, designation: true, mainProjectId: true, role: { select: { name: true } } } } },
        orderBy: { assignedAt: "asc" },
      },
      locations: { orderBy: { sortOrder: "asc" } },
      _count: { select: { siteLogs: true, boqItems: true, purchaseOrders: true } },
    },
  });
  if (!project) notFound();

  const today = todayKey();
  const todayDate = dateOnly(today);
  const since = startOfDay(addDays(today, -13));
  const attendance = await prisma.attendance.findMany({
    where: { projectId: id, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    include: { user: { select: { name: true, designation: true, role: { select: { name: true } } } } },
  });
  const todays = attendance.filter((a) => toDateKey(a.timestamp) === today);
  const todaysCheckIns = todays.filter((a) => a.type === "CHECK_IN");

  // Workflow (Enquiry → Design → Construction)
  const workflow = await getProjectWorkflow(id, await actorFor(prisma, user.id));
  const wfTasks = workflow ? allTasks(workflow) : [];
  const overdueTasks = wfTasks.filter((t) => t.due === "overdue" && t.status !== "COMPLETED");
  const daysLeft = daysBetween(todayDate, project.endDate);

  const showSiteLogs = can(user, "sitelogs.view");
  const showCosting = can(user, "costing.view");
  const showPOs = can(user, "procurement.view");
  const tabs = [
    { key: "overview", label: "Overview" },
    ...(workflow ? [{ key: "workflow", label: "Workflow", count: overdueTasks.length || undefined }] : []),
    { key: "attendance", label: "Attendance", count: todaysCheckIns.length },
    { key: "members", label: "Members", count: project.members.length },
    { key: "locations", label: "Location Structure", count: project.locations.length },
    ...(showSiteLogs ? [{ key: "sitelogs", label: "Site Logs", count: project._count.siteLogs }] : []),
    ...(showCosting ? [{ key: "costing", label: "BoQ", count: project._count.boqItems }] : []),
    ...(showPOs ? [{ key: "procurement", label: "Purchase Orders", count: project._count.purchaseOrders }] : []),
  ].map((t) => ({ ...t, href: `/projects/${id}?tab=${t.key}` }));
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam! : "overview";

  const canEdit = can(user, "projects.edit") || can(user, "projects.members.manage");

  return (
    <div>
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {project.projectCode}
            <Badge tone={STAGE_TONE[project.projectStage] ?? "gray"}>{project.projectStage}</Badge>
          </span>
        }
        subtitle={project.projectName}
        actions={
          <>
            {canEdit && (
              <Link href={`/projects/${id}/edit`} className="btn btn-secondary">
                <Icon name="pencil" /> Edit
              </Link>
            )}
            {can(user, "projects.delete") && (
              <form action={deleteProject}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-ghost text-red-600 hover:bg-red-50" title="Delete project and all its records">
                  <Icon name="trash" />
                </button>
              </form>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Workflow progress"
          value={workflow ? `${percent(workflow.progress.done, workflow.progress.total)}%` : "—"}
          hint={workflow ? `${workflow.progress.done} of ${workflow.progress.total} stages approved` : "No design/construction workflow"}
          icon="layers"
          tone="brand"
        />
        <Stat
          compact
          label="Current phase"
          value={workflow?.activeLabel ?? "—"}
          hint={workflow?.delaySummary.count ? `${workflow.delaySummary.count} delays · ${workflow.delaySummary.days} days` : "No delays flagged"}
          icon="clipboard"
          tone="blue"
        />
        <Stat label="On site today" value={`${todaysCheckIns.filter((a) => a.inRange).length}/${todaysCheckIns.length}`} hint="in range / check-ins" icon="pin" tone="green" />
        <Stat
          label={daysLeft >= 0 ? "Days to handover" : "Days past end date"}
          value={Math.abs(daysLeft)}
          hint={overdueTasks.length ? `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} overdue` : "No overdue tasks"}
          icon="calendar"
          tone={overdueTasks.length || daysLeft < 0 ? "red" : "gray"}
        />
      </div>

      <LinkTabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card title="Project details" className="lg:col-span-3">
            <DescriptionList
              items={[
                { label: "Project Code", value: project.projectCode },
                { label: "Project Name", value: project.projectName },
                { label: "Project Stage", value: project.projectStage },
                { label: "Project Category", value: project.projectCategory },
                { label: "Start Date", value: formatDate(project.startDate) },
                { label: "End Date", value: formatDate(project.endDate) },
                { label: "Project Address", value: project.address, wide: true },
                { label: "Project Latitude", value: project.latitude.toFixed(6) },
                { label: "Project Longitude", value: project.longitude.toFixed(6) },
                { label: "Company Branch", value: project.companyBranch },
                { label: "Attendance Radius", value: `${project.attendanceRadius} m` },
                { label: "Outside radius", value: project.outOfRangePolicy === "BLOCK" ? "Block check-in" : "Allow & flag for review" },
                { label: "Project Value", value: project.projectValue ? formatINR(project.projectValue) : null },
                { label: "Project Orientation", value: project.orientation },
                { label: "Project Dimension", value: project.dimension },
                { label: "Scope of Work", value: project.scopeOfWork, wide: true },
              ]}
            />
          </Card>
          <Card
            title="Location & geofence"
            className="lg:col-span-2"
            actions={
              <a href={`https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">
                Open in Google Maps ↗
              </a>
            }
          >
            <div className="p-2">
              <StaticMap
                className="h-80 w-full lg:h-[420px]"
                circles={[{ lat: project.latitude, lng: project.longitude, radius: project.attendanceRadius }]}
                markers={[
                  { lat: project.latitude, lng: project.longitude, color: "#134332", popup: `${project.projectCode}\n${project.address}` },
                  ...todaysCheckIns.map((a) => ({
                    lat: a.latitude,
                    lng: a.longitude,
                    kind: "dot" as const,
                    color: a.inRange ? "#16a34a" : "#d97706",
                    popup: `${a.user.name} · ${formatTime(a.timestamp)}\n${formatDistance(a.distanceMeters)} from site`,
                  })),
                ]}
              />
            </div>
            <p className="px-4 pb-3 text-xs text-stone-500">
              Shaded circle = {project.attendanceRadius} m attendance radius. Dots = today&apos;s check-ins (green on-site, amber out of range).
            </p>
          </Card>
        </div>
      )}

      {tab === "workflow" && workflow && <WorkflowBoard view={workflow} />}

      {tab === "attendance" && (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card title="Last 14 days" className="lg:col-span-3">
            {attendance.length === 0 ? (
              <EmptyState icon="clock" title="No check-ins at this project in the last 14 days" />
            ) : (
              <ul className="max-h-[560px] divide-y divide-stone-100 overflow-y-auto">
                {attendance.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <SelfieThumb url={a.selfieUrl} alt={a.user.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {a.user.name} · {a.type === "CHECK_IN" ? "in" : "out"}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {a.user.designation ?? a.user.role.name} · {formatDateTime(a.timestamp)}
                      </p>
                    </div>
                    <RangeBadge record={a} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Check-in locations (14 days)" className="lg:col-span-2">
            <div className="p-2">
              <StaticMap
                className="h-96 w-full"
                circles={[{ lat: project.latitude, lng: project.longitude, radius: project.attendanceRadius }]}
                markers={[
                  { lat: project.latitude, lng: project.longitude, color: "#134332", popup: project.projectCode },
                  ...attendance
                    .filter((a) => a.type === "CHECK_IN")
                    .map((a) => ({
                      lat: a.latitude,
                      lng: a.longitude,
                      kind: "dot" as const,
                      color: a.inRange ? "#16a34a" : "#d97706",
                      popup: `${a.user.name}\n${formatDateTime(a.timestamp)}\n${formatDistance(a.distanceMeters)}`,
                    })),
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-stone-100 bg-stone-100 text-center">
              <div className="bg-white p-3">
                <p className="text-xl font-bold text-emerald-600 tabular-nums">{attendance.filter((a) => a.type === "CHECK_IN" && a.inRange).length}</p>
                <p className="text-xs text-stone-500">In range</p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xl font-bold text-amber-600 tabular-nums">{attendance.filter((a) => a.type === "CHECK_IN" && !a.inRange).length}</p>
                <p className="text-xs text-stone-500">Out of range</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "members" && (
        <Card
          title="Assigned members"
          actions={
            can(user, "projects.members.manage") && (
              <Link href={`/projects/${id}/edit`} className="btn btn-secondary btn-sm">
                Manage
              </Link>
            )
          }
        >
          {project.members.length === 0 ? (
            <EmptyState icon="users" title="No members assigned" />
          ) : (
            <ul className="divide-y divide-stone-100">
              {project.members.map((m) => {
                const checkedIn = todaysCheckIns.find((a) => a.userId === m.userId);
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={m.user.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {m.user.name}
                        {m.user.mainProjectId === id && <Badge tone="brand" className="ml-2">Main project</Badge>}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {m.projectRole ?? m.user.designation ?? "—"} · {m.user.role.name}
                      </p>
                    </div>
                    {checkedIn ? <RangeBadge record={checkedIn} /> : <span className="text-xs text-stone-400">Not checked in today</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "locations" && (
        <Card title="Location structure">
          {project.locations.length === 0 ? (
            <EmptyState icon="layers" title="No location structure defined" />
          ) : (
            <ul className="p-4 text-sm">
              {(() => {
                const tree = sortTree(project.locations.map((l) => ({ ...l, key: l.id, parentKey: l.parentId })));
                const depth = new Map<string, number>();
                return tree.map((l) => {
                  const d = l.parentKey ? (depth.get(l.parentKey) ?? 0) + 1 : 0;
                  depth.set(l.key, d);
                  return (
                    <li key={l.id} className="flex items-center gap-2 py-1" style={{ paddingLeft: d * 22 }}>
                      {d > 0 && <span className="h-px w-3 bg-stone-300" />}
                      <Badge tone={d === 0 ? "brand" : "gray"}>{l.type ?? "Area"}</Badge>
                      <span className="font-medium">{l.name}</span>
                    </li>
                  );
                });
              })()}
            </ul>
          )}
        </Card>
      )}

      {tab === "sitelogs" && <ProjectSiteLogs projectId={id} />}
      {tab === "costing" && <ProjectBoq projectId={id} projectValue={toNumber(project.projectValue)} />}
      {tab === "procurement" && <ProjectPOs projectId={id} />}
    </div>
  );
}

async function ProjectSiteLogs({ projectId }: { projectId: string }) {
  const logs = await prisma.siteLog.findMany({ where: { projectId }, orderBy: { date: "desc" }, take: 20, include: { author: { select: { name: true } } } });
  return (
    <Card title="Recent site logs" actions={<Link href={`/site-logs?project=${projectId}`} className="btn btn-secondary btn-sm">Open site logs</Link>}>
      {logs.length === 0 ? (
        <EmptyState icon="clipboard" title="No site logs yet" />
      ) : (
        <ul className="divide-y divide-stone-100">
          {logs.map((l) => (
            <li key={l.id} className="px-4 py-3 text-sm">
              <p className="font-semibold">
                {formatDate(l.date)} <span className="font-normal text-stone-500">· {l.author.name}{l.manpower != null ? ` · ${l.manpower} workers` : ""}{l.weather ? ` · ${l.weather}` : ""}</span>
              </p>
              <p className="mt-1 whitespace-pre-line text-stone-700">{l.workDone}</p>
              {l.issues && <p className="mt-1 text-red-700">Issues: {l.issues}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function ProjectBoq({ projectId, projectValue }: { projectId: string; projectValue: number }) {
  const items = await prisma.boqItem.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }] });
  const sections = new Map<string, number>();
  for (const i of items) sections.set(i.section, (sections.get(i.section) ?? 0) + toNumber(i.quantity) * toNumber(i.rate));
  const total = [...sections.values()].reduce((a, b) => a + b, 0);
  return (
    <Card title="BoQ summary" actions={<Link href={`/costing?project=${projectId}`} className="btn btn-secondary btn-sm">Open BoQ</Link>}>
      {items.length === 0 ? (
        <EmptyState icon="calculator" title="No BoQ prepared yet" />
      ) : (
        <div className="p-4">
          <ul className="space-y-2 text-sm">
            {[...sections.entries()].map(([s, amt]) => (
              <li key={s} className="flex items-center gap-3">
                <span className="w-32 truncate">{s}</span>
                <ProgressBar value={percent(amt, total)} />
                <span className="w-32 text-right tabular-nums">{formatINR(amt)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-stone-100 pt-3 text-sm">
            <span>
              BoQ total: <strong>{formatINR(total)}</strong> ({formatNumber(items.length)} items)
            </span>
            {projectValue > 0 && (
              <span className={cn(total > projectValue ? "text-red-600" : "text-emerald-700")}>
                {percent(total, projectValue)}% of project value {formatINR(projectValue)}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

async function ProjectPOs({ projectId }: { projectId: string }) {
  const pos = await prisma.purchaseOrder.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { name: true } }, awaitingRole: { select: { name: true } } },
  });
  const tone = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;
  return (
    <Card title="Purchase orders" actions={<Link href={`/procurement?project=${projectId}`} className="btn btn-secondary btn-sm">Open procurement</Link>}>
      {pos.length === 0 ? (
        <EmptyState icon="truck" title="No purchase orders for this project" />
      ) : (
        <ul className="divide-y divide-stone-100">
          {pos.map((po) => (
            <li key={po.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {po.poNumber} <span className="font-normal text-stone-500">· {po.vendor.name}</span>
                </p>
                <p className="truncate text-xs text-stone-500">{po.description}</p>
              </div>
              <span className="tabular-nums">{formatINR(po.amount)}</span>
              <Badge tone={tone[po.status]}>{po.status === "PENDING" ? `Awaiting ${po.awaitingRole?.name ?? "approval"}` : po.status.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
