import type { IconName } from "@/components/icons";
import type { PermissionKey } from "@/lib/permissions";
import { can, type CurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/workflow/types";

export type NavItem = { href: string; label: string; icon: IconName; badge?: number };
export type NavSection = { title: string; items: NavItem[] };

type BadgeKey = "review" | "po" | "tasks" | "taskReviews";
type NavDef = Omit<NavItem, "badge"> & {
  anyOf?: PermissionKey[];
  /** Visible to these org roles (super admin always included). */
  roles?: string[];
  badgeKey?: BadgeKey;
};

const SECTIONS: { title: string; items: NavDef[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "dashboard" },
      { href: "/tasks", label: "My Tasks", icon: "check", badgeKey: "tasks" },
      { href: "/projects", label: "Projects", icon: "building" },
    ],
  },
  {
    title: "Workflow",
    items: [
      { href: "/workflow/design", label: "Design Desk", icon: "layers", roles: [ROLES.ARCHITECT_HEAD] },
      { href: "/workflow/construction", label: "Construction Desk", icon: "building", roles: [ROLES.CONSTRUCTION_HEAD] },
      { href: "/workflow/reviews", label: "Task Reviews", icon: "eye", roles: [ROLES.ARCHITECT_HEAD, ROLES.CONSTRUCTION_HEAD], badgeKey: "taskReviews" },
    ],
  },
  {
    title: "Attendance",
    items: [
      { href: "/attendance", label: "My Attendance", icon: "clock", anyOf: ["attendance.self"] },
      { href: "/attendance/team", label: "Team Attendance", icon: "calendar", anyOf: ["attendance.team.view", "attendance.all.view"] },
      { href: "/attendance/review", label: "Attendance Review", icon: "flag", anyOf: ["attendance.review"], badgeKey: "review" },
    ],
  },
  {
    title: "Departments",
    items: [
      { href: "/employees", label: "Employees", icon: "users", anyOf: ["employees.view.all", "employees.view.team"] },
      { href: "/kpi", label: "Employee KPIs", icon: "chart", anyOf: ["kpi.view"] },
      { href: "/site-logs", label: "Site Logs", icon: "clipboard", anyOf: ["sitelogs.view"] },
      { href: "/costing", label: "Costing & BoQ", icon: "calculator", anyOf: ["costing.view"] },
      { href: "/procurement", label: "Purchase Orders", icon: "truck", anyOf: ["procurement.view", "procurement.po.create"], badgeKey: "po" },
      { href: "/procurement/vendors", label: "Vendors", icon: "package", anyOf: ["procurement.view"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/roles", label: "Roles & Access", icon: "shield", anyOf: ["admin.roles"] },
      { href: "/admin/settings", label: "Settings", icon: "clock", anyOf: ["admin.settings"] },
    ],
  },
];

export function buildNav(user: CurrentUser, badges: Partial<Record<BadgeKey, number>>): NavSection[] {
  return SECTIONS.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => !i.anyOf || can(user, ...i.anyOf))
      .filter((i) => !i.roles || user.isSuperAdmin || i.roles.includes(user.roleKey))
      .map(({ anyOf: _anyOf, roles: _roles, badgeKey, ...item }) => ({ ...item, badge: badgeKey ? badges[badgeKey] || undefined : undefined })),
  })).filter((s) => s.items.length > 0);
}
