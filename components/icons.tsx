import type { SVGProps } from "react";

// Shared inline line-icons (24px grid, 2px stroke, round) — no dependency.
// Size at the call site with a className (e.g. "h-[22px] w-[22px]").
const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function IconClipboard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}
export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
export function IconChecklist(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M11 6h9M11 12h9M11 18h9" />
      <path d="m3 5 1.4 1.4L6 4" />
      <path d="m3 11 1.4 1.4L6 10" />
      <path d="m3 17 1.4 1.4L6 16" />
    </svg>
  );
}
export function IconPin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function IconNote(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
export function IconShield(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
export function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
      <path d="M15 9h3a1 1 0 0 1 1 1v11" />
      <path d="M3 21h18" />
      <path d="M9 8h.01M12 8h.01M9 12h.01M12 12h.01M9 16h.01M12 16h.01" />
    </svg>
  );
}
export function IconBuildings(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M15 21V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14" />
      <path d="M15 10h4a1 1 0 0 1 1 1v10" />
      <path d="M2 21h20" />
      <path d="M8 9h.01M11 9h.01M8 13h.01M11 13h.01M8 17h.01M11 17h.01" />
    </svg>
  );
}
export function IconSofa(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
      <rect x="3" y="12" width="18" height="6" rx="1.5" />
      <path d="M6 18v2M18 18v2" />
    </svg>
  );
}
export function IconUserSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="7" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 8-5.6" />
      <circle cx="17.5" cy="16.5" r="3" />
      <path d="m22 21-2-2" />
    </svg>
  );
}
export function IconChartLine(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3v18h18" />
      <path d="m7 14 3-4 3 3 5-6" />
    </svg>
  );
}
export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
export function IconStore(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4h16l1.2 4H2.8L4 4Z" />
      <path d="M4.5 8v11a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8" />
      <path d="M9 20v-5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5" />
    </svg>
  );
}
export function IconWarehouse(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 21V9l9-5 9 5v12" />
      <path d="M3 21h18" />
      <rect x="8" y="13" width="8" height="8" />
      <path d="M8 16h8M8 18.5h8" />
    </svg>
  );
}
