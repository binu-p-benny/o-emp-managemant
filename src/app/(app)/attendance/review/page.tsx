import type { Metadata } from "next";
import { RangeBadge, SelfieThumb } from "@/components/attendance-badges";
import { StaticMap } from "@/components/maps";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { reviewableWhere } from "@/lib/attendance";
import { formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { formatDistance } from "@/lib/geo";
import { attendanceScope } from "@/lib/scope";
import { requirePermission } from "@/lib/session";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const user = await requirePermission("attendance.review");
  const where = await reviewableWhere(user);
  const scope = await attendanceScope(user);

  const [pending, recent] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { timestamp: "asc" },
      take: 50,
      include: {
        user: { select: { name: true, designation: true, role: { select: { name: true } } } },
        project: { select: { projectCode: true, projectName: true, latitude: true, longitude: true, attendanceRadius: true, address: true } },
      },
    }),
    prisma.attendance.findMany({
      where: {
        reviewStatus: { in: ["APPROVED", "REJECTED"] },
        ...(scope.all ? {} : { userId: { in: scope.userIds } }),
      },
      orderBy: { reviewedAt: "desc" },
      take: 15,
      include: {
        user: { select: { name: true } },
        project: { select: { projectCode: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Out-of-range review"
        subtitle="Check-ins captured outside the project's attendance radius. Verify the selfie and map pin, then approve or reject."
      />

      {pending.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="All caught up">
            No out-of-range entries are waiting for your review.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((r) => (
            <article key={r.id} className="card overflow-hidden">
              <div className="grid gap-0 md:grid-cols-[220px_1fr_1fr]">
                <a href={r.selfieUrl} target="_blank" rel="noreferrer" className="block bg-ink-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.selfieUrl} alt={`Selfie of ${r.user.name}`} className="aspect-square h-full w-full object-cover" />
                </a>
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <Avatar name={r.user.name} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.user.name}</p>
                      <p className="truncate text-xs text-stone-500">{r.user.designation ?? r.user.role.name}</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <dt className="text-stone-500">Type</dt>
                    <dd>
                      <Badge tone={r.type === "CHECK_IN" ? "brand" : "gray"}>{r.type === "CHECK_IN" ? "Check-in" : "Check-out"}</Badge>
                    </dd>
                    <dt className="text-stone-500">When</dt>
                    <dd className="tabular-nums">{formatDateTime(r.timestamp)}</dd>
                    <dt className="text-stone-500">Project</dt>
                    <dd>{r.project.projectCode}</dd>
                    <dt className="text-stone-500">Distance</dt>
                    <dd className="font-semibold text-amber-700">
                      {formatDistance(r.distanceMeters)} <span className="font-normal text-stone-500">/ {r.radiusMeters} m</span>
                    </dd>
                    <dt className="text-stone-500">GPS accuracy</dt>
                    <dd>{r.accuracyMeters != null ? `±${Math.round(r.accuracyMeters)} m` : "—"}</dd>
                    <dt className="text-stone-500">Location</dt>
                    <dd className="text-xs">{r.locationLabel ?? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`}</dd>
                  </dl>
                  <ReviewForm id={r.id} />
                </div>
                <div className="border-t border-stone-100 p-2 md:border-t-0 md:border-l">
                  <StaticMap
                    className="h-64 w-full md:h-full md:min-h-72"
                    circles={[{ lat: r.project.latitude, lng: r.project.longitude, radius: r.project.attendanceRadius }]}
                    markers={[
                      { lat: r.project.latitude, lng: r.project.longitude, color: "#134332", popup: `${r.project.projectCode}\n${r.project.address}` },
                      { lat: r.latitude, lng: r.longitude, color: "#d97706", popup: `${r.user.name}\n${formatDistance(r.distanceMeters)} from site` },
                    ]}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Card title="Recently reviewed" className="mt-8">
          <ul className="divide-y divide-stone-100">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <SelfieThumb url={r.selfieUrl} alt={r.user.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.user.name} · {r.project.projectCode} · {formatDateTime(r.timestamp)}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    by {r.reviewedBy?.name ?? "—"}
                    {r.reviewNote ? ` — “${r.reviewNote}”` : ""}
                  </p>
                </div>
                <RangeBadge record={r} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
