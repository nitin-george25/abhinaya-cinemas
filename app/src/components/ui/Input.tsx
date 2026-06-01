import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
  WheelEvent,
} from "react";
import { cn } from "./cn";

const fieldBase =
  "block w-full h-10 rounded-lg border border-line bg-white px-3 text-sm " +
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

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select {...rest} className={cn(fieldBase, "appearance-none pr-9", className)}>
      {children}
    </select>
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
