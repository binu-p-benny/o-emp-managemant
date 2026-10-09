// Permission catalogue and the default role → permission matrix used by the seed.
// The MD (super admin) can change any role's permissions at runtime from Admin → Roles.

export const PERMISSIONS = {
  // Attendance
  "attendance.self": { label: "Check in / check out (selfie + GPS)", group: "Attendance" },
  "attendance.team.view": { label: "View team attendance", group: "Attendance" },
  "attendance.all.view": { label: "View all attendance", group: "Attendance" },
  "attendance.review": { label: "Review out-of-range check-ins", group: "Attendance" },
  "attendance.export": { label: "Export attendance (CSV)", group: "Attendance" },

  // Projects
  "projects.view.all": { label: "View all projects (otherwise assigned/team only)", group: "Projects" },
  "projects.create": { label: "Create projects", group: "Projects" },
  "projects.edit": { label: "Edit project settings", group: "Projects" },
  "projects.delete": { label: "Delete projects", group: "Projects" },
  "projects.members.manage": { label: "Assign project members", group: "Projects" },

  // People
  "employees.view.team": { label: "View team members", group: "Employees" },
  "employees.view.all": { label: "View all employees", group: "Employees" },
  "employees.manage": { label: "Create / edit employees", group: "Employees" },
  "kpi.view": { label: "View employee KPI points", group: "Employees" },

  // Site operations
  "sitelogs.view": { label: "View site logs", group: "Site Operations" },
  "sitelogs.create": { label: "Write daily site logs", group: "Site Operations" },

  // Costing
  "costing.view": { label: "View BoQ & cost summaries", group: "Costing" },
  "costing.edit": { label: "Prepare / edit BoQ", group: "Costing" },

  // Procurement
  "procurement.view": { label: "View vendors & purchase orders", group: "Procurement" },
  "procurement.vendors.manage": { label: "Manage vendors", group: "Procurement" },
  "procurement.po.create": { label: "Raise purchase orders", group: "Procurement" },
  "procurement.po.approve": { label: "Approve purchase orders (up to role limit)", group: "Procurement" },

  // Administration
  "admin.roles": { label: "Manage roles & permissions", group: "Administration" },
  "admin.settings": { label: "Change reminder & workflow settings", group: "Administration" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return value in PERMISSIONS;
}

/**
 * Duties rather than access rights. Super admin does NOT imply these — a role
 * only has them when explicitly granted (the owners don't punch in).
 */
export const SELF_SERVICE_PERMISSIONS: readonly PermissionKey[] = ["attendance.self"];

export function isSelfService(key: string): boolean {
  return (SELF_SERVICE_PERMISSIONS as readonly string[]).includes(key);
}

/** Departments drive the theming (login illustration, dashboard banner). */
export type Department = "Management" | "Office" | "Design" | "Site" | "Procurement" | "Costing";

type RoleSeed = {
  key: string;
  name: string;
  department: Department;
  description: string;
  parentKey: string | null;
  isSuperAdmin?: boolean;
  approvalLimit?: number;
  permissions: PermissionKey[];
};

const SELF: PermissionKey[] = ["attendance.self"];
const HEAD_BASE: PermissionKey[] = [
  "attendance.self",
  "attendance.team.view",
  "attendance.review",
  "attendance.export",
  "employees.view.team",
];

/** Mirrors the company org chart. Order = display order. */
export const ROLE_SEEDS: RoleSeed[] = [
  {
    key: "MD",
    name: "Managing Director",
    department: "Management",
    description: "Owner · top leader — sees everyone's work & attendance, manages roles & permissions. No check-in.",
    parentKey: null,
    isSuperAdmin: true,
    permissions: PERMISSION_KEYS.filter((k) => !isSelfService(k)),
  },
  {
    key: "MANAGING_PARTNER",
    name: "Managing Partner",
    department: "Management",
    description: "Owner · oversees HR cum Admin, Sales & Accounts — sees everyone's work & attendance. No check-in.",
    parentKey: "MD",
    approvalLimit: 1_000_000,
    permissions: [
      // owner: full visibility, no attendance duty
      "attendance.team.view",
      "attendance.review",
      "attendance.export",
      "employees.view.team",
      "attendance.all.view",
      "employees.view.all",
      "employees.manage",
      "projects.view.all",
      "projects.create",
      "projects.edit",
      "projects.members.manage",
      "sitelogs.view",
      "costing.view",
      "procurement.view",
      "procurement.po.approve",
    ],
  },
  {
    key: "HR_ADMIN",
    name: "HR cum Admin",
    department: "Office",
    description: "Recruitment, compliance, office management.",
    parentKey: "MANAGING_PARTNER",
    permissions: [
      ...SELF,
      "attendance.all.view",
      "attendance.review",
      "attendance.export",
      "employees.view.all",
      "employees.manage",
      "projects.view.all",
      "projects.members.manage",
    ],
  },
  {
    key: "SALES",
    name: "Sales",
    department: "Office",
    description: "Lead generation, client relations, business development.",
    parentKey: "MANAGING_PARTNER",
    permissions: [...SELF, "projects.view.all", "projects.create"],
  },
  {
    key: "ACCOUNTS",
    name: "Accounts",
    department: "Office",
    description: "Finance, payroll, billing.",
    parentKey: "MANAGING_PARTNER",
    permissions: [
      ...SELF,
      "attendance.all.view",
      "attendance.export",
      "projects.view.all",
      "costing.view",
      "procurement.view",
    ],
  },
  {
    key: "HEAD_DESIGN",
    name: "Head - Architectural Designs",
    department: "Design",
    description: "Leads architectural, interior design and drafting.",
    parentKey: "MD",
    permissions: [
      ...HEAD_BASE,
      "projects.edit",
      "projects.members.manage",
    ],
  },
  {
    key: "AR_DESIGN",
    name: "Ar Design",
    department: "Design",
    description: "Concept, planning.",
    parentKey: "HEAD_DESIGN",
    permissions: [...SELF],
  },
  {
    key: "INTERIOR_DESIGN",
    name: "Interior Design",
    department: "Design",
    description: "Space planning, furniture.",
    parentKey: "HEAD_DESIGN",
    permissions: [...SELF],
  },
  {
    key: "DRAFTING",
    name: "Drafting",
    department: "Design",
    description: "CAD drawings, technical plans.",
    parentKey: "HEAD_DESIGN",
    permissions: [...SELF],
  },
  {
    key: "HEAD_SITE_OPS",
    name: "Head - Site Operations",
    department: "Site",
    description: "Leads civil and interior execution on site.",
    parentKey: "MD",
    approvalLimit: 200_000,
    permissions: [
      ...HEAD_BASE,
      "projects.edit",
      "projects.members.manage",
      "sitelogs.view",
      "sitelogs.create",
      "procurement.view",
      "procurement.po.create",
      "procurement.po.approve",
    ],
  },
  {
    key: "CIVIL_WORKS",
    name: "Civil Works",
    department: "Site",
    description: "Construction, structural, site management.",
    parentKey: "HEAD_SITE_OPS",
    permissions: [...SELF, "sitelogs.view", "sitelogs.create", "procurement.po.create"],
  },
  {
    key: "INTERIOR_WORKS",
    name: "Interior Works",
    department: "Site",
    description: "Fit-outs, finishes, execution.",
    parentKey: "HEAD_SITE_OPS",
    permissions: [...SELF, "sitelogs.view", "sitelogs.create", "procurement.po.create"],
  },
  {
    key: "HEAD_PROCUREMENT",
    name: "Head - Procurement",
    department: "Procurement",
    description: "Sourcing materials, vendor management, purchase orders.",
    parentKey: "MD",
    approvalLimit: 500_000,
    permissions: [
      ...HEAD_BASE,
      "projects.view.all",
      "costing.view",
      "procurement.view",
      "procurement.vendors.manage",
      "procurement.po.create",
      "procurement.po.approve",
    ],
  },
  {
    key: "HEAD_COSTING",
    name: "Head - Costing",
    department: "Costing",
    description: "Budgeting, estimating, BoQ preparation, cost control.",
    parentKey: "MD",
    permissions: [
      ...HEAD_BASE,
      "projects.view.all",
      "costing.view",
      "costing.edit",
      "procurement.view",
    ],
  },
];
