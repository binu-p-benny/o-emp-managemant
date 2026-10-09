"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { login, type LoginState } from "@/actions/auth";
import { DepartmentIllustration, THEME_COPY, themeForDepartment, type IllustrationTheme } from "@/components/illustrations";
import { Icon } from "@/components/icons";
import { Logo, Wordmark } from "@/components/logo";
import { APP_NAME, COMPANY_HQ, COMPANY_NAME, COMPANY_SERVICES, COMPANY_TAGLINE } from "@/lib/config";
import { cn } from "@/lib/format";

type Demo = { email: string; name: string; designation: string; department: string };

const THEMES: IllustrationTheme[] = ["site", "design", "office", "supply"];

export function LoginView({ next, demoAccounts, demoPassword }: { next: string; demoAccounts: Demo[]; demoPassword: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [theme, setTheme] = useState<IllustrationTheme>("site");
  const [pinned, setPinned] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Gently cycle the department scenes until the visitor picks one.
  useEffect(() => {
    if (pinned) return;
    const t = setInterval(() => setTheme((cur) => THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]), 6000);
    return () => clearInterval(t);
  }, [pinned]);

  const pick = (t: IllustrationTheme) => {
    setPinned(true);
    setTheme(t);
  };

  const fillDemo = (demo: Demo) => {
    pick(themeForDepartment(demo.department));
    if (emailRef.current) emailRef.current.value = demo.email;
    if (demoPassword && passwordRef.current) {
      // Demo mode: one-click sign-in.
      passwordRef.current.value = demoPassword;
      formRef.current?.requestSubmit();
    } else {
      passwordRef.current?.focus();
    }
  };

  const copy = THEME_COPY[theme];

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Illustration panel */}
      <section className="relative flex flex-col overflow-hidden bg-brand-700 px-6 pt-6 pb-4 text-white lg:px-12 lg:py-10">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#d8bc80_1px,transparent_1px),linear-gradient(90deg,#d8bc80_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <Wordmark subtitle={APP_NAME} />
        </div>
        <p className="relative mt-5 font-display text-3xl text-white italic lg:mt-8 lg:text-4xl xl:text-5xl">{COMPANY_TAGLINE}</p>

        <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-4 lg:py-8">
          <div className="rounded-3xl bg-gradient-to-b from-gold-50 to-stone-50 p-3 shadow-2xl ring-1 ring-gold-300/40 lg:p-5">
            <DepartmentIllustration key={theme} theme={theme} className="h-40 w-full animate-[fadein_.5s_ease] sm:h-56 lg:h-52 xl:h-64" />
          </div>
          <div className="mt-5 hidden lg:block">
            <p className="text-sm font-semibold tracking-wider text-gold-300 uppercase">{copy.title}</p>
            <p className="mt-1 text-xl leading-snug font-medium text-white/90">{copy.tagline}</p>
          </div>
        </div>

        <div className="relative hidden gap-2 lg:flex" role="tablist" aria-label="Department">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === theme}
              onClick={() => pick(t)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                t === theme ? "bg-gold-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20",
              )}
            >
              {THEME_COPY[t].title}
            </button>
          ))}
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl text-brand-600">Welcome back</h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to the {COMPANY_NAME} {APP_NAME}. Your role decides which projects, teams and approvals you see.</p>

          <form ref={formRef} action={action} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next} />
            <label className="block">
              <span className="label">Work email</span>
              <input ref={emailRef} name="email" type="email" autoComplete="username" required className="input" placeholder="you@oranzaibuilders.com" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input ref={passwordRef} name="password" type="password" autoComplete="current-password" required className="input" />
            </label>
            {state.error && (
              <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <Icon name="alert" /> {state.error}
              </p>
            )}
            <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
              <Icon name="login" />
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {demoAccounts.length > 0 && (
            <div className="mt-8">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Demo accounts</p>
              <p className="mt-0.5 text-xs text-stone-400">Click an account to sign in as that role.</p>
              <ul className="mt-2 max-h-64 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200">
                {demoAccounts.map((d) => (
                  <li key={d.email}>
                    <button type="button" disabled={pending} onClick={() => fillDemo(d)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-900">{d.name}</span>
                        <span className="block truncate text-xs text-stone-500">{d.designation}</span>
                      </span>
                      <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600 uppercase">{d.department}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 border-t border-stone-100 pt-4 text-center text-[11px] text-stone-400">
            <p className="font-semibold tracking-[0.2em] text-gold-600 uppercase">{COMPANY_SERVICES.join(" · ")}</p>
            <p className="mt-1">{COMPANY_HQ}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
