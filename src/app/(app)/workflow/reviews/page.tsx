import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { TaskRow } from "@/components/workflow/task-row";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isOwner } from "@/lib/workflow/access";
import { listReviewQueue } from "@/lib/workflow/queries";
import { actorFor } from "@/lib/workflow/service";
import { ROLES } from "@/lib/workflow/types";

export const metadata: Metadata = { title: "Task reviews" };

export default async function ReviewQueuePage() {
  const user = await requireUser();
  const actor = await actorFor(prisma, user.id);
  if (![ROLES.ARCHITECT_HEAD, ROLES.CONSTRUCTION_HEAD].includes(actor.roleKey as never) && !isOwner(actor)) redirect("/forbidden");
  const queue = await listReviewQueue(actor);

  return (
    <div>
      <PageHeader title="Task reviews" subtitle="Work submitted for your approval, oldest first. Approve to move the workflow on, or send it back with a reason." />
      {queue.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="Nothing is waiting for your review" />
        </Card>
      ) : (
        <Card>
          <ul>
            {queue.map(({ project, task }) => (
              <TaskRow key={task.id} task={task} project={{ id: project.id, code: project.code }} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
