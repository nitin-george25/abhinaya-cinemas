import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "amber" | "green" | "red" | "blue";

const tones: Record<Tone, string> = {
  neutral: "bg-paper text-ink-muted border-line",
  amber:   "bg-amber-50 text-ink-soft border-amber-200",
  green:   "bg-green-50 text-green-800 border-green-200",
  red:     "bg-red-50 text-red-800 border-red-200",
  blue:    "bg-blue-50 text-blue-800 border-blue-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5",
        "text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
