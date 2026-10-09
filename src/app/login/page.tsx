import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo-accounts";
import { LoginView } from "./login-view";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  const showDemo = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "true";
  return (
    <LoginView
      next={next ?? "/"}
      demoPassword={showDemo ? DEMO_PASSWORD : null}
      demoAccounts={showDemo ? DEMO_ACCOUNTS.map((a) => ({ email: a.email, name: a.name, designation: a.designation, department: a.department })) : []}
    />
  );
}
