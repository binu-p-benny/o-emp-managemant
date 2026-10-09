import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPermissionKey, isSelfService, type Department, type PermissionKey } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  employeeCode: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  department: Department;
  isSuperAdmin: boolean;
  mainProjectId: string | null;
  permissions: Set<PermissionKey>;
};

/**
 * Loads the signed-in user fresh from the database on every request, so role
 * or permission changes (and deactivation) take effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    include: { role: { include: { permissions: { select: { key: true } } } } },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    designation: user.designation,
    employeeCode: user.employeeCode,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleName: user.role.name,
    department: user.role.department as Department,
    isSuperAdmin: user.role.isSuperAdmin,
    mainProjectId: user.mainProjectId,
    permissions: new Set(user.role.permissions.map((p) => p.key).filter(isPermissionKey)),
  };
});

/** Super admin implies every permission except self-service duties such as checking in. */
export function can(user: CurrentUser, ...perms: PermissionKey[]): boolean {
  return perms.some((p) => user.permissions.has(p) || (user.isSuperAdmin && !isSelfService(p)));
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Requires at least one of the given permissions. */
export async function requirePermission(...perms: PermissionKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, ...perms)) redirect("/forbidden");
  return user;
}

export class AuthError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertPermission(...perms: PermissionKey[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Your session has expired. Please sign in again.");
  if (perms.length && !can(user, ...perms)) throw new AuthError();
  return user;
}
