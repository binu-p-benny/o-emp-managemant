import { NextResponse } from "next/server";
import { attendanceScope, inScope } from "@/lib/scope";
import { getCurrentUser } from "@/lib/session";
import { getFile } from "@/lib/storage";

export const runtime = "nodejs";

/** Streams stored files after checking the viewer may see them. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { key: parts } = await params;
  const key = parts.join("/");

  // selfies/<userId>/... → owner, or anyone whose attendance scope covers that user
  if (parts[0] === "selfies" && parts[1]) {
    const ownerId = parts[1];
    if (ownerId !== user.id && !inScope(await attendanceScope(user), ownerId)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else {
    return new NextResponse("Not found", { status: 404 });
  }

  const file = await getFile(key).catch(() => null);
  if (!file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
