import type { Metadata } from "next";
import { saveVendor } from "@/actions/modules";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatINRCompact, toNumber } from "@/lib/format";
import { can, requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await requirePermission("procurement.view");
  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: { purchaseOrders: { where: { status: "APPROVED" }, select: { amount: true } }, _count: { select: { purchaseOrders: true } } },
  });

  return (
    <div>
      <PageHeader title="Vendors" subtitle="Approved suppliers and sub-contractors." back={{ href: "/procurement", label: "Purchase orders" }} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {vendors.length === 0 ? (
            <EmptyState icon="package" title="No vendors yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Contact</th>
                    <th>GSTIN</th>
                    <th className="text-right">POs</th>
                    <th className="text-right">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td className="font-medium">{v.name}</td>
                      <td className="text-stone-600">{v.category ?? "—"}</td>
                      <td className="text-xs text-stone-600">
                        {v.contactPerson ?? "—"}
                        {v.phone && <span className="block">{v.phone}</span>}
                      </td>
                      <td className="font-mono text-xs">{v.gstin ?? "—"}</td>
                      <td className="text-right tabular-nums">{v._count.purchaseOrders}</td>
                      <td className="text-right tabular-nums">{formatINRCompact(v.purchaseOrders.reduce((n, p) => n + toNumber(p.amount), 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {can(user, "procurement.vendors.manage") && (
          <Card title="Add vendor" className="h-fit">
            <ActionForm action={saveVendor} className="grid gap-3 p-4" submitLabel={<><Icon name="plus" /> Add vendor</>}>
              <label className="block">
                <span className="label">Name</span>
                <input name="name" required className="input" />
              </label>
              <label className="block">
                <span className="label">Category</span>
                <input name="category" list="vendor-cats" className="input" placeholder="Cement & Steel" />
                <datalist id="vendor-cats">
                  {["Cement & Steel", "Aggregates", "Bricks & Blocks", "Tiles & Sanitary", "Electrical", "Plumbing", "Paints", "Joinery", "Modular Kitchen", "Labour Contractor"].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Contact person</span>
                  <input name="contactPerson" className="input" />
                </label>
                <label className="block">
                  <span className="label">Phone</span>
                  <input name="phone" type="tel" className="input" />
                </label>
              </div>
              <label className="block">
                <span className="label">Email</span>
                <input name="email" type="email" className="input" />
              </label>
              <label className="block">
                <span className="label">GSTIN</span>
                <input name="gstin" className="input" maxLength={15} />
              </label>
              <label className="block">
                <span className="label">Address</span>
                <textarea name="address" rows={2} className="input" />
              </label>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
