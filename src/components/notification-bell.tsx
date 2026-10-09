"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

type Item = { id: string; type: string; message: string; readAt: string | null; createdAt: string };

const TYPE_DOT: Record<string, string> = {
  OVERDUE: "bg-red-500",
  ESCALATION: "bg-red-600",
  DUE_SOON: "bg-amber-400",
  DUE_TODAY: "bg-amber-500",
  SENT_BACK: "bg-orange-500",
  REVIEW_REQUESTED: "bg-sky-500",
  REVIEW_WAITING: "bg-sky-500",
  APPROVED: "bg-emerald-500",
  START_TASK_CREATED: "bg-gold-500",
  START_TASK_WAITING: "bg-gold-500",
  DELAY_FLAGGED: "bg-red-400",
};

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function NotificationBell({ initialUnread, tone = "light" }: { initialUnread: number; tone?: "light" | "dark" }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { unread: number; items: Item[] };
      setUnread(d.unread);
      setItems(d.items);
    } catch {
      /* offline — keep last state */
    }
  }, []);

  useEffect(() => setUnread(initialUnread), [initialUnread]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markAll = async () => {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    load();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className={cn("relative rounded-lg p-2", tone === "dark" ? "text-stone-600 hover:bg-stone-100" : "text-stone-300 hover:bg-white/10 hover:text-white")}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-stone-200 bg-white text-ink-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-semibold text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
            {items === null ? (
              <li className="px-4 py-6 text-center text-sm text-stone-500">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-stone-500">You&apos;re all caught up.</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <a href={`/api/notifications/${n.id}/open`} className={cn("flex gap-3 px-4 py-2.5 hover:bg-stone-50", !n.readAt && "bg-brand-50/50")}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TYPE_DOT[n.type] ?? "bg-stone-300", n.readAt && "opacity-40")} />
                    <span className="min-w-0">
                      <span className={cn("block text-sm leading-snug", !n.readAt && "font-medium")}>{n.message}</span>
                      <span className="text-[11px] text-stone-400">{ago(n.createdAt)}</span>
                    </span>
                  </a>
                </li>
              ))
            )}
          </ul>
          <Link href="/notifications" className="block border-t border-stone-100 px-4 py-2.5 text-center text-sm font-semibold text-brand-600 hover:bg-stone-50">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
