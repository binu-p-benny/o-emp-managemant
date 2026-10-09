import { NextResponse } from "next/server";
import { addDays, isDateKey, startOfDay, toDateKey, todayKey, APP_TIMEZONE } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { attendanceScope } from "@/lib/scope";
import { can, getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralise spreadsheet formula injection.
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "attendance.export")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const fromKey = isDateKey(url.searchParams.get("from")) ? url.searchParams.get("from")! : addDays(todayKey(), -30);
  const toKey = isDateKey(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayKey();
  const projectId = url.searchParams.get("project") || undefined;
  const roleId = url.searchParams.get("role") || undefined;

  const scope = await attendanceScope(user);
  const records = await prisma.attendance.findMany({
    where: {
      timestamp: { gte: startOfDay(fromKey), lt: startOfDay(addDays(toKey, 1)) },
      ...(scope.all ? {} : { userId: { in: scope.userIds } }),
      ...(projectId ? { projectId } : {}),
      ...(roleId ? { user: { roleId } } : {}),
    },
    orderBy: [{ timestamp: "asc" }],
    take: 50_000,
    include: {
      user: { select: { employeeCode: true, name: true, email: true, role: { select: { name: true } } } },
      project: { select: { projectCode: true, projectName: true } },
      reviewedBy: { select: { name: true } },
      checkIn: { select: { timestamp: true } },
    },
  });

  const time = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const header = [
    "Date",
    "Time",
    "Employee Code",
    "Employee",
    "Email",
    "Role",
    "Project Code",
    "Project",
    "Type",
    "Latitude",
    "Longitude",
    "GPS Accuracy (m)",
    "Distance (m)",
    "Radius (m)",
    "In Range",
    "Review Status",
    "Reviewed By",
    "Review Note",
    "Hours (on check-out)",
    "Location",
    "Selfie URL",
  ];
  const origin = url.origin;
  const rows = records.map((r) => [
    toDateKey(r.timestamp),
    time.format(r.timestamp),
    r.user.employeeCode,
    r.user.name,
    r.user.email,
    r.user.role.name,
    r.project.projectCode,
    r.project.projectName,
    r.type === "CHECK_IN" ? "Check-in" : "Check-out",
    Number(r.latitude.toFixed(6)),
    Number(r.longitude.toFixed(6)),
    r.accuracyMeters != null ? Math.round(r.accuracyMeters) : "",
    Math.round(r.distanceMeters),
    r.radiusMeters,
    r.inRange ? "Yes" : "No",
    r.reviewStatus,
    r.reviewedBy?.name,
    r.reviewNote,
    r.checkIn ? ((r.timestamp.getTime() - r.checkIn.timestamp.getTime()) / 3_600_000).toFixed(2) : "",
    r.locationLabel,
    origin + r.selfieUrl,
  ]);

  const csv = "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance_${fromKey}_to_${toKey}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
