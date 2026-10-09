"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { saveProject } from "@/actions/projects";
import { Icon } from "@/components/icons";
import { MapPicker, StaticMap } from "@/components/maps";
import {
  COMPANY_BRANCHES,
  LOCATION_TYPES,
  ORIENTATIONS,
  PROJECT_CATEGORIES,
  PROJECT_STAGES,
} from "@/lib/project-schema";
import { cn } from "@/lib/format";

export type ProjectFormDetails = {
  projectCode: string;
  projectName: string;
  projectStage: string;
  projectCategory: string;
  startDate: string;
  endDate: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  companyBranch: string;
  attendanceRadius: string;
  outOfRangePolicy: "FLAG" | "BLOCK";
  projectValue: string;
  orientation: string;
  dimension: string;
  scopeOfWork: string;
};

export type ProjectFormMember = { userId: string; projectRole: string; isMain: boolean };
export type ProjectFormLocation = { key: string; parentKey: string | null; name: string; type: string };
export type EmployeeOption = { id: string; name: string; roleName: string; designation: string | null; mainProjectId: string | null; mainProjectCode: string | null };

const EMPTY: ProjectFormDetails = {
  projectCode: "",
  projectName: "",
  projectStage: "Enquiry",
  projectCategory: "Turnkey Project",
  startDate: "",
  endDate: "",
  address: "",
  latitude: null,
  longitude: null,
  companyBranch: COMPANY_BRANCHES[0] ?? "",
  attendanceRadius: "250",
  outOfRangePolicy: "FLAG",
  projectValue: "",
  orientation: "",
  dimension: "",
  scopeOfWork: "",
};

type Tab = "details" | "members" | "locations";

