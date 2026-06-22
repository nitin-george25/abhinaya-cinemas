import { Card, CardBody } from "../ui/Card";
import { Input, Select, Field } from "../ui/Input";
import type { AppState, DateISO, UUID } from "../../lib/types";

interface Props {
  state: AppState;
  date: DateISO;
  movieId: UUID | "";
  screenId: UUID | "";
  /** Effective distributor share % to display (already resolved per-day →
   *  week → base by the caller). */
  share: number;
  /** Where the displayed rate comes from — drives the field hint. */
  shareSource: "override" | "week" | "base";
  /** Whether the share field may be edited. On a locked DCR this is true only
   *  for owner + manager; every other role sees a read-only share. */
  shareEditable: boolean;
  onChange: (patch: {
    date?: DateISO;
    movieId?: UUID | "";
    screenId?: UUID | "";
    /** A positive number sets a per-day override; null clears it (inherit the
     *  week / base rate). */
    share?: number | null;
  }) => void;
}

/**
 * Top of the entry editor — date / movie / screen / share %.
 * Used both before an entry exists (creation context) and after
 * (in-place editing of share %).
 */
export function EntryHeader({
  state,
  date,
  movieId,
  screenId,
  share,
  shareSource,
  shareEditable,
  onChange,
}: Props) {
  return (
    <Card>
      <CardBody className="grid gap-4 sm:grid-cols-4">
        <Field label="Date">
          <Input
            type="date"
            value={date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </Field>

        <Field label="Movie">
          <Select
            value={movieId}
            onChange={(e) => {
              // Switching movies clears any staged per-day override; the new
              // movie's week/base rate is resolved by the parent.
              onChange({ movieId: e.target.value as UUID | "" });
            }}
          >
            <option value="">— pick —</option>
            {state.movies.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Screen">
          <Select
            value={screenId}
            onChange={(e) => onChange({ screenId: e.target.value as UUID | "" })}
          >
            <option value="">— pick —</option>
            {state.screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Distributor share"
          hint={
            !shareEditable
              ? "Locked after 2 days"
              : shareSource === "override"
                ? "Per-day override · clear to use the week rate"
                : shareSource === "week"
                  ? "From this run week's rate · type to override"
                  : "From the movie's base rate · type to override"
          }
        >
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={Number.isFinite(share) ? share : 0}
            disabled={!shareEditable}
            onChange={(e) => {
              // Blank / 0 / non-positive clears the per-day override so the day
              // inherits the week (else base) rate; a positive value pins it.
              const n = e.target.value.trim() === "" ? NaN : Number(e.target.value);
              onChange({ share: Number.isFinite(n) && n > 0 ? n : null });
            }}
            className="tabular-nums"
          />
        </Field>
      </CardBody>
    </Card>
  );
}
