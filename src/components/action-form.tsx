"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import type { FormState } from "@/actions/modules";
import { cn } from "@/lib/format";

/**
 * Small wrapper around a server action form: shows the result message, keeps
 * the user's input on error, and clears the form after a successful save.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClassName = "btn btn-primary",
  resetOnSuccess = true,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  submitLabel: ReactNode;
  submitClassName?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-full">
        {state.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state.ok && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
        <button className={cn(submitClassName)} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