let keySeq = 0;
const newKey = () => `n${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function ProjectForm({
  projectId,
  initialDetails,
  initialMembers = [],
  initialLocations = [],
  employees,
  canEditDetails,
  canManageMembers,
}: {
  projectId?: string;
  initialDetails?: ProjectFormDetails;
  initialMembers?: ProjectFormMember[];
  initialLocations?: ProjectFormLocation[];
  employees: EmployeeOption[];
  canEditDetails: boolean;
  canManageMembers: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("details");
  const [details, setDetails] = useState<ProjectFormDetails>(initialDetails ?? EMPTY);
  const [members, setMembers] = useState<ProjectFormMember[]>(initialMembers);
  const [locations, setLocations] = useState<ProjectFormLocation[]>(initialLocations);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof ProjectFormDetails>(key: K, value: ProjectFormDetails[K]) => {
    setDetails((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const submit = () => {
    setFormError(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    startTransition(async () => {
      const result = await saveProject({
        id: projectId,
        details: {
          ...details,
          latitude: details.latitude ?? (undefined as unknown as number),
          longitude: details.longitude ?? (undefined as unknown as number),
          attendanceRadius: Number(details.attendanceRadius),
          projectValue: num(details.projectValue),
          projectStage: details.projectStage as (typeof PROJECT_STAGES)[number],
          projectCategory: details.projectCategory as (typeof PROJECT_CATEGORIES)[number],
        },
        members,
        locations,
      });
      if (result.ok) {
        router.push(`/projects/${result.id}`);
        router.refresh();
      } else {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        if (result.fieldErrors && Object.keys(result.fieldErrors).some((k) => !k.startsWith("members") && !k.startsWith("locations"))) setTab("details");
      }
    });
  };

  const detailErrorCount = Object.keys(errors).filter((k) => !k.startsWith("members") && !k.startsWith("locations")).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50 px-2 pt-2">
        {(
          [
            ["details", "Project Details", detailErrorCount],
            ["members", `Members (${members.length})`, 0],
            ["locations", `Location Structure (${locations.length})`, 0],
          ] as const
        ).map(([key, label, errCount]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative rounded-t-lg px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
              tab === key ? "bg-white text-brand-700 shadow-[0_1px_0_white] ring-1 ring-stone-200" : "text-stone-500 hover:text-ink-900",
            )}
          >
            {label}
            {errCount > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {tab === "details" && <DetailsTab details={details} set={set} errors={errors} disabled={!canEditDetails} />}
        {tab === "members" && (
          <MembersTab members={members} setMembers={setMembers} employees={employees} projectId={projectId} disabled={!canManageMembers} />
        )}
        {tab === "locations" && <LocationsTab locations={locations} setLocations={setLocations} disabled={!canEditDetails} />}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-red-700">{formError}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.back()} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={pending} className="btn btn-primary">
            <Icon name="check" />
            {pending ? "Saving…" : projectId ? "Save changes" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Details ────────────────────────────────────────────────────────────────

function F({ label, error, children, className, required, hint }: { label: string; error?: string; children: ReactNode; className?: string; required?: boolean; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">
        {label}
        {required && <span className="text-brand-600"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

function DetailsTab({
  details: d,
  set,
  errors,
  disabled,
}: {
  details: ProjectFormDetails;
  set: <K extends keyof ProjectFormDetails>(key: K, value: ProjectFormDetails[K]) => void;
  errors: Record<string, string>;
  disabled: boolean;
}) {
  const inputCls = (key: string) => cn("input", errors[key] && "border-red-400 ring-2 ring-red-100");
  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
      <F label="Project Code" required error={errors.projectCode}>
        <input className={inputCls("projectCode")} value={d.projectCode} onChange={(e) => set("projectCode", e.target.value)} placeholder="EPC 171" />
      </F>
      <F label="Project Name" required error={errors.projectName}>
        <input className={inputCls("projectName")} value={d.projectName} onChange={(e) => set("projectName", e.target.value)} placeholder="EPC 171 Mr Nidheesh & Family" />
      </F>
      <F label="Project Stage" required error={errors.projectStage}>
        <select className={inputCls("projectStage")} value={d.projectStage} onChange={(e) => set("projectStage", e.target.value)}>
          {PROJECT_STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </F>
      <F label="Project Category" required error={errors.projectCategory}>
        <select className={inputCls("projectCategory")} value={d.projectCategory} onChange={(e) => set("projectCategory", e.target.value)}>
          {PROJECT_CATEGORIES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </F>
      <F label="Start Date" required error={errors.startDate}>
        <input type="date" className={inputCls("startDate")} value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
      </F>
      <F label="End Date" required error={errors.endDate}>
        <input type="date" className={inputCls("endDate")} value={d.endDate} min={d.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
      </F>
      <F label="Project Address" required error={errors.address} className="md:col-span-2">
        <textarea rows={2} className={inputCls("address")} value={d.address} onChange={(e) => set("address", e.target.value)} placeholder="House name, street, locality, city, PIN" />
      </F>

      <div className="md:col-span-2">
        <span className="label">
          Project Location <span className="text-brand-600">*</span>
        </span>
        {disabled ? (
          d.latitude !== null && d.longitude !== null ? (
            <StaticMap
              circles={[{ lat: d.latitude, lng: d.longitude, radius: Number(d.attendanceRadius) || 0 }]}
              markers={[{ lat: d.latitude, lng: d.longitude, color: "#a47a2c" }]}
            />
          ) : null
        ) : (
          <MapPicker
            latitude={d.latitude}
            longitude={d.longitude}
            radius={Number(d.attendanceRadius) || 0}
            address={d.address}
            onChange={(lat, lng) => {
              set("latitude", lat);
              set("longitude", lng);
            }}
          />
        )}
      </div>
      <F label="Project Latitude" required error={errors.latitude} hint="Auto-filled from the map pin">
        <input
          type="number"
          step="0.000001"
          className={inputCls("latitude")}
          value={d.latitude ?? ""}
          onChange={(e) => set("latitude", e.target.value === "" ? null : Number(e.target.value))}
          placeholder="10.015900"
        />
      </F>
      <F label="Project Longitude" required error={errors.longitude} hint="Auto-filled from the map pin">
        <input
          type="number"
          step="0.000001"
          className={inputCls("longitude")}
          value={d.longitude ?? ""}
          onChange={(e) => set("longitude", e.target.value === "" ? null : Number(e.target.value))}
          placeholder="76.341900"
        />
      </F>

      <F label="Company Branch" error={errors.companyBranch}>
        <select className={inputCls("companyBranch")} value={d.companyBranch} onChange={(e) => set("companyBranch", e.target.value)}>
          <option value="">—</option>
          {COMPANY_BRANCHES.map((b) => (
            <option key={b}>{b}</option>
          ))}
          {d.companyBranch && !COMPANY_BRANCHES.includes(d.companyBranch) && <option>{d.companyBranch}</option>}
        </select>
      </F>
      <F label="Attendance Radius (m)" required error={errors.attendanceRadius} hint="Check-ins within this distance of the pin count as on-site">
        <input type="number" min={10} max={10000} step={10} className={inputCls("attendanceRadius")} value={d.attendanceRadius} onChange={(e) => set("attendanceRadius", e.target.value)} />
      </F>
      <F label="Outside radius" error={errors.outOfRangePolicy} hint="What happens when someone checks in outside the radius">
        <select className={inputCls("outOfRangePolicy")} value={d.outOfRangePolicy} onChange={(e) => set("outOfRangePolicy", e.target.value as "FLAG" | "BLOCK")}>
          <option value="FLAG">Allow, but flag for manager review</option>
          <option value="BLOCK">Block check-in</option>
        </select>
      </F>
      <F label="Project Value (₹)" error={errors.projectValue}>
        <input type="number" min={0} step="1000" className={inputCls("projectValue")} value={d.projectValue} onChange={(e) => set("projectValue", e.target.value)} placeholder="4500000" />
      </F>
      <F label="Project Orientation" error={errors.orientation}>
        <input list="orientations" className={inputCls("orientation")} value={d.orientation} onChange={(e) => set("orientation", e.target.value)} placeholder="East facing" />
        <datalist id="orientations">
          {ORIENTATIONS.map((o) => (
            <option key={o} value={`${o} facing`} />
          ))}
        </datalist>
      </F>
      <F label="Project Dimension" error={errors.dimension}>
        <input className={inputCls("dimension")} value={d.dimension} onChange={(e) => set("dimension", e.target.value)} placeholder="2400 sq ft · G+1 · plot 10 cents" />
      </F>
      <F label="Scope of Work" error={errors.scopeOfWork} className="md:col-span-2">
        <textarea rows={4} className={inputCls("scopeOfWork")} value={d.scopeOfWork} onChange={(e) => set("scopeOfWork", e.target.value)} placeholder="Design & build — architecture, structure, interiors, landscaping…" />
      </F>
    </fieldset>
  );
}

// ─── Members ────────────────────────────────────────────────────────────────

function MembersTab({
  members,
  setMembers,
  employees,
  projectId,
  disabled,
}: {
  members: ProjectFormMember[];
  setMembers: (fn: (m: ProjectFormMember[]) => ProjectFormMember[]) => void;
  employees: EmployeeOption[];
  projectId?: string;
  disabled: boolean;
}) {
  const [pick, setPick] = useState("");
  const [roleText, setRoleText] = useState("");
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const available = employees.filter((e) => !members.some((m) => m.userId === e.id));
  const grouped = useMemo(() => {
    const g = new Map<string, EmployeeOption[]>();
    for (const e of available) g.set(e.roleName, [...(g.get(e.roleName) ?? []), e]);
    return [...g.entries()];
  }, [available]);

  const add = () => {
    if (!pick) return;
    const emp = byId.get(pick);
    setMembers((m) => [...m, { userId: pick, projectRole: roleText || emp?.designation || "", isMain: !emp?.mainProjectId }]);
    setPick("");
    setRoleText("");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Members can see this project and check in against it. Tick <strong>Main project</strong> to make this project&apos;s geofence the
        default for that employee&apos;s attendance.
      </p>
      {!disabled && (
        <div className="flex flex-col gap-2 rounded-lg bg-stone-50 p-3 sm:flex-row">
          <select className="input sm:flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select employee…</option>
            {grouped.map(([role, list]) => (
              <optgroup key={role} label={role}>
                {list.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input className="input sm:w-56" placeholder="Project role (e.g. Site Engineer)" value={roleText} onChange={(e) => setRoleText(e.target.value)} />
          <button type="button" onClick={add} disabled={!pick} className="btn btn-dark">
            <Icon name="plus" /> Add
          </button>
        </div>
      )}
      {members.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">No members assigned yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Org role</th>
                <th>Project role</th>
                <th>Main project</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => {
                const e = byId.get(m.userId);
                const otherMain = e?.mainProjectId && e.mainProjectId !== projectId ? e.mainProjectCode : null;
                return (
                  <tr key={m.userId}>
                    <td className="font-medium">{e?.name ?? "Unknown"}</td>
                    <td className="text-stone-600">{e?.roleName}</td>
                    <td>
                      <input
                        disabled={disabled}
                        className="input min-w-40"
                        value={m.projectRole}
                        onChange={(ev) => setMembers((list) => list.map((x, j) => (j === i ? { ...x, projectRole: ev.target.value } : x)))}
                      />
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={m.isMain}
                          onChange={(ev) => setMembers((list) => list.map((x, j) => (j === i ? { ...x, isMain: ev.target.checked } : x)))}
                          className="h-4 w-4 accent-brand-500"
                        />
                        {m.isMain && otherMain ? <span className="text-xs text-amber-700">switches from {otherMain}</span> : !m.isMain && otherMain ? <span className="text-xs text-stone-400">main: {otherMain}</span> : null}
                      </label>
                    </td>
                    <td className="text-right">
                      {!disabled && (
                        <button type="button" onClick={() => setMembers((list) => list.filter((_, j) => j !== i))} className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                          <Icon name="trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Location structure ─────────────────────────────────────────────────────

function LocationsTab({
  locations,
  setLocations,
  disabled,
}: {
  locations: ProjectFormLocation[];
  setLocations: (fn: (l: ProjectFormLocation[]) => ProjectFormLocation[]) => void;
  disabled: boolean;
}) {
  const childrenOf = (parent: string | null) => locations.filter((l) => l.parentKey === parent);

  const add = (parentKey: string | null) => {
    const parent = locations.find((l) => l.key === parentKey);
    const nextType = parent ? (LOCATION_TYPES[Math.min(LOCATION_TYPES.indexOf(parent.type as (typeof LOCATION_TYPES)[number]) + 1, LOCATION_TYPES.length - 1)] ?? "Zone") : "Block";
    const count = childrenOf(parentKey).length + 1;
    const name = nextType === "Floor" ? (count === 1 ? "Ground Floor" : `Floor ${count - 1}`) : `${nextType} ${parent ? count : String.fromCharCode(64 + count)}`;
    setLocations((l) => {
      // insert after the parent's last descendant so the flat list stays in tree order
      const item = { key: newKey(), parentKey, name, type: nextType };
      if (!parentKey) return [...l, item];
      const descendants = new Set<string>([parentKey]);
      let insertAt = l.findIndex((x) => x.key === parentKey) + 1;
      while (insertAt < l.length && descendants.has(l[insertAt].parentKey ?? "")) {
        descendants.add(l[insertAt].key);
        insertAt++;
      }
      return [...l.slice(0, insertAt), item, ...l.slice(insertAt)];
    });
  };

  const remove = (key: string) =>
    setLocations((l) => {
      const doomed = new Set([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const x of l) if (x.parentKey && doomed.has(x.parentKey) && !doomed.has(x.key)) (doomed.add(x.key), (grew = true));
      }
      return l.filter((x) => !doomed.has(x.key));
    });

  const update = (key: string, patch: Partial<ProjectFormLocation>) => setLocations((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const renderNode = (node: ProjectFormLocation, depth: number): ReactNode => (
    <li key={node.key}>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 24 }}>
        {depth > 0 && <span className="h-px w-3 bg-stone-300" />}
        <select disabled={disabled} className="input w-28 py-1.5" value={node.type} onChange={(e) => update(node.key, { type: e.target.value })}>
          {LOCATION_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input disabled={disabled} className="input flex-1 py-1.5" value={node.name} onChange={(e) => update(node.key, { name: e.target.value })} />
        {!disabled && (
          <>
            <button type="button" onClick={() => add(node.key)} className="btn btn-ghost btn-sm" title="Add child">
              <Icon name="plus" className="h-3.5 w-3.5" /> Child
            </button>
            <button type="button" onClick={() => remove(node.key)} className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>
      {childrenOf(node.key).length > 0 && <ul>{childrenOf(node.key).map((c) => renderNode(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">Break the site down into blocks, floors, zones and rooms. Used for organising site logs and work.</p>
      {locations.length === 0 ? <p className="py-6 text-center text-sm text-stone-500">No location structure yet.</p> : <ul>{childrenOf(null).map((n) => renderNode(n, 0))}</ul>}
      {!disabled && (
        <button type="button" onClick={() => add(null)} className="btn btn-secondary">
          <Icon name="plus" /> Add block
        </button>
      )}
    </div>
  );
}
