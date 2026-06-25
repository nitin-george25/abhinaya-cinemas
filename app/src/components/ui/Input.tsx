import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
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

export function Input({ className, onWheel, onFocus, type, ...rest }: InputProps) {
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

  // For number inputs: select the current value on focus so a "0" placeholder
  // doesn't trap the user — typing replaces it instead of appending. Caller's
  // own onFocus still runs first.
  //
  // Using requestAnimationFrame is important: on iOS Safari, calling
  // select() inside the focus handler synchronously is unreliable because
  // the browser hasn't placed the cursor yet. Deferring by one frame works
  // on every browser we target.
  const handleFocus = isNumber
    ? (e: FocusEvent<HTMLInputElement>) => {
        onFocus?.(e);
        if (e.defaultPrevented) return;
        const target = e.currentTarget;
        requestAnimationFrame(() => {
          try { target.select(); } catch { /* detached node — ignore */ }
        });
      }
    : onFocus;

  return (
    <input
      {...rest}
      type={type}
      onWheel={handleWheel}
      onFocus={handleFocus}
      className={cn(fieldBase, isNumber && numberOverrides, className)}
    />
  );
}

// ── shared dropdown styling + icons ───────────────────────────────────────

// Portaled popover panel (Headless UI `anchor` renders it in the top layer
// and positions it with floating-ui, so it never clips inside a modal/table).
const panelBase =
  "z-[80] [--anchor-gap:4px] origin-top max-h-72 overflow-auto rounded-lg " +
  "border border-line bg-white p-1 shadow-lg focus:outline-none " +
  "transition duration-100 ease-out data-[closed]:opacity-0 data-[closed]:scale-95";

const optionBase =
  "group flex items-center justify-between gap-2 rounded-md px-3 py-2 text-base sm:text-sm " +
  "cursor-pointer select-none data-[focus]:bg-paper " +
  "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed";

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Flatten <option> (and fragment/conditional) children into a flat list. */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (child == null || typeof child === "boolean") return;
      if (!isValidElement(child)) return;
      const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
      if (child.type === "option") {
        const label = props.children;
        // Native <option> semantics: use the `value` attr when present, else
        // fall back to the text body (a value-less <option>Food</option> has
        // value "Food") — so options without an explicit value still work.
        const value =
          props.value != null
            ? String(props.value)
            : typeof label === "string" || typeof label === "number"
              ? String(label)
              : "";
        out.push({ value, label, disabled: props.disabled });
      } else if (props.children != null) {
        walk(props.children); // fragment / wrapper
      }
    });
  };
  walk(children);
  return out;
}

interface SelectProps {
  value?: string | number;
  /** Native-compatible: handlers read `e.target.value`. */
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-label"?: string;
}

/**
 * Custom dropdown (Headless UI Listbox) that keeps the native
 * `<Select><option>…</option></Select>` API — `value`, `onChange(e.target.value)`,
 * `disabled`, and `<option>` children — so it's a drop-in for the old native
 * select while rendering our own styled, portaled panel. Long, searchable
 * lists (movies, distributors) should use `<SearchSelect>` instead.
 */
export function Select({ value, onChange, disabled, className, children, id, ...aria }: SelectProps) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const v = String(value ?? "");
  const current = options.find((o) => o.value === v);
  const isEmpty = !current || current.value === "";
  return (
    <Listbox value={v} onChange={(next: string) => onChange?.({ target: { value: next } })} disabled={disabled}>
      <div className={cn("relative", disabled && "opacity-60")}>
        <ListboxButton
          id={id}
          aria-label={aria["aria-label"]}
          className={cn(
            fieldBase,
            "flex items-center justify-between gap-2 text-left cursor-pointer hover:border-ink-muted",
            className,
          )}
        >
          <span className={cn("truncate", isEmpty && "text-ink-muted")}>{current?.label ?? "Select…"}</span>
          <ChevronIcon className="shrink-0 w-4 h-4 text-ink-muted" />
        </ListboxButton>
        <ListboxOptions anchor="bottom start" transition className={cn(panelBase, "w-[var(--button-width)]")}>
          {options.map((o, i) => (
            <ListboxOption key={`${o.value}-${i}`} value={o.value} disabled={o.disabled} className={optionBase}>
              <span className={cn("truncate", o.value === "" && "text-ink-muted")}>{o.label}</span>
              <CheckIcon className="shrink-0 w-4 h-4 text-amber-600 opacity-0 group-data-[selected]:opacity-100" />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

interface SearchSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Searchable dropdown (Headless UI Combobox) for long lists — type to filter
 * by label; `value`/`onChange` carry the selected option's `value`. Use the
 * plain `<Select>` for short, fixed lists.
 */
export function SearchSelect({
  value, onChange, options, placeholder = "Search…", emptyText = "No matches",
  disabled, className, id,
}: SearchSelectProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q === "" ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  return (
    <Combobox
      value={value ?? ""}
      onChange={(next: string | null) => onChange?.(next ?? "")}
      onClose={() => setQuery("")}
      disabled={disabled}
      immediate
    >
      <div className={cn("relative", disabled && "opacity-60")}>
        <ComboboxInput
          id={id}
          className={cn(fieldBase, "pr-9 cursor-text", className)}
          placeholder={placeholder}
          autoComplete="off"
          displayValue={(v: string) => options.find((o) => o.value === v)?.label ?? ""}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-3" aria-label="Toggle options">
          <ChevronIcon className="w-4 h-4 text-ink-muted" />
        </ComboboxButton>
        <ComboboxOptions anchor="bottom start" transition className={cn(panelBase, "w-[var(--input-width)]")}>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-base sm:text-sm text-ink-muted">{emptyText}</div>
          ) : (
            filtered.map((o) => (
              <ComboboxOption key={o.value} value={o.value} disabled={o.disabled} className={optionBase}>
                <span className="truncate">{o.label}</span>
                <CheckIcon className="shrink-0 w-4 h-4 text-amber-600 opacity-0 group-data-[selected]:opacity-100" />
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
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
