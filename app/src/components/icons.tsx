// Tiny inline SVG icon set. 20×20 viewBox, currentColor stroke.
// Sized via className (e.g. "w-4 h-4"); colored via parent's text color.
// Kept inline to avoid pulling in lucide-react for ~10 icons.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function svg(d: string) {
  return function Icon({ className = "w-4 h-4", ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...rest}
      >
        <path d={d} />
      </svg>
    );
  };
}

export const IconDashboard = svg(
  "M3 10h6V3H3v7zm8 11h6V10h-6v11zm-8 0h6v-7H3v7zm8-18v5h6V3h-6z",
);
export const IconEntry = svg(
  "M5 4h7l4 4v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 4v4h4M7 12h6M7 15h4",
);
export const IconHistory = svg(
  "M3 12a7 7 0 1 0 2-4.95M3 4v3.5h3.5M10 7v5l3 2",
);
export const IconFB = svg(
  "M3 8h14M5 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M5 8v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8",
);
export const IconActivity = svg(
  "M3 12h3l2-7 4 14 2-7h3",
);
export const IconBackup = svg(
  "M10 3v10m0 0-3-3m3 3 3-3M4 14v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2",
);
export const IconSettings = svg(
  "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 10a6 6 0 0 0-.07-.94l1.6-1.25-1.6-2.77-1.93.65a6 6 0 0 0-1.63-.94L12 3h-3l-.37 1.75a6 6 0 0 0-1.63.94l-1.93-.65-1.6 2.77 1.6 1.25A6 6 0 0 0 5 10c0 .32.02.63.07.94l-1.6 1.25 1.6 2.77 1.93-.65c.48.4 1.03.71 1.63.94L9 17h3l.37-1.75c.6-.23 1.15-.54 1.63-.94l1.93.65 1.6-2.77-1.6-1.25c.05-.31.07-.62.07-.94z",
);
export const IconSignOut = svg(
  "M7 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M14 7l3 3-3 3M7 10h10",
);
export const IconCheck = svg("M4 10l4 4 8-8");
export const IconAlert = svg("M10 6v4m0 3.5v.01M3 16l7-12 7 12H3z");
export const IconSpinner = ({ className = "w-4 h-4" }: IconProps) => (
  <svg viewBox="0 0 20 20" className={`${className} animate-spin`} fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth={2} opacity={0.25} />
    <path
      d="M17 10a7 7 0 0 0-7-7"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
);
export const IconChevronDown = svg("M5 8l5 5 5-5");
export const IconCash = svg(
  "M2 6h16v8H2zM2 9h16M10 12.5a2 2 0 1 0 0-3 2 2 0 0 0 0 3z",
);
// Bank / finance — pillared building (payments, settlements, ledger, cashflow).
export const IconFinance = svg(
  "M3 8l7-4 7 4M4 8v7M8 8v7M12 8v7M16 8v7M3 16h14",
);
// Project management — clipboard with a checklist (renovations & projects).
export const IconProjects = svg(
  "M7 4h6M7 4a1 1 0 0 0-1 1v0a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v0a1 1 0 0 0-1-1M6 5H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M7.5 10l1.5 1.5L12 9",
);
// Operations — calendar grid (rosters, checklists, scheduling).
export const IconOperations = svg(
  "M5 4h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 8h12M7 3v3M13 3v3M7 11h2M11 11h2",
);
