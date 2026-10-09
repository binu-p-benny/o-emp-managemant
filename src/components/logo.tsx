import { COMPANY_NAME } from "@/lib/config";
import { cn } from "@/lib/format";

/** Oranzai emblem: emerald roundel, gold ring and roofline. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#134332" />
      <circle cx="16" cy="16" r="13.6" fill="none" stroke="#c49f58" strokeWidth="0.9" />
      <path d="M8.5 21.5v-7.2L16 9l7.5 5.3v7.2" fill="none" stroke="#d8bc80" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="16" cy="17.6" r="3" fill="none" stroke="#fff" strokeWidth="1.9" />
      <path d="M8 23.2h16" stroke="#c49f58" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Two-line wordmark echoing the company logo: ORANZAI / BUILDERS. */
export function Wordmark({ className, tone = "light", subtitle }: { className?: string; tone?: "light" | "dark"; subtitle?: string }) {
  const [first, ...rest] = COMPANY_NAME.split(" ");
  return (
    <span className={cn("flex min-w-0 flex-col leading-none", className)}>
      <span className={cn("truncate text-[15px] font-bold tracking-[0.18em] uppercase", tone === "light" ? "text-white" : "text-brand-600")}>{first}</span>
      <span className="mt-1 truncate text-[9px] font-semibold tracking-[0.42em] text-gold-400 uppercase">
        {rest.join(" ")}
        {subtitle ? <span className={cn("tracking-[0.2em]", tone === "light" ? "text-white/50" : "text-stone-400")}> · {subtitle}</span> : null}
      </span>
    </span>
  );
}
