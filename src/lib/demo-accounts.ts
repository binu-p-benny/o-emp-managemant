// Demo users created by prisma/seed.ts — one per box on the org chart.
// Shown on the login page (one-click sign-in) only when NEXT_PUBLIC_SHOW_DEMO_LOGINS=true.

/** Shared password for every demo account. Never enable demo logins in production. */
export const DEMO_PASSWORD = "SiteDemo@2026";

export const DEMO_ACCOUNTS = [
  { email: "md@example.com", name: "James Anderson", roleKey: "MD", department: "Management", designation: "Founder & Managing Director · Owner" },
  { email: "partner@example.com", name: "Charlotte Dubois", roleKey: "MANAGING_PARTNER", department: "Management", designation: "Managing Partner · Owner" },
  { email: "hr@example.com", name: "Emma Johansson", roleKey: "HR_ADMIN", department: "Office", designation: "HR & Admin Executive" },
  { email: "sales@example.com", name: "Daniel Smith", roleKey: "SALES", department: "Office", designation: "Business Development Manager" },
  { email: "accounts@example.com", name: "Laura Fischer", roleKey: "ACCOUNTS", department: "Office", designation: "Accounts Executive" },
  { email: "design.head@example.com", name: "Marco Rossi", roleKey: "HEAD_DESIGN", department: "Design", designation: "Principal Architect" },
  { email: "architect@example.com", name: "Lucas Becker", roleKey: "AR_DESIGN", department: "Design", designation: "Architect" },
  { email: "interior@example.com", name: "Isabella Garcia", roleKey: "INTERIOR_DESIGN", department: "Design", designation: "Interior Designer" },
  { email: "drafting@example.com", name: "Noah Williams", roleKey: "DRAFTING", department: "Design", designation: "CAD Draughtsman" },
  { email: "site.head@example.com", name: "William Turner", roleKey: "HEAD_SITE_OPS", department: "Site", designation: "Project Manager" },
  { email: "civil@example.com", name: "Oliver Schmidt", roleKey: "CIVIL_WORKS", department: "Site", designation: "Site Engineer" },
  { email: "supervisor@example.com", name: "Ethan Brown", roleKey: "CIVIL_WORKS", department: "Site", designation: "Site Supervisor" },
  { email: "interiorworks@example.com", name: "Chloe Martin", roleKey: "INTERIOR_WORKS", department: "Site", designation: "Interior Site Engineer" },
  { email: "procurement@example.com", name: "Liam Davies", roleKey: "HEAD_PROCUREMENT", department: "Procurement", designation: "Procurement Head" },
  { email: "costing@example.com", name: "Grace Thompson", roleKey: "HEAD_COSTING", department: "Costing", designation: "Quantity Surveyor" },
] as const;

export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];
