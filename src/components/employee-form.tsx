"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveEmployee, type EmployeeFormState } from "@/actions/employees";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

type Option = { id: string; label: string };

export type EmployeeFormValues = {
  id?: string;
  name: string;
  email: string;
  employeeCode: string;
  phone: string;
  designation: string;
  roleId: string;
  mainProjectId: string;
  reportsToId: string;
  isActive: boolean;
};

export function EmployeeForm({ initial, roles, projects, managers = [] }: { initial?: EmployeeFormValues; roles: Option[]; projects: Option[]; managers?: Option[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<EmployeeFormState, FormData>(saveEmployee, {});
  const err = state.fieldErrors ?? {};
  const values = (state.values ?? initial ?? {}) as Partial<Record<keyof EmployeeFormValues, string | boolean>>;

  useEffect(() => {
    if (state.ok && state.id) {
      if (!initial?.id) router.push(`/employees/${state.id}`);
      else router.refresh();
    }
  }, [state, initial?.id, router]);

  const field = (name: keyof EmployeeFormValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} defaultValue={(values[name] as string) ?? ""} className={cn("input", err[name] && "border-red-400")} {...props} />
      {err[name] && <span className="mt-1 block text-xs text-red-600">{err[name]}</span>}
    </label>
  );

  return (
    <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {field("name", "Full name *", { required: true })}
      {field("email", "Work email *", { type: "email", required: true })}
      {field("employeeCode", "Employee code", { placeholder: "EMP-0042" })}
      {field("phone", "Phone", { type: "tel" })}
      {field("designation", "Designation", { placeholder: "Site Engineer" })}
      <label className="block">
        <span className="label">Role *</span>
        <select name="roleId" defaultValue={(values.roleId as string) ?? ""} required className={cn("input", err.roleId && "border-red-400")}>
          <option value="">Select…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        {err.roleId && <span className="mt-1 block text-xs text-red-600">{err.roleId}</span>}
      </label>
      <label className="block">
        <span className="label">Reports to (line manager)</span>
        <select name="reportsToId" defaultValue={(values.reportsToId as string) ?? ""} className="input">
          <option value="">—</option>
          {managers.filter((m) => m.id !== initial?.id).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-stone-500">Defines “team under a head” for workflow assignment and hand-overs.</span>
      </label>
      <label className="block">
        <span className="label">Main project (attendance geofence)</span>
        <select name="mainProjectId" defaultValue={(values.mainProjectId as string) ?? ""} className="input">
          <option value="">None</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">{initial?.id ? "Reset password" : "Initial password *"}</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required={!initial?.id} placeholder={initial?.id ? "Leave blank to keep" : "Min 8 characters"} className={cn("input", err.password && "border-red-400")} />
        {err.password && <span className="mt-1 block text-xs text-red-600">{err.password}</span>}
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isActive" defaultChecked={(values.isActive as boolean | undefined) ?? true} className="h-4 w-4 accent-brand-500" />
        Active (can sign in)
        {err.isActive && <span className="text-xs text-red-600">{err.isActive}</span>}
      </label>
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">Saved.</span>}
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="check" /> {pending ? "Saving…" : initial?.id ? "Save changes" : "Create employee"}
        </button>
      </div>
    </form>
  );
}
