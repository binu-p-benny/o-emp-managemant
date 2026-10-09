"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dateOnly } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { projectPayloadSchema, type ProjectPayload } from "@/lib/project-schema";
import { canViewProject } from "@/lib/scope";
import { assertPermission, can } from "@/lib/session";
import { onProjectSaved } from "@/lib/workflow/service";

export type SaveProjectResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function saveProject(payload: ProjectPayload): Promise<SaveProjectResult> {
  try {
    const user = await assertPermission("projects.create", "projects.edit", "projects.members.manage");
    const parsed = projectPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.slice(issue.path[0] === "details" ? 1 : 0).join(".");
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    const { id, details: d, members, locations } = parsed.data;

    const isNew = !id;
    const canDetails = isNew ? can(user, "projects.create") : can(user, "projects.edit");
    const canMembers = can(user, "projects.members.manage") || (isNew && can(user, "projects.create"));
    if (isNew && !canDetails) return { ok: false, error: "You cannot create projects." };
    if (!isNew && !(await canViewProject(user, id))) return { ok: false, error: "Project not found." };
    if (!canDetails && !canMembers) return { ok: false, error: "You cannot edit this project." };

    const detailData = {
      projectCode: d.projectCode,
      projectName: d.projectName,
      projectStage: d.projectStage,
      projectCategory: d.projectCategory,
      startDate: dateOnly(d.startDate),
      endDate: dateOnly(d.endDate),
      address: d.address,
      latitude: d.latitude,
      longitude: d.longitude,
      companyBranch: d.companyBranch ?? null,
      attendanceRadius: d.attendanceRadius,
      outOfRangePolicy: d.outOfRangePolicy,
      projectValue: d.projectValue ?? null,
      orientation: d.orientation ?? null,
      dimension: d.dimension ?? null,
      scopeOfWork: d.scopeOfWork ?? null,
    };

    const uniqueMembers = [...new Map(members.map((m) => [m.userId, m])).values()];

    const projectId = await prisma.$transaction(async (tx) => {
      let pid: string;
      if (isNew) {
        const created = await tx.project.create({ data: detailData });
        pid = created.id;
      } else {
        pid = id;
        if (canDetails) await tx.project.update({ where: { id: pid }, data: detailData });
      }

      if (canMembers) {
        const keep = uniqueMembers.map((m) => m.userId);
        await tx.projectMember.deleteMany({ where: { projectId: pid, userId: { notIn: keep } } });
        for (const m of uniqueMembers) {
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: pid, userId: m.userId } },
            create: { projectId: pid, userId: m.userId, projectRole: m.projectRole ?? null },
            update: { projectRole: m.projectRole ?? null },
          });
        }
        const mainIds = uniqueMembers.filter((m) => m.isMain).map((m) => m.userId);
        // Members unticked as "main" lose this project as their main one.
        await tx.user.updateMany({ where: { mainProjectId: pid, id: { notIn: mainIds } }, data: { mainProjectId: null } });
        if (mainIds.length) await tx.user.updateMany({ where: { id: { in: mainIds } }, data: { mainProjectId: pid } });
      }

      if (canDetails) {
        await tx.projectLocation.deleteMany({ where: { projectId: pid } });
        const idByKey = new Map<string, string>();
        // Parents before children (input is in display order, but be defensive).
        const pending = [...locations];
        let guard = 0;
        while (pending.length && guard++ < 10_000) {
          const loc = pending.shift()!;
          if (loc.parentKey && !idByKey.has(loc.parentKey)) {
            if (!locations.some((l) => l.key === loc.parentKey)) continue; // orphan → drop
            pending.push(loc);
            continue;
          }
          const created = await tx.projectLocation.create({
            data: {
              projectId: pid,
              parentId: loc.parentKey ? idByKey.get(loc.parentKey)! : null,
              name: loc.name,
              type: loc.type ?? null,
              sortOrder: locations.indexOf(loc),
            },
          });
          idByKey.set(loc.key, created.id);
        }
      }
      return pid;
    });

    // Workflow engine: a new project starts Design Phase 1 on day 0; a moved start date re-plans AUTO dates.
    await onProjectSaved(projectId, { isNew });

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, id: projectId };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "That project code is already in use.", fieldErrors: { projectCode: "Already in use" } };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the project." };
  }
}

export async function deleteProject(formData: FormData) {
  const user = await assertPermission("projects.delete");
  const id = z.string().min(1).parse(formData.get("id"));
  if (!(await canViewProject(user, id))) throw new Error("Project not found.");
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  redirect("/projects");
}
