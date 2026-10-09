"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons";

/** Accessible dialog built on <dialog>. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-2xl backdrop:bg-black/40 ${wide ? "max-w-3xl" : "max-w-md"}`}
    >
      {open && (
        <div>
          <header className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
            <h2 className="font-semibold text-ink-900">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100" aria-label="Close">
              <Icon name="x" />
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
