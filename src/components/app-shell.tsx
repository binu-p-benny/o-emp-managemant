"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logout } from "@/actions/auth";
import { Icon } from "@/components/icons";
import { Logo, Wordmark } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/format";
import type { NavSection } from "@/lib/nav";

type ShellUser = { name: string; roleName: string; designation: string | null };

export function AppShell({
  appName,
  nav,
  user,
  canCheckIn,
  unread,
  children,
}: {
  appName: string;
  nav: NavSection[];
  user: ShellUser;
  canCheckIn: boolean;
  unread: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // most specific match wins (e.g. /procurement/vendors vs /procurement)
    const all = nav.flatMap((s) => s.items.map((i) => i.href));
    const matches = all.filter((h) => h !== "/" && (pathname === h || pathname.startsWith(h + "/")));
    return matches.sort((a, b) => b.length - a.length)[0] === href;
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-700 text-stone-300">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
        <Logo className="h-9 w-9 shrink-0" />
        <Wordmark subtitle={appName} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {nav.map((section) => (
          <div key={section.title}>
            <p className="px-2 pb-1 text-[10px] font-semibold tracking-widest text-gold-300/70 uppercase">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon name={item.icon} className={cn("h-4 w-4", active && "text-gold-300")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-white">{item.badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-gold-200/70">{user.roleName}</p>
          </div>
          <form action={logout}>
            <button type="submit" title="Sign out" className="rounded-md p-2 text-stone-400 hover:bg-white/10 hover:text-white">
              <Icon name="logout" />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{sidebar}</aside>
        </div>
      )}

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="-ml-2 rounded-md p-2 text-stone-700 hover:bg-stone-100" aria-label="Open menu">
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <Logo className="h-8 w-8 shrink-0" />
        <Wordmark tone="dark" className="flex-1" />
        <NotificationBell initialUnread={unread} tone="dark" />
        {canCheckIn && pathname !== "/attendance/check-in" && (
          <Link href="/attendance/check-in" className="btn btn-primary btn-sm">
            <Icon name="camera" className="h-3.5 w-3.5" /> <span className="hidden min-[380px]:inline">Attendance</span>
          </Link>
        )}
      </header>

      {/* Desktop top bar */}
      <header className="sticky top-0 z-20 hidden h-14 items-center justify-end gap-2 border-b border-stone-200 bg-canvas/90 px-8 backdrop-blur lg:flex">
        <Link href="/tasks" className={cn("btn btn-ghost btn-sm", pathname === "/tasks" && "bg-stone-200/60")}>
          <Icon name="check" className="h-3.5 w-3.5" /> My Tasks
        </Link>
        {canCheckIn && (
          <Link href="/attendance/check-in" className="btn btn-ghost btn-sm">
            <Icon name="camera" className="h-3.5 w-3.5" /> Check in / out
          </Link>
        )}
        <NotificationBell initialUnread={unread} tone="dark" />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
