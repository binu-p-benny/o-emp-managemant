"use server";

// Server actions for department modules: site logs, BoQ, vendors, purchase orders.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dateOnly } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/format";
import { canViewProject } from "@/lib/scope";
import { assertPermission, can, type CurrentUser } from "@/lib/session";

export type FormState = { ok?: boolean; error?: string; message?: string };

function fail(e: unknown, fallback: string): FormState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That record already exists." };
  return { error: e instanceof Error ? e.message : fallback };
}

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .optional()
    .nullable();

// ─── Site logs ──────────────────────────────────────────────────────────────

export async function createSiteLog(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("sitelogs.create");
    const d = z
      .object({
        projectId: z.string().min(1, "Pick a project"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weather: optStr(60),
        manpower: z.coerce.number().int().min(0).max(5000).optional(),
        workDone: str(4000).min(3, "Describe the work done"),
        issues: optStr(2000),
      })
      .parse({
        projectId: formData.get("projectId"),
        date: formData.get("date"),
        weather: formData.get("weather"),
        manpower: formData.get("manpower") || undefined,
        workDone: formData.get("workDone"),
        issues: formData.get("issues"),
      });
    if (!(await canViewProject(user, d.projectId))) return { error: "You are not assigned to this project." };
    await prisma.siteLog.create({ data: { ...d, date: dateOnly(d.date), authorId: user.id } });
    revalidatePath("/site-logs");
    revalidatePath(`/projects/${d.projectId}`);
    return { ok: true, message: "Site log saved." };
  } catch (e) {
    return fail(e, "Could not save the site log.");
  }
}

// ─── BoQ ────────────────────────────────────────────────────────────────────

export async function addBoqItem(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("costing.edit");
    const d = z
      .object({
        projectId: z.string().min(1),
        section: str(60).min(1, "Section required"),
        itemCode: optStr(30),
        description: str(500).min(2, "Description required"),
        unit: str(20).min(1, "Unit required"),
        quantity: z.coerce.number().positive("Quantity must be > 0").max(1e9),
        rate: z.coerce.number().nonnegative().max(1e10),
      })
      .parse(Object.fromEntries(formData));
    if (!(await canViewProject(user, d.projectId))) return { error: "Project not found." };
    const count = await prisma.boqItem.count({ where: { projectId: d.projectId } });
    await prisma.boqItem.create({ data: { ...d, sortOrder: count } });
    revalidatePath("/costing");
    return { ok: true, message: "Item added." };
  } catch (e) {
    return fail(e, "Could not add the item.");
  }
}

export async function deleteBoqItem(formData: FormData) {
  const user = await assertPermission("costing.edit");
  const id = z.string().min(1).parse(formData.get("id"));
  const item = await prisma.boqItem.findUnique({ where: { id } });
  if (!item || !(await canViewProject(user, item.projectId))) return;
  await prisma.boqItem.delete({ where: { id } });
  revalidatePath("/costing");
}

// ─── Vendors ────────────────────────────────────────────────────────────────

export async function saveVendor(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertPermission("procurement.vendors.manage");
    const d = z
      .object({
        name: str(120).min(2, "Name required"),
        category: optStr(60),
        contactPerson: optStr(80),
        phone: optStr(30),
        email: z.union([z.literal(""), z.string().trim().email()]).transform((v) => v || null).optional(),
        gstin: optStr(20),
        address: optStr(300),
      })
      .parse(Object.fromEntries(formData));
    await prisma.vendor.create({ data: d });
    revalidatePath("/procurement/vendors");
    return { ok: true, message: `${d.name} added.` };
  } catch (e) {
    return fail(e, "Could not save the vendor.");
  }
}

// ─── Purchase orders & approval chain ──────────────────────────────────────
//
// A PO is routed up the org chart starting from the raiser's *parent* role.
// Each role in the chain with PO-approval authority signs off; if the amount is
// within that role's approval limit the PO is approved, otherwise it is
// escalated to the next role up. The super admin (MD) can approve anything.

type RoleNode = { id: string; name: string; parentId: string | null; isSuperAdmin: boolean; approvalLimit: Prisma.Decimal | null; canApprove: boolean };

async function roleMap(): Promise<Map<string, RoleNode>> {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, parentId: true, isSuperAdmin: true, approvalLimit: true, permissions: { where: { key: "procurement.po.approve" }, select: { id: true } } },
  });
  return new Map(roles.map((r) => [r.id, { ...r, canApprove: r.isSuperAdmin || r.permissions.length > 0 }]));
}

