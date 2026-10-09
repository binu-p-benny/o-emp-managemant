import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

/** Marks a notification read and opens the task it's about. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const origin = new URL(req.url).origin;
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const { id } = await params;
  const n = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, taskId: true, projectId: true, readAt: true } });
  if (!n) return NextResponse.redirect(new URL("/notifications", origin));
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const target = n.projectId ? `/projects/${n.projectId}?tab=workflow${n.taskId ? `&task=${n.taskId}#task-${n.taskId}` : ""}` : "/notifications";
  return NextResponse.redirect(new URL(target, origin));
}
