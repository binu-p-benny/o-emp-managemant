import type { Metadata } from "next";
import { EmployeeForm } from "@/components/employee-form";
import { Card, PageHeader } from "@/components/ui";
import { employeeFormOptions } from "@/lib/employees";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePermission("employees.manage");
  const { roles, projects, managers } = await employeeFormOptions(user);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add employee" back={{ href: "/employees", label: "Employees" }} />
      <Card>
        <EmployeeForm roles={roles} projects={projects} managers={managers} />
      </Card>
    </div>
  );
}
