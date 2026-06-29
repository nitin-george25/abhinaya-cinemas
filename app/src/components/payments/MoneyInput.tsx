// ============================================================================
// MoneyInput — a ₹ amount field. Right-aligned, tabular-nums, with a leading
// rupee adornment. Holds a raw string (so the field can be empty / mid-edit);
// callers parse with Number() at submit. Mirrors the styling of ui/Input.
// ============================================================================

import { Input } from "../ui/Input";

export function MoneyInput({
  value,
  onChange,
  id,
  disabled,
  placeholder = "0",
}: {
  value: string;
  onChange: (raw: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        ₹
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7 text-right tabular-nums"
      />
    </div>
  );
}
