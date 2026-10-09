import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getOpenCheckIn } from "@/lib/attendance";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { CheckInFlow } from "./check-in-flow";

export const metadata: Metadata = { title: "Check in / out" };

export default async function CheckInPage() {
  const user = await requirePermission("attendance.self");
  const open = await getOpenCheckIn(user.id);

  const projects = await prisma.project.findMany({
    where: {
      OR: [{ members: { some: { userId: user.id } } }, ...(user.mainProjectId ? [{ id: user.mainProjectId }] : [])],
      projectStage: { notIn: ["Completed", "Cancelled"] },
    },
    select: {
      id: true,
      projectCode: true,
      projectName: true,
      latitude: true,
      longitude: true,
      attendanceRadius: true,
      outOfRangePolicy: true,
      address: true,
    },
    orderBy: { projectCode: "asc" },
  });

  const openProject = open ? await prisma.project.findUnique({
    where: { id: open.projectId },
    select: { id: true, projectCode: true, projectName: true, latitude: true, longitude: true, attendanceRadius: true, outOfRangePolicy: true, address: true },
  }) : null;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={open ? "Check out" : "Check in"}
        subtitle={open ? `Checked in at ${open.project.projectCode} — capture a selfie to check out.` : "Live selfie + GPS, verified against your project's geofence."}
        back={{ href: "/attendance", label: "My attendance" }}
      />
      <CheckInFlow
        mode={open ? "CHECK_OUT" : "CHECK_IN"}
        checkedInAt={open?.timestamp.toISOString() ?? null}
        projects={openProject ? [openProject] : projects}
        defaultProjectId={openProject?.id ?? (projects.some((p) => p.id === user.mainProjectId) ? user.mainProjectId : projects[0]?.id) ?? null}
        mainProjectId={user.mainProjectId}
      />
    </div>
  );
}
