"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertPermission } from "@/lib/session";

export type EmployeeFormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; id?: string; values?: Record<string, string | boolean> };

const optional = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v === "" ? null : v));

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  employeeCode: optional,
  phone: optional,
  designation: optional,
  roleId: z.string().min(1, "Pick a role"),
  mainProjectId: optional,
  reportsToId: optional,
  isActive: z.boolean(),
  password: z.string().max(200).optional(),
});

export async function saveEmployee(_prev: EmployeeFormState, formData: FormData): Promise<EmployeeFormState> {
  // Echo submitted values back so the form keeps them after a failed save.
  const values: Record<string, string | boolean> = {};
  for (const [k, v] of formData.entries()) if (k !== "password" && typeof v === "string" && !k.startsWith("$")) values[k] = v;
  values.isActive = formData.get("isActive") === "on";
  const result = await save(formData);
  return result.ok ? result : { ...result, values };
}

async function save(formData: FormData): Promise<EmployeeFormState> {
  try {
    const user = await assertPermission("employees.manage");
    const parsed = schema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name") ?? "",
      email: formData.get("email") ?? "",
      employeeCode: formData.get("employeeCode") ?? "",
      phone: formData.get("phone") ?? "",
      designation: formData.get("designation") ?? "",
      roleId: formData.get("roleId") ?? "",
      mainProjectId: formData.get("mainProjectId") ?? "",
      reportsToId: formData.get("reportsToId") ?? "",
      isActive: formData.get("isActive") === "on",
      password: (formData.get("password") as string) || undefined,
    });
    if (!parsed.success) {
      return { error: "Please fix the highlighted fields.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
    }
    const d = parsed.data;
    const isNew = !d.id;
    if (isNew && (!d.password || d.password.length < 8)) return { fieldErrors: { password: "At least 8 characters" }, error: "Set an initial password." };
    if (d.password && d.password.length < 8) return { fieldErrors: { password: "At least 8 characters" }, error: "Password is too short." };

    const role = await prisma.role.findUnique({ where: { id: d.roleId }, include: { permissions: { where: { key: "admin.roles" }, select: { id: true } } } });
    if (!role) return { fieldErrors: { roleId: "Unknown role" } };
    // Only the super admin can hand out super-admin / role-management access, or edit such accounts.
    if (!user.isSuperAdmin && (role.isSuperAdmin || role.permissions.length)) return { fieldErrors: { roleId: "Only the Managing Director can assign this role" } };
    if (!isNew) {
      const existing = await prisma.user.findUnique({ where: { id: d.id }, include: { role: { select: { isSuperAdmin: true } } } });
      if (!existing) return { error: "Employee not found." };
      if (existing.role.isSuperAdmin && !user.isSuperAdmin) return { error: "Only the Managing Director can edit this account." };
      if (existing.id === user.id && !d.isActive) return { fieldErrors: { isActive: "You can't deactivate yourself" } };
    }

    const data = {
      name: d.name,
      email: d.email,
      employeeCode: d.employeeCode,
      phone: d.phone,
      designation: d.designation,
      roleId: d.roleId,
      mainProjectId: d.mainProjectId,
      reportsToId: d.reportsToId && d.reportsToId !== d.id ? d.reportsToId : null,
      isActive: d.isActive,
      ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}),
    };

    const saved = await prisma.$transaction(async (tx) => {
      const u = isNew
        ? await tx.user.create({ data: { ...data, passwordHash: data.passwordHash! } })
        : await tx.user.update({ where: { id: d.id }, data });
      // Being "main" on a project implies membership.
      if (u.mainProjectId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: u.mainProjectId, userId: u.id } },
          create: { projectId: u.mainProjectId, userId: u.id, projectRole: u.designation },
          update: {},
        });
      }
      return u;
    });

    revalidatePath("/employees");
    revalidatePath(`/employees/${saved.id}`);
    return { ok: true, id: saved.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: string[] } | undefined)?.target ?? "");
      return target.includes("employeeCode") ? { fieldErrors: { employeeCode: "Already in use" } } : { fieldErrors: { email: "Already in use" } };
    }
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
}
