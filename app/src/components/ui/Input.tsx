import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
  WheelEvent,
} from "react";
import { cn } from "./cn";

// Mobile minimum touch target: 44px (h-11). Tightens to 40px on sm+ so the
// desktop layout doesn't get taller than it needs to.
const fieldBase =
  "block w-full h-11 sm:h-10 rounded-lg border border-line bg-white px-3 text-base sm:text-sm " +
  "placeholder:text-ink-muted text-ink tabular-nums " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 " +
  "disabled:bg-paper disabled:text-ink-muted disabled:cursor-not-allowed";

// For `type="number"` inputs we want to disable two annoyances:
//   • Mouse-wheel scrolling silently changing the value while the input
//     has focus (catches operators every time when scrolling the page).
//   • The browser's tiny up/down spinner buttons — they're hard to hit
//     on touch and never used in this app.
//
// Tailwind arbitrary properties hide the spinners in WebKit + Firefox.
const numberOverrides =
  // hide WebKit / Chromium / Edge spinners
  "[&::-webkit-outer-spin-button]:appearance-none " +
  "[&::-webkit-inner-spin-button]:appearance-none " +
  "[&::-webkit-inner-spin-button]:m-0 " +
  // hide Firefox spinners (and any future engine that respects appearance:textfield)
  "[appearance:textfield]";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, onWheel, type, ...rest }: InputProps) {
  const isNumber = type === "number";

  // For number inputs: blur on wheel so the page scrolls normally instead of
  // the browser silently incrementing/decrementing the value. Caller's own
  // onWheel still runs first.
  const handleWheel = isNumber
    ? (e: WheelEvent<HTMLInputElement>) => {
        onWheel?.(e);
        if (!e.defaultPrevented) {
          (e.currentTarget as HTMLInputElement).blur();
        }
      }
    : onWheel;

  return (
    <input
      {...rest}
      type={type}
      onWheel={handleWheel}
      className={cn(fieldBase, isNumber && numberOverrides, className)}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

/**
 * Native <select> wrapped with a chevron overlay so it looks like a
 * proper dropdown instead of an unmarked input. We keep the underlying
 * <select> on purpose: the native picker is accessible, keyboard-
 * friendly, and on mobile uses the OS-provided wheel — a custom popover
 * would lose all three for no real gain at this scale.
 *
 * The wrapping <div> is `relative`; the chevron is `pointer-events-none`
 * so clicks pass through to the select.
 */
export function Select({ className, children, disabled, ...rest }: SelectProps) {
  return (
    <div className={cn("relative", disabled && "opacity-60")}>
      <select
        {...rest}
        disabled={disabled}
        className={cn(
          fieldBase,
          "appearance-none pr-9 cursor-pointer",
          // Subtle hover affordance on desktop. Mobile ignores hover.
          "hover:border-ink-muted",
          className,
        )}
      >
        {children}
      </select>
      {/* Chevron — purely decorative, never intercepts clicks. */}
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted"
      >
        <path d="M5 8l5 5 5-5" />
      </svg>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}
