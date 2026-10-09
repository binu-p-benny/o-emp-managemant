import { Badge } from "@/components/ui";
import { DAY_STATUS_STYLE } from "@/lib/attendance";
import { cn } from "@/lib/format";
import { formatDistance } from "@/lib/geo";

type Rec = {
  inRange: boolean;
  reviewStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  distanceMeters: number;
  radiusMeters: number;
};

export function RangeBadge({ record }: { record: Rec }) {
  if (record.inRange) return <Badge tone="green">On-site</Badge>;
  const label = `Out of range · ${formatDistance(record.distanceMeters)}`;
  switch (record.reviewStatus) {
    case "APPROVED":
      return <Badge tone="blue">{label} · approved</Badge>;
    case "REJECTED":
      return <Badge tone="red">{label} · rejected</Badge>;
    default:
      return <Badge tone="amber">{label} · pending</Badge>;
  }
}

export function SelfieThumb({ url, alt, size = "h-10 w-10" }: { url: string; alt: string; size?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" className={`${size} rounded-lg bg-stone-200 object-cover ring-1 ring-stone-200`} />
    </a>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-4 border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
      {Object.values(DAY_STATUS_STYLE).map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-sm", s.dot)} /> {s.label}
        </span>
      ))}
    </div>
  );
}
