// Shared (client + server) project constants and validation.

import { z } from "zod";

export const PROJECT_STAGES = ["Enquiry", "Design", "Ongoing", "On Hold", "Completed", "Cancelled"] as const;
// Oranzai Builders service lines
export const PROJECT_CATEGORIES = [
  "Turnkey Project",
  "Construction",
  "Architectural Design",
  "Interior Design & Fit-out",
  "Renovation",
  "Survey & Valuation",
  "Office / Yard",
] as const;

/** Office / yard locations are attendance geofences only — no design/construction workflow. */
export const NON_WORKFLOW_CATEGORY = "Office / Yard";
export const ORIENTATIONS = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"] as const;
export const LOCATION_TYPES = ["Block", "Floor", "Zone", "Room", "Area"] as const;

export const COMPANY_BRANCHES: string[] = (process.env.NEXT_PUBLIC_COMPANY_BRANCHES || "Aluva (HQ)")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const STAGE_TONE: Record<string, "blue" | "violet" | "green" | "amber" | "gray" | "red" | "brand"> = {
  Enquiry: "violet",
  Design: "blue",
  Ongoing: "brand",
  "On Hold": "amber",
  Completed: "green",
  Cancelled: "red",
};

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const projectDetailsSchema = z
  .object({
    projectCode: z.string().trim().min(1, "Required").max(40),
    projectName: z.string().trim().min(1, "Required").max(200),
    projectStage: z.enum(PROJECT_STAGES),
    projectCategory: z.enum(PROJECT_CATEGORIES),
    startDate: dateKey,
    endDate: dateKey,
    address: z.string().trim().min(1, "Required").max(500),
    latitude: z.number({ message: "Set the location on the map" }).min(-90).max(90),
    longitude: z.number({ message: "Set the location on the map" }).min(-180).max(180),
    companyBranch: optionalText(100),
    attendanceRadius: z.number().int().min(10, "Min 10 m").max(10_000, "Max 10 km"),
    outOfRangePolicy: z.enum(["FLAG", "BLOCK"]),
    projectValue: z.number().nonnegative().max(1e12).nullable().optional(),
    orientation: optionalText(100),
    dimension: optionalText(100),
    scopeOfWork: optionalText(5000),
  })
  .refine((d) => d.endDate >= d.startDate, { path: ["endDate"], message: "End date must be after the start date" });

export const projectMemberSchema = z.object({
  userId: z.string().min(1),
  projectRole: optionalText(100),
  isMain: z.boolean().default(false),
});

export const projectLocationSchema = z.object({
  key: z.string().min(1),
  parentKey: z.string().nullable(),
  name: z.string().trim().min(1).max(100),
  type: optionalText(40),
});

export const projectPayloadSchema = z.object({
  id: z.string().optional(),
  details: projectDetailsSchema,
  members: z.array(projectMemberSchema).max(500),
  locations: z.array(projectLocationSchema).max(1000),
});

export type ProjectDetailsInput = z.input<typeof projectDetailsSchema>;
export type ProjectPayload = z.input<typeof projectPayloadSchema>;
