// In-app notifications (no email/SMS in this version).

import { randomUUID } from "node:crypto";
import type { NotificationType, Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type NotifyInput = {
  userIds: (string | null | undefined)[];
  type: NotificationType;
  message: string;
  taskId?: string | null;
  projectId?: string | null;
  /** Users who triggered the event and shouldn't be told about their own action. */
  except?: string | null;
};

/** Event notifications — sent immediately, one row per recipient. */
export async function notify(db: Db, input: NotifyInput) {
  const recipients = [...new Set(input.userIds.filter((u): u is string => !!u && u !== input.except))];
  if (!recipients.length) return;
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      message: input.message,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      dedupeKey: `${input.type}:${input.taskId ?? "-"}:${userId}:${randomUUID()}`,
    })),
    skipDuplicates: true,
  });
}
