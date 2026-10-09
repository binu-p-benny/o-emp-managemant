// Row-level visibility rules.
//   • "all" permissions (or super admin) → everything
//   • team permissions → everyone whose role sits in the viewer's org-chart subtree
//   • otherwise → only the viewer's own records / assigned projects

import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/session";

const getRoleTree = cache(async () => {
  const roles = await prisma.role.findMany({ select: { id: true, parentId: true } });
  const children = new Map<string, string[]>();
  for (const r of roles) {
    if (!r.parentId) continue;
    children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  }
  return children;
});

/** The role itself plus every role below it on the org chart. */
export async function subtreeRoleIds(roleId: string): Promise<string[]> {
  const children = await getRoleTree();
  const out: string[] = [];
  const stack = [roleId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Ancestors of a role, nearest first (excluding the role itself). */
export async function ancestorRoleIds(roleId: string): Promise<string[]> {
  const roles = await prisma.role.findMany({ select: { id: true, parentId: true } });
  const parentOf = new Map(roles.map((r) => [r.id, r.parentId]));
  const out: string[] = [];
  let current = parentOf.get(roleId) ?? null;
  while (current && !out.includes(current)) {
    out.push(current);
    current = parentOf.get(current) ?? null;
  }
  return out;
}

const getTeamUserIds = cache(async (userId: string, roleId: string) => {
  const roleIds = await subtreeRoleIds(roleId);
  const users = await prisma.user.findMany({ where: { roleId: { in: roleIds } }, select: { id: true } });
  const ids = new Set(users.map((u) => u.id));
  ids.add(userId);
  return [...ids];
});

export type UserScope = { all: true } | { all: false; userIds: string[] };

export async function attendanceScope(user: CurrentUser): Promise<UserScope> {
  if (can(user, "attendance.all.view")) return { all: true };
  if (can(user, "attendance.team.view")) return { all: false, userIds: await getTeamUserIds(user.id, user.roleId) };
  return { all: false, userIds: [user.id] };
}

export async function employeeScope(user: CurrentUser): Promise<UserScope> {
  if (can(user, "employees.view.all")) return { all: true };
  if (can(user, "employees.view.team", "attendance.team.view"))
    return { all: false, userIds: await getTeamUserIds(user.id, user.roleId) };
  return { all: false, userIds: [user.id] };
}

export function userWhere(scope: UserScope): Prisma.UserWhereInput {
  return scope.all ? {} : { id: { in: scope.userIds } };
}

export function inScope(scope: UserScope, userId: string): boolean {
  return scope.all || scope.userIds.includes(userId);
}

/** Projects the user can see: all, or ones they (or their team) are assigned to. */
export async function projectWhere(user: CurrentUser): Promise<Prisma.ProjectWhereInput> {
  if (can(user, "projects.view.all")) return {};
  const scope = await employeeScope(user);
  const userIds = scope.all ? [user.id] : scope.userIds;
  return { members: { some: { userId: { in: userIds } } } };
}

export async function canViewProject(user: CurrentUser, projectId: string): Promise<boolean> {
  const where = await projectWhere(user);
  const found = await prisma.project.findFirst({ where: { AND: [where, { id: projectId }] }, select: { id: true } });
  return !!found;
}

/** Can the user edit this project's settings? Needs projects.edit and visibility. */
export async function canEditProject(user: CurrentUser, projectId: string): Promise<boolean> {
  return can(user, "projects.edit") && (await canViewProject(user, projectId));
}
