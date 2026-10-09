import type { Metadata } from "next";
import { markAllNotificationsReadAction } from "@/actions/workflow";
import { Badge, Card, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications" };

const TYPE: Record<string, { label: string; tone: Tone }> = {
  ASSIGNED: { label: "Assigned", tone: "brand" },
  REASSIGNED: { label: "Reassigned", tone: "brand" },
  START_TASK_CREATED: { label: "Start phase", tone: "amber" },
  REVIEW_REQUESTED: { label: "Review requested", tone: "blue" },
  APPROVED: { label: "Approved", tone: "green" },
  SENT_BACK: { label: "Sent back", tone: "amber" },
  DELAY_FLAGGED: { label: "Delay", tone: "red" },
  DUE_SOON: { label: "Due soon", tone: "amber" },
  DUE_TODAY: { label: "Due today", tone: "amber" },
  OVERDUE: { label: "Overdue", tone: "red" },
  ESCALATION: { label: "Escalation", tone: "red" },
  REVIEW_WAITING: { label: "Review waiting", tone: "blue" },
  START_TASK_WAITING: { label: "Start waiting", tone: "amber" },
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const unreadOnly = (await searchParams).show === "unread";
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { project: { select: { projectCode: true } } },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle={`${unread} unread`}
        actions={
          <>
            <a href={unreadOnly ? "/notifications" : "/notifications?show=unread"} className="btn btn-secondary btn-sm">
              {unreadOnly ? "Show all" : "Unread only"}
            </a>
            {unread > 0 && (
              <form action={markAllNotificationsReadAction}>
                <button className="btn btn-dark btn-sm">Mark all read</button>
              </form>
            )}
          </>
        }
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon="check" title="No notifications" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((n) => {
              const t = TYPE[n.type] ?? { label: n.type, tone: "gray" as Tone };
              return (
                <li key={n.id}>
                  <a href={`/api/notifications/${n.id}/open`} className={cn("flex items-start gap-3 px-4 py-3 hover:bg-stone-50", !n.readAt && "bg-brand-50/40")}>
                    <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-500")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={t.tone}>{t.label}</Badge>
                        {n.project && <span className="text-xs font-semibold text-stone-500">{n.project.projectCode}</span>}
                        <span className="text-xs text-stone-400">{formatDateTime(n.createdAt)}</span>
                      </span>
                      <span className={cn("mt-1 block text-sm", !n.readAt && "font-medium")}>{n.message}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
