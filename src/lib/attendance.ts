import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { attendanceScope } from "@/lib/scope";
import type { CurrentUser } from "@/lib/session";

/**
 * People expected to check in — roles holding the attendance.self duty. Owners
 * (MD, Managing Partner) are excluded from headcounts and registers.
 */
export const ATTENDANCE_TRACKED = { role: { permissions: { some: { key: "attendance.self" } } } } satisfies Prisma.UserWhereInput;

/** Pending out-of-range entries this user may review (never their own, unless super admin). */
export async function reviewableWhere(user: CurrentUser): Promise<Prisma.AttendanceWhereInput> {
  const scope = await attendanceScope(user);
  if (user.isSuperAdmin) return { reviewStatus: "PENDING" };
  if (scope.all) return { reviewStatus: "PENDING", userId: { not: user.id } };
  return { reviewStatus: "PENDING", userId: { in: scope.userIds.filter((id) => id !== user.id) } };
}

/** The user's latest check-in that hasn't been closed by a check-out (within the last 24h). */
export async function getOpenCheckIn(userId: string) {
  const since = new Date(Date.now() - 24 * 3_600_000);
  return prisma.attendance.findFirst({
    where: { userId, type: "CHECK_IN", checkOut: null, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    include: { project: { select: { id: true, projectCode: true, projectName: true } } },
  });
}

export type DayStatus = "on-site" | "flagged" | "rejected" | "absent";

type RecordLite = {
  type: "CHECK_IN" | "CHECK_OUT";
  timestamp: Date;
  inRange: boolean;
  reviewStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
};

/**
 * Status of one employee-day:
 *  on-site  – a check-in in range (or approved by a reviewer)
 *  flagged  – only out-of-range check-ins awaiting review
 *  rejected – check-ins were rejected by a reviewer
 */
export function dayStatus(records: RecordLite[]): DayStatus {
  const checkIns = records.filter((r) => r.type === "CHECK_IN");
  if (!checkIns.length) return "absent";
  if (checkIns.some((r) => r.inRange || r.reviewStatus === "APPROVED")) return "on-site";
  if (checkIns.some((r) => r.reviewStatus === "PENDING")) return "flagged";
  return "rejected";
}

/** Hours worked from paired check-in/check-out records. */
export function workedHours(records: { id: string; type: string; timestamp: Date; checkInId: string | null }[]): number {
  const ins = new Map(records.filter((r) => r.type === "CHECK_IN").map((r) => [r.id, r.timestamp]));
  let ms = 0;
  for (const out of records) {
    if (out.type !== "CHECK_OUT" || !out.checkInId) continue;
    const start = ins.get(out.checkInId);
    if (start) ms += Math.max(0, out.timestamp.getTime() - start.getTime());
  }
  return ms / 3_600_000;
}

export const DAY_STATUS_STYLE: Record<DayStatus, { label: string; cell: string; dot: string }> = {
  "on-site": { label: "On-site", cell: "bg-emerald-500 text-white", dot: "bg-emerald-500" },
  flagged: { label: "Flagged (pending review)", cell: "bg-amber-400 text-amber-950", dot: "bg-amber-400" },
  rejected: { label: "Rejected", cell: "bg-red-500 text-white", dot: "bg-red-500" },
  absent: { label: "No check-in", cell: "bg-stone-100 text-stone-400", dot: "bg-stone-300" },
};