/** Next role above `roleId` that can approve purchase orders. */
function nextApprover(roles: Map<string, RoleNode>, roleId: string): RoleNode | null {
  let cur = roles.get(roleId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = roles.get(cur);
    if (!node) break;
    if (node.canApprove && (node.isSuperAdmin || node.approvalLimit !== null)) return node;
    cur = node.parentId;
  }
  return [...roles.values()].find((r) => r.isSuperAdmin) ?? null;
}

async function nextPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count({ where: { poNumber: { startsWith: `PO-${year}-` } } });
  return `PO-${year}-${String(count + 1).padStart(3, "0")}`;
}

export async function createPurchaseOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("procurement.po.create");
    const d = z
      .object({
        projectId: z.string().min(1, "Pick a project"),
        vendorId: z.string().min(1, "Pick a vendor"),
        description: str(1000).min(3, "Describe the materials / services"),
        amount: z.coerce.number().positive("Amount must be > 0").max(1e11),
      })
      .parse(Object.fromEntries(formData));
    if (!(await canViewProject(user, d.projectId)) && !can(user, "procurement.view")) return { error: "Project not found." };

    const roles = await roleMap();
    const selfApprove = user.isSuperAdmin;
    const approver = selfApprove ? null : nextApprover(roles, user.roleId);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const po = await prisma.purchaseOrder.create({
          data: {
            ...d,
            poNumber: await nextPoNumber(),
            createdById: user.id,
            status: selfApprove ? "APPROVED" : "PENDING",
            awaitingRoleId: approver?.id ?? null,
            approvals: selfApprove ? { create: { approverId: user.id, roleId: user.roleId, decision: "APPROVED", note: "Raised by MD" } } : undefined,
          },
        });
        revalidatePath("/procurement");
        return { ok: true, message: selfApprove ? `${po.poNumber} created and approved.` : `${po.poNumber} sent to ${approver?.name} for approval.` };
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
    return { error: "Could not allocate a PO number, please retry." };
  } catch (e) {
    return fail(e, "Could not create the purchase order.");
  }
}

function canActOn(user: CurrentUser, awaitingRoleId: string | null) {
  return can(user, "procurement.po.approve") && (user.isSuperAdmin || awaitingRoleId === user.roleId);
}

export async function decidePurchaseOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("procurement.po.approve");
    const d = z
      .object({ id: z.string().min(1), decision: z.enum(["APPROVE", "REJECT"]), note: optStr(500) })
      .parse({ id: formData.get("id"), decision: formData.get("decision"), note: formData.get("note") });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: d.id } });
    if (!po || po.status !== "PENDING") return { error: "This purchase order is no longer pending." };
    if (!canActOn(user, po.awaitingRoleId)) return { error: "This purchase order is waiting on another approver." };
    if (po.createdById === user.id && !user.isSuperAdmin) return { error: "You can't approve your own purchase order." };
    if (d.decision === "REJECT" && !d.note) return { error: "Add a note explaining the rejection." };

    const roles = await roleMap();
    const myRole = roles.get(user.roleId)!;
    const amount = toNumber(po.amount);
    const withinLimit = myRole.isSuperAdmin || (myRole.approvalLimit !== null && amount <= toNumber(myRole.approvalLimit));
    const next = d.decision === "APPROVE" && !withinLimit ? nextApprover(roles, user.roleId) : null;

    const decision = d.decision === "REJECT" ? "REJECTED" : withinLimit || !next ? "APPROVED" : "ESCALATED";
    await prisma.$transaction([
      prisma.purchaseOrderApproval.create({ data: { purchaseOrderId: po.id, approverId: user.id, roleId: user.roleId, decision, note: d.note ?? null } }),
      prisma.purchaseOrder.update({
        where: { id: po.id },
        data:
          decision === "ESCALATED"
            ? { awaitingRoleId: next!.id }
            : { status: decision === "APPROVED" ? "APPROVED" : "REJECTED", awaitingRoleId: null },
      }),
    ]);
    revalidatePath("/procurement");
    return {
      ok: true,
      message: decision === "ESCALATED" ? `Endorsed and escalated to ${next!.name} (above your limit).` : decision === "APPROVED" ? "Approved." : "Rejected.",
    };
  } catch (e) {
    return fail(e, "Could not record the decision.");
  }
}
