// Hand-built construction / architecture illustrations (inline SVG, no assets).
// One per department context: site works, design studio, office, supply chain.

import type { Department } from "@/lib/permissions";
import { COMPANY_NAME } from "@/lib/config";

export type IllustrationTheme = "site" | "design" | "office" | "supply";

export function themeForDepartment(department: Department | string): IllustrationTheme {
  switch (department) {
    case "Design":
      return "design";
    case "Site":
      return "site";
    case "Procurement":
    case "Costing":
      return "supply";
    default:
      return "office";
  }
}

export const THEME_COPY: Record<IllustrationTheme, { title: string; tagline: string }> = {
  site: { title: "Construction", tagline: `Geo-verified attendance and daily progress from every ${COMPANY_NAME} site.` },
  design: { title: "Architecture & Interior", tagline: "Every drawing tracked — from concept plan to interior working drawings." },
  office: { title: "Management", tagline: "Live KPIs across projects, people and approvals — high-end living within budget." },
  supply: { title: "Costing & Procurement", tagline: "Cost estimation, BoQs and purchase approvals for every turnkey project." },
};

export function DepartmentIllustration({ theme, className }: { theme: IllustrationTheme; className?: string }) {
  const Comp = { site: SiteScene, design: DesignScene, office: OfficeScene, supply: SupplyScene }[theme];
  return <Comp className={className} />;
}

function Worker({ x, y, vest = "#a47a2c" }: { x: number; y: number; vest?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-6" y="0" width="12" height="20" rx="3" fill={vest} />
      <rect x="-6" y="7" width="12" height="2.5" fill="#fef3c7" />
      <rect x="-5" y="20" width="4" height="12" fill="#1c4a39" />
      <rect x="1" y="20" width="4" height="12" fill="#1c4a39" />
      <circle cx="0" cy="-6" r="5.5" fill="#c68a5c" />
      <path d="M-7 -7 a7 6 0 0 1 14 0 z" fill="#facc15" />
      <rect x="-8" y="-7.5" width="16" height="2" rx="1" fill="#eab308" />
    </g>
  );
}

function SiteScene({ className }: { className?: string }) {
  const columns = [150, 205, 260, 315, 370];
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-label="Building under construction with a tower crane">
      <circle cx="400" cy="70" r="34" fill="#fde68a" opacity="0.8" />
      <path d="M0 300 L120 250 L220 290 L320 240 L480 290 L480 360 L0 360Z" fill="#e7e5e4" opacity="0.6" />
      {/* crane */}
      <g stroke="#a47a2c" strokeWidth="3" fill="none">
        <line x1="80" y1="300" x2="80" y2="52" />
        <line x1="100" y1="300" x2="100" y2="52" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="80" y1={300 - i * 20} x2="100" y2={280 - i * 20} strokeWidth="1.5" />
        ))}
        <line x1="40" y1="52" x2="430" y2="52" />
        <line x1="40" y1="64" x2="430" y2="64" strokeWidth="1.5" />
        {Array.from({ length: 19 }, (_, i) => (
          <line key={i} x1={40 + i * 20} y1="64" x2={60 + i * 20} y2="52" strokeWidth="1.2" />
        ))}
        <line x1="90" y1="20" x2="40" y2="52" strokeWidth="1.5" />
        <line x1="90" y1="20" x2="300" y2="52" strokeWidth="1.5" />
        <line x1="90" y1="20" x2="90" y2="52" />
      </g>
      <rect x="36" y="56" width="26" height="22" fill="#1c4a39" />
      <rect x="102" y="66" width="18" height="14" rx="2" fill="#1c4a39" />
      <line x1="320" y1="64" x2="320" y2="118" stroke="#1c4a39" strokeWidth="1.5" />
      <rect x="314" y="60" width="12" height="6" fill="#1c4a39" />
      <rect x="282" y="118" width="76" height="8" fill="#64748b" />
      {/* frame structure */}
      <g fill="#9ca3af">
        {columns.map((x) => (
          <rect key={x} x={x} y="150" width="10" height="150" />
        ))}
        <rect x="140" y="292" width="250" height="10" />
        <rect x="140" y="240" width="250" height="10" fill="#a8a29e" />
        <rect x="140" y="190" width="250" height="10" fill="#a8a29e" />
        <rect x="140" y="146" width="140" height="8" fill="#a8a29e" />
      </g>
      {/* brick infill on ground floor */}
      <g fill="#c2410c" opacity="0.85">
        {Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 4 }, (_, col) => (
            <rect key={`${row}-${col}`} x={162 + col * 11 + (row % 2) * 5} y={252 + row * 8} width="10" height="6" rx="1" />
          )),
        )}
      </g>
      <rect x="270" y="252" width="38" height="40" fill="#bae6fd" opacity="0.7" />
      {/* scaffolding */}
      <g stroke="#475569" strokeWidth="2">
        <line x1="392" y1="300" x2="392" y2="180" />
        <line x1="420" y1="300" x2="420" y2="180" />
        {[200, 240, 280].map((y) => (
          <line key={y} x1="388" y1={y} x2="424" y2={y} />
        ))}
        <line x1="392" y1="280" x2="420" y2="240" strokeWidth="1" />
        <line x1="392" y1="240" x2="420" y2="200" strokeWidth="1" />
      </g>
      <rect x="0" y="300" width="480" height="60" fill="#d6d3d1" />
      <rect x="0" y="300" width="480" height="5" fill="#a8a29e" />
      {/* cones & workers */}
      <path d="M440 330 l8 -20 l8 20z" fill="#a47a2c" />
      <rect x="442" y="318" width="12" height="3" fill="#fff" />
      <Worker x={200} y={318} />
      <Worker x={245} y={322} vest="#22c55e" />
      <Worker x={415} y={156} />
      {/* geofence pin */}
      <g transform="translate(330 222)">
        <ellipse cx="0" cy="78" rx="46" ry="10" fill="#a47a2c" opacity="0.18" />
        <path d="M0 0 c-12 0 -20 9 -20 20 c0 14 20 34 20 34 s20 -20 20 -34 c0 -11 -8 -20 -20 -20z" fill="#134332" />
        <circle cx="0" cy="20" r="7" fill="#a47a2c" />
      </g>
    </svg>
  );
}

function DesignScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-label="Architectural blueprint with drafting tools">
      <g transform="rotate(-6 240 180)">
        <rect x="70" y="50" width="330" height="240" rx="6" fill="#1e3a8a" />
        <g stroke="#3b82f6" strokeWidth="0.6" opacity="0.6">
          {Array.from({ length: 17 }, (_, i) => (
            <line key={`v${i}`} x1={70 + i * 20} y1="50" x2={70 + i * 20} y2="290" />
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <line key={`h${i}`} x1="70" y1={50 + i * 20} x2="400" y2={50 + i * 20} />
          ))}
        </g>
        {/* floor plan */}
        <g stroke="#e0f2fe" strokeWidth="3" fill="none">
          <rect x="100" y="80" width="200" height="170" />
          <line x1="190" y1="80" x2="190" y2="170" />
          <line x1="100" y1="170" x2="230" y2="170" />
          <line x1="250" y1="170" x2="300" y2="170" />
          <line x1="230" y1="170" x2="230" y2="250" />
        </g>
        <g stroke="#e0f2fe" strokeWidth="1.5" fill="none">
          <path d="M190 140 a22 22 0 0 1 22 22" />
          <line x1="190" y1="140" x2="212" y2="140" strokeDasharray="0" />
          <path d="M150 170 a20 20 0 0 0 -20 20" />
          <rect x="245" y="95" width="40" height="55" strokeDasharray="4 3" />
          <rect x="115" y="190" width="50" height="34" />
          <circle cx="270" cy="215" r="14" />
        </g>
        <g fill="#bfdbfe" fontSize="9" fontFamily="ui-sans-serif, system-ui" fontWeight="600">
          <text x="120" y="120">LIVING</text>
          <text x="232" y="122">BED 1</text>
          <text x="116" y="245">KITCHEN</text>
          <text x="244" y="245">DINING</text>
        </g>
        <g stroke="#93c5fd" strokeWidth="1">
          <line x1="100" y1="268" x2="300" y2="268" />
          <line x1="100" y1="262" x2="100" y2="274" />
          <line x1="300" y1="262" x2="300" y2="274" />
        </g>
        <text x="186" y="282" fill="#bfdbfe" fontSize="9" fontFamily="ui-sans-serif, system-ui">12.0 m</text>
        {/* elevation thumbnail */}
        <g stroke="#e0f2fe" strokeWidth="2" fill="none">
          <path d="M320 150 l35 -28 l35 28" />
          <rect x="326" y="150" width="58" height="44" />
          <rect x="348" y="170" width="14" height="24" />
          <rect x="332" y="158" width="10" height="10" />
          <rect x="368" y="158" width="10" height="10" />
        </g>
        <rect x="318" y="210" width="74" height="70" fill="none" stroke="#bfdbfe" strokeWidth="1" />
        <g fill="#bfdbfe" fontSize="7" fontFamily="ui-sans-serif, system-ui">
          <text x="324" y="224">PROJECT: EPC</text>
          <text x="324" y="238">DWG: S3 · PLAN</text>
          <text x="324" y="252">SCALE 1:100</text>
          <text x="324" y="266">REV B</text>
        </g>
      </g>
      {/* set square */}
      <path d="M300 340 L430 340 L430 210 Z" fill="#a47a2c" opacity="0.9" />
      <path d="M340 326 L414 326 L414 252 Z" fill="#f5f5f4" />
      {/* scale ruler */}
      <g transform="rotate(-20 120 320)">
        <rect x="30" y="300" width="200" height="22" rx="3" fill="#fde68a" />
        {Array.from({ length: 20 }, (_, i) => (
          <line key={i} x1={40 + i * 9.5} y1="300" x2={40 + i * 9.5} y2={i % 5 === 0 ? 312 : 307} stroke="#78350f" strokeWidth="1" />
        ))}
      </g>
      {/* pencil */}
      <g transform="rotate(35 420 90)">
        <rect x="380" y="80" width="90" height="12" fill="#facc15" />
        <rect x="462" y="80" width="12" height="12" fill="#f472b6" />
        <path d="M380 80 L364 86 L380 92 Z" fill="#fcd9b6" />
        <path d="M368 84.5 L364 86 L368 87.5 Z" fill="#134332" />
      </g>
    </svg>
  );
}

