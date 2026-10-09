import { AppShell } from "@/components/app-shell";
import { reviewableWhere } from "@/lib/attendance";
import { APP_NAME } from "@/lib/config";
import { prisma } from "@/lib/db";
import { buildNav } from "@/lib/nav";
import { can, requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [review, po, tasks, taskReviews, unread] = await Promise.all([
    can(user, "attendance.review") ? reviewableWhere(user).then((where) => prisma.attendance.count({ where })) : 0,
    can(user, "procurement.po.approve")
      ? prisma.purchaseOrder.count({ where: { status: "PENDING", ...(user.isSuperAdmin ? {} : { awaitingRoleId: user.roleId }) } })
      : 0,
    // Open work assigned to me (Start tasks, rework, active stages).
    prisma.task.count({ where: { visible: true, status: { in: ["IN_PROGRESS", "REWORK"] }, assignees: { some: { userId: user.id } } } }).then(async (n) =>
      n + (await prisma.task.count({ where: { kind: "PHASE_START", status: "NOT_STARTED", assignees: { some: { userId: user.id } } } })),
    ),
    prisma.task.count({ where: { status: "IN_REVIEW", ...(user.isSuperAdmin ? {} : { reviewerId: user.id }) } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <AppShell
      appName={APP_NAME}
      nav={buildNav(user, { review, po, tasks, taskReviews })}
      user={{ name: user.name, roleName: user.roleName, designation: user.designation }}
      canCheckIn={can(user, "attendance.self")}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
