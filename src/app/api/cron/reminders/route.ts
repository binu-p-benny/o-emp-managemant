import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { runDailyReminders } from "@/lib/workflow/reminders-runner";

export const runtime = "nodejs";

/**
 * Runs the daily reminder job now. Callable by an external scheduler with
 * `Authorization: Bearer $CRON_SECRET`, or by the MD from Settings.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  let allowed = !!secret && bearer === secret;
  if (!allowed) {
    const user = await getCurrentUser();
    allowed = !!user?.isSuperAdmin;
  }
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDailyReminders();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
