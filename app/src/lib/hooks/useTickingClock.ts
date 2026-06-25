import { useEffect, useState } from "react";

/**
 * A Date that updates every `intervalMs` (default 60s). Lets time-gated UI —
 * the per-show entry unlock on the Schedule/Entry pages — flip from locked to
 * open while the page sits open, without a manual reload. One-minute ticks are
 * plenty for a 30-minute gate.
 */
export function useTickingClock(intervalMs = 60_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
