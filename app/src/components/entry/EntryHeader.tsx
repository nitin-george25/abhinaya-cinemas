import { Card, CardBody } from "../ui/Card";
import { Input, Select, Field } from "../ui/Input";
import type { AppState, DateISO, UUID } from "../../lib/types";

interface Props {
  state: AppState;
  date: DateISO;
  movieId: UUID | "";
  screenId: UUID | "";
  share: number;
  /** True when the surrounding DCR is locked (older than 2 days, non-owner). */
  dcrLocked: boolean;
  /** Whether the share field may be edited. On a locked DCR this is true only
   *  for owner + manager; every other role sees a read-only share. */
  shareEditable: boolean;
  onChange: (patch: {
    date?: DateISO;
    movieId?: UUID | "";
    screenId?: UUID | "";
    share?: number;
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
  dcrLocked,
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
              const id = e.target.value as UUID | "";
              const m = state.movies.find((x) => x.id === id);
              onChange({ movieId: id, share: m?.share ?? share });
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
              : dcrLocked
                ? "Editable even after the 2-day lock"
                : "Defaults from movie"
          }
        >
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={Number.isFinite(share) ? share : 0}
            disabled={!shareEditable}
            onChange={(e) => onChange({ share: Number(e.target.value) || 0 })}
            className="tabular-nums"
          />
        </Field>
      </CardBody>
    </Card>
  );
}
