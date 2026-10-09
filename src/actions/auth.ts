"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  try {
    await signIn("credentials", {
      email,
      password,
      // Only allow same-site relative redirects.
      redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        const code = (error as AuthError & { code?: string }).code;
        return { error: code === "inactive" ? "This account has been deactivated. Contact HR." : "Incorrect email or password." };
      }
      return { error: "Could not sign in. Please try again." };
    }
    throw error; // NEXT_REDIRECT on success
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
