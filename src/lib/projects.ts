import type { EmployeeOption, ProjectFormDetails, ProjectFormLocation, ProjectFormMember } from "@/components/project-form";
import { dateOnlyKey } from "@/lib/dates";
import { prisma } from "@/lib/db";

export async function employeeOptions(): Promise<EmployeeOption[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      designation: true,
      mainProjectId: true,
      role: { select: { name: true, sortOrder: true } },
      mainProject: { select: { projectCode: true } },
    },
    orderBy: [{ role: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    roleName: u.role.name,
    designation: u.designation,
    mainProjectId: u.mainProjectId,
    mainProjectCode: u.mainProject?.projectCode ?? null,
  }));
}

export async function loadProjectForm(id: string) {
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { mainProjectId: true } } }, orderBy: { assignedAt: "asc" } },
      locations: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!p) return null;
  const details: ProjectFormDetails = {
    projectCode: p.projectCode,
    projectName: p.projectName,
    projectStage: p.projectStage,
    projectCategory: p.projectCategory,
    startDate: dateOnlyKey(p.startDate),
    endDate: dateOnlyKey(p.endDate),
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    companyBranch: p.companyBranch ?? "",
    attendanceRadius: String(p.attendanceRadius),
    outOfRangePolicy: p.outOfRangePolicy,
    projectValue: p.projectValue ? p.projectValue.toString() : "",
    orientation: p.orientation ?? "",
    dimension: p.dimension ?? "",
    scopeOfWork: p.scopeOfWork ?? "",
  };
  const members: ProjectFormMember[] = p.members.map((m) => ({
    userId: m.userId,
    projectRole: m.projectRole ?? "",
    isMain: m.user.mainProjectId === p.id,
  }));
  const locations: ProjectFormLocation[] = sortTree(
    p.locations.map((l) => ({ key: l.id, parentKey: l.parentId, name: l.name, type: l.type ?? "Zone" })),
  );
  return { project: p, details, members, locations };
}

/** Depth-first order so each parent precedes its children. */
export function sortTree<T extends { key: string; parentKey: string | null }>(items: T[]): T[] {
  const out: T[] = [];
  const visit = (parent: string | null) => {
    for (const item of items.filter((i) => i.parentKey === parent)) {
      out.push(item);
      visit(item.key);
    }
  };
  visit(null);
  return out;
}