function OfficeScene({ className }: { className?: string }) {
  const bars = [40, 62, 54, 80, 96];
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-label="Company office with KPI charts">
      <path d="M0 310 L480 310 L480 360 L0 360Z" fill="#d6d3d1" />
      {/* tower */}
      <rect x="60" y="70" width="150" height="240" fill="#134332" />
      <rect x="60" y="60" width="150" height="14" fill="#1c4a39" />
      {Array.from({ length: 9 }, (_, row) =>
        Array.from({ length: 4 }, (_, col) => (
          <rect
            key={`${row}-${col}`}
            x={74 + col * 33}
            y={86 + row * 24}
            width="24"
            height="14"
            rx="1.5"
            fill={(row + col) % 3 === 0 ? "#fde68a" : "#38bdf8"}
            opacity={(row + col) % 3 === 0 ? 0.95 : 0.45}
          />
        )),
      )}
      <rect x="118" y="282" width="34" height="28" fill="#a47a2c" />
      <rect x="200" y="150" width="70" height="160" fill="#334155" />
      {Array.from({ length: 6 }, (_, row) => (
        <rect key={row} x="212" y={166 + row * 22} width="46" height="10" rx="1.5" fill="#94a3b8" opacity="0.5" />
      ))}
      {/* KPI card */}
      <g transform="translate(270 70)">
        <rect width="180" height="150" rx="12" fill="#ffffff" stroke="#e7e5e4" />
        <rect x="16" y="16" width="70" height="8" rx="4" fill="#d6d3d1" />
        <text x="16" y="48" fontSize="22" fontWeight="700" fill="#134332" fontFamily="ui-sans-serif, system-ui">94%</text>
        <text x="74" y="48" fontSize="9" fill="#16a34a" fontFamily="ui-sans-serif, system-ui">▲ on-site</text>
        {bars.map((h, i) => (
          <rect key={i} x={18 + i * 30} y={136 - h} width="18" height={h} rx="3" fill={i === bars.length - 1 ? "#a47a2c" : "#e8d6b0"} />
        ))}
        <line x1="12" y1="136" x2="168" y2="136" stroke="#e7e5e4" />
      </g>
      {/* donut */}
      <g transform="translate(400 262)">
        <circle r="34" fill="#ffffff" stroke="#e7e5e4" />
        <circle r="22" fill="none" stroke="#e7e5e4" strokeWidth="10" />
        <circle r="22" fill="none" stroke="#a47a2c" strokeWidth="10" strokeDasharray="100 138" transform="rotate(-90)" />
        <circle r="22" fill="none" stroke="#134332" strokeWidth="10" strokeDasharray="22 138" strokeDashoffset="-100" transform="rotate(-90)" />
      </g>
      {/* people */}
      <g transform="translate(300 270)">
        <circle cx="0" cy="0" r="9" fill="#c68a5c" />
        <rect x="-12" y="12" width="24" height="28" rx="8" fill="#134332" />
      </g>
      <g transform="translate(336 274)">
        <circle cx="0" cy="0" r="9" fill="#8d5a3b" />
        <rect x="-12" y="12" width="24" height="24" rx="8" fill="#a47a2c" />
      </g>
      <rect x="0" y="310" width="480" height="5" fill="#a8a29e" />
    </svg>
  );
}

function SupplyScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-label="Material delivery truck and bill of quantities">
      <path d="M0 300 L480 300 L480 360 L0 360Z" fill="#d6d3d1" />
      <rect x="0" y="300" width="480" height="5" fill="#a8a29e" />
      {/* truck */}
      <g transform="translate(30 170)">
        <rect x="0" y="40" width="200" height="80" rx="4" fill="#a47a2c" />
        <rect x="200" y="62" width="70" height="58" rx="6" fill="#134332" />
        <rect x="212" y="70" width="44" height="24" rx="3" fill="#7dd3fc" />
        {/* load: bricks & steel */}
        {Array.from({ length: 3 }, (_, row) =>
          Array.from({ length: 6 }, (_, col) => (
            <rect key={`${row}-${col}`} x={12 + col * 24 + (row % 2) * 8} y={22 + row * 7 - 6} width="22" height="6" rx="1" fill="#b45309" />
          )),
        )}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={i} x1="10" y1={4 + i * 3} x2="196" y2={4 + i * 3} stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        ))}
        <circle cx="50" cy="124" r="16" fill="#134332" />
        <circle cx="50" cy="124" r="6" fill="#a8a29e" />
        <circle cx="230" cy="124" r="16" fill="#134332" />
        <circle cx="230" cy="124" r="6" fill="#a8a29e" />
        <text x="16" y="88" fontSize="16" fontWeight="800" fill="#fff" fontFamily="ui-sans-serif, system-ui">PO-2026-014</text>
      </g>
      {/* clipboard BoQ */}
      <g transform="translate(320 40) rotate(4)">
        <rect width="130" height="170" rx="10" fill="#78350f" />
        <rect x="8" y="14" width="114" height="148" rx="4" fill="#ffffff" />
        <rect x="42" y="4" width="46" height="16" rx="4" fill="#475569" />
        <text x="18" y="38" fontSize="10" fontWeight="700" fill="#134332" fontFamily="ui-sans-serif, system-ui">BILL OF QUANTITIES</text>
        {Array.from({ length: 6 }, (_, i) => (
          <g key={i} transform={`translate(18 ${52 + i * 17})`}>
            <rect width="9" height="9" rx="2" fill={i < 4 ? "#22c55e" : "#e7e5e4"} />
            {i < 4 && <path d="M2 4.5 l2 2 l3.5 -4" stroke="#fff" strokeWidth="1.5" fill="none" />}
            <rect x="15" y="2" width={50 + ((i * 13) % 20)} height="5" rx="2.5" fill="#d6d3d1" />
            <rect x="74" y="2" width="20" height="5" rx="2.5" fill="#e8d6b0" />
          </g>
        ))}
      </g>
      {/* calculator */}
      <g transform="translate(330 220)">
        <rect width="76" height="96" rx="10" fill="#134332" />
        <rect x="10" y="10" width="56" height="20" rx="3" fill="#bbf7d0" />
        <text x="18" y="25" fontSize="11" fontWeight="700" fill="#14532d" fontFamily="ui-monospace, monospace">₹4.8L</text>
        {Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: 3 }, (_, c) => (
            <rect key={`${r}-${c}`} x={10 + c * 20} y={38 + r * 18} width="15" height="13" rx="3" fill={c === 2 && r === 2 ? "#a47a2c" : "#475569"} />
          )),
        )}
      </g>
      {/* cement bags */}
      <g transform="translate(250 262)">
        <rect width="40" height="38" rx="6" fill="#e7e5e4" stroke="#a8a29e" />
        <rect x="8" y="12" width="24" height="10" rx="2" fill="#94a3b8" />
      </g>
    </svg>
  );
}
