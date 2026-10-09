"use client";

import { useActionState } from "react";
import { saveRole, type RoleFormState } from "@/actions/roles";
import { Icon } from "@/components/icons";

type RoleValues = {
  id: string;
  name: string;
  department: string;
  description: string;
  parentId: string;
  approvalLimit: string;
  isSuperAdmin: boolean;
  permissions: string[];
};

const DEPARTMENTS = ["Management", "Office", "Design", "Site", "Procurement", "Costing"];

export function RoleForm({
  role,
  parents,
  groups,
  selfService,
}: {
  role: RoleValues | null;
  parents: { id: string; name: string }[];
  groups: { name: string; perms: { key: string; label: string }[] }[];
  selfService: string[];
}) {
  const [state, action, pending] = useActionState<RoleFormState, FormData>(saveRole, {});
  const locked = !!role?.isSuperAdmin;

  return (
    <form action={action} className="space-y-6 p-4 sm:p-6">
      {role && <input type="hidden" name="id" value={role.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Role name</span>
          <input name="name" defaultValue={role?.name} required className="input" />
        </label>
        <label className="block">
          <span className="label">Department (theme)</span>
          <select name="department" defaultValue={role?.department ?? "Office"} className="input">
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Reports to</span>
          <select name="parentId" defaultValue={role?.parentId ?? ""} disabled={locked} className="input">
            <option value="">— (top of org chart)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">PO approval limit (₹)</span>
          <input name="approvalLimit" type="number" min="0" step="1000" defaultValue={role?.approvalLimit} placeholder={locked ? "Unlimited" : "No approval authority"} disabled={locked} className="input" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Description</span>
          <input name="description" defaultValue={role?.description} className="input" placeholder="Responsibilities" />
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Permissions</p>
        {locked && (
          <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
            The super admin role always has every access permission. Checking in for attendance is a duty, not an access right — leave it off for owners.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.name} className="rounded-lg border border-stone-200 p-3">
              <legend className="px-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">{g.name}</legend>
              <div className="space-y-1.5">
                {g.perms.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.key}
                      defaultChecked={role?.permissions.includes(p.key)}
                      disabled={locked && !selfService.includes(p.key)}
                      className="mt-0.5 h-4 w-4 accent-brand-500"
                    />
                    <span>
                      {p.label}
                      <span className="block font-mono text-[10px] text-stone-400">{p.key}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {state.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-700">{state.message}</p>}
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="check" /> {pending ? "Saving…" : role ? "Save role" : "Create role"}
        </button>
      </div>
    </form>
  );
}
