import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getOpenCheckIn } from "@/lib/attendance";
import { prisma } from "@/lib/db";
import { distanceMeters, formatDistance } from "@/lib/geo";
import { can, getCurrentUser } from "@/lib/session";
import { fileUrl, putFile } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_SELFIE_BYTES = 1_500_000;
const MAX_CAPTURE_AGE_MS = 3 * 60_000;

const bodySchema = z.object({
  type: z.enum(["CHECK_IN", "CHECK_OUT"]),
  projectId: z.string().min(1).optional(),
  selfie: z.string().startsWith("data:image/jpeg;base64,"),
  capturedAt: z.number().int(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(100_000).nullable().optional(),
  locationLabel: z.string().trim().max(300).optional(),
});

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail(401, "Your session has expired. Please sign in again.");
  if (!can(user, "attendance.self")) return fail(403, "Your role is not set up for attendance.");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return fail(400, "Missing selfie or location. Please retake and try again.");
  }

  // Live-capture only: the client stamps the capture time; reject stale captures.
  if (Math.abs(Date.now() - body.capturedAt) > MAX_CAPTURE_AGE_MS) {
    return fail(400, "The selfie is too old. Please capture a fresh one.");
  }

  const image = Buffer.from(body.selfie.slice("data:image/jpeg;base64,".length), "base64");
  const isJpeg = image.length > 4 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  if (!isJpeg || image.length < 2_000) return fail(400, "The selfie image is invalid. Please retake it.");
  if (image.length > MAX_SELFIE_BYTES) return fail(413, "The selfie image is too large.");

  const open = await getOpenCheckIn(user.id);

  let projectId: string;
  if (body.type === "CHECK_IN") {
    if (open) return fail(409, `You are already checked in at ${open.project.projectCode}. Check out first.`);
    projectId = body.projectId ?? user.mainProjectId ?? "";
    if (!projectId) return fail(400, "No project selected and no main project assigned. Ask HR to assign one.");
    const assigned =
      projectId === user.mainProjectId ||
      (await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } }));
    if (!assigned) return fail(403, "You are not assigned to this project.");
  } else {
    if (!open) return fail(409, "You are not checked in.");
    projectId = open.projectId;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, latitude: true, longitude: true, attendanceRadius: true, outOfRangePolicy: true },
  });
  if (!project) return fail(404, "Project not found.");

  // Distance is always computed server-side from the raw coordinates.
  const distance = distanceMeters(body.latitude, body.longitude, project.latitude, project.longitude);
  const inRange = distance <= project.attendanceRadius;

  if (!inRange && body.type === "CHECK_IN" && project.outOfRangePolicy === "BLOCK") {
    return fail(
      422,
      `You are ${formatDistance(distance)} from ${project.projectCode}. Check-in is only allowed within ${project.attendanceRadius} m of the site.`,
      { distanceMeters: Math.round(distance), radiusMeters: project.attendanceRadius },
    );
  }

  const key = `selfies/${user.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  await putFile(key, image, "image/jpeg");

  const record = await prisma.attendance
    .create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: body.type,
        selfieUrl: fileUrl(key),
        latitude: body.latitude,
        longitude: body.longitude,
        accuracyMeters: body.accuracy ?? null,
        locationLabel: body.locationLabel || null,
        distanceMeters: distance,
        radiusMeters: project.attendanceRadius,
        inRange,
        reviewStatus: inRange ? "NOT_REQUIRED" : "PENDING",
        deviceInfo: req.headers.get("user-agent")?.slice(0, 300) ?? null,
        checkInId: body.type === "CHECK_OUT" ? open!.id : null,
      },
    })
    .catch((e: unknown) => {
      // Unique checkInId: a parallel request already closed this check-in.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    });
  if (!record) return fail(409, "You have already checked out.");

  return NextResponse.json({
    id: record.id,
    type: record.type,
    inRange,
    distanceMeters: Math.round(distance),
    radiusMeters: project.attendanceRadius,
    projectCode: project.projectCode,
    timestamp: record.timestamp.toISOString(),
  });
}
