import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

// Variant + size tokens kept in one place so we can re-skin the app from
// a single file when the design hardens in C3.
const variantClasses: Record<Variant, string> = {
  primary:   "bg-ink text-white hover:bg-ink-soft active:bg-ink-soft disabled:bg-ink-muted",
  secondary: "bg-white text-ink border border-line hover:bg-paper disabled:opacity-50",
  ghost:     "bg-transparent text-ink hover:bg-paper disabled:opacity-50",
  danger:    "bg-red-600 text-white hover:bg-red-700 disabled:opacity-50",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "transition-colors disabled:cursor-not-allowed",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
