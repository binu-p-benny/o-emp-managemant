"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reviewableWhere } from "@/lib/attendance";
import { prisma } from "@/lib/db";
import { assertPermission } from "@/lib/session";

export type ActionResult = { ok?: boolean; error?: string };

const reviewSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

export async function reviewAttendance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const user = await assertPermission("attendance.review");
    const input = reviewSchema.parse({
      id: formData.get("id"),
      decision: formData.get("decision"),
      note: formData.get("note") || undefined,
    });
    if (input.decision === "REJECTED" && !input.note) return { error: "Add a note explaining the rejection." };

    const where = await reviewableWhere(user);
    const updated = await prisma.attendance.updateMany({
      where: { AND: [where, { id: input.id }] },
      data: { reviewStatus: input.decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: input.note ?? null },
    });
    if (updated.count === 0) return { error: "This entry was already reviewed or is outside your team." };

    revalidatePath("/attendance/review");
    revalidatePath("/attendance/team");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the review." };
  }
}
