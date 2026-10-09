"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { PERMISSION_KEYS, isPermissionKey, isSelfService } from "@/lib/permissions";
import { subtreeRoleIds } from "@/lib/scope";
import { assertPermission } from "@/lib/session";

export type RoleFormState = { ok?: boolean; error?: string; message?: string };

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  department: z.enum(["Management", "Office", "Design", "Site", "Procurement", "Costing"]),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null),
  parentId: z.string().transform((v) => v || null),
  approvalLimit: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Approval limit must be a positive number"),
});

export async function saveRole(_prev: RoleFormState, formData: FormData): Promise<RoleFormState> {
  try {
    await assertPermission("admin.roles");
    const d = schema.parse({
      id: formData.get("id") || undefined,
      name: formData.get("name") ?? "",
      department: formData.get("department"),
      description: formData.get("description") ?? "",
      parentId: formData.get("parentId") ?? "",
      approvalLimit: formData.get("approvalLimit") ?? "",
    });
    const permissionKeys = formData.getAll("permissions").map(String).filter(isPermissionKey);

    if (d.id) {
      const role = await prisma.role.findUnique({ where: { id: d.id } });
      if (!role) return { error: "Role not found." };
      if (d.parentId && (await subtreeRoleIds(d.id)).includes(d.parentId)) return { error: "A role can't report to itself or one of its own sub-roles." };
      await prisma.role.update({
        where: { id: d.id },
        data: {
          name: d.name,
          department: d.department,
          description: d.description,
          approvalLimit: d.approvalLimit,
          // The top role stays at the top and keeps every access permission; only self-service duties are optional.
          ...(role.isSuperAdmin
            ? { permissions: { set: [...PERMISSION_KEYS.filter((k) => !isSelfService(k)), ...permissionKeys.filter(isSelfService)].map((key) => ({ key })) } }
            : { parentId: d.parentId, permissions: { set: [], connect: permissionKeys.map((key) => ({ key })) } }),
        },
      });
      revalidatePath("/admin/roles");
      revalidatePath(`/admin/roles/${d.id}`);
      return { ok: true, message: "Role saved. Changes apply on the next page load for affected users." };
    }

    const count = await prisma.role.count();
    const created = await prisma.role.create({
      data: {
        key: d.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Date.now().toString(36).toUpperCase(),
        name: d.name,
        department: d.department,
        description: d.description,
        parentId: d.parentId,
        approvalLimit: d.approvalLimit,
        sortOrder: count,
        permissions: { connect: permissionKeys.map((key) => ({ key })) },
      },
    });
    revalidatePath("/admin/roles");
    redirect(`/admin/roles/${created.id}`);
  } catch (e) {
    if (e instanceof Error && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof Error && e.message.includes("Unique constraint")) return { error: "A role with that name already exists." };
    return { error: e instanceof Error ? e.message : "Could not save the role." };
  }
}
