import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

type Align = "left" | "right";

interface Col<T> {
  header: string;
  align?: Align;
  /** Width as Tailwind class (e.g. "w-32") or auto. */
  width?: string;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  cols: Col<T>[];
  empty?: string;
  /** Max rows to show; the rest gets a "+N more" footer. */
  limit?: number;
}

export function RollupTable<T>({
  title,
  subtitle,
  rows,
  cols,
  empty = "No data in this period.",
  limit,
}: Props<T>) {
  const visible = limit ? rows.slice(0, limit) : rows;
  const hidden = rows.length - visible.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <span className="text-xs text-ink-muted">{subtitle}</span> : null}
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  {cols.map((c, i) => (
                    <th
                      key={i}
                      className={
                        "px-5 py-3 font-semibold " +
                        (c.align === "right" ? "text-right" : "text-left") +
                        (c.width ? " " + c.width : "")
                      }
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-b border-line last:border-b-0 hover:bg-paper/60"
                  >
                    {cols.map((c, ci) => (
                      <td
                        key={ci}
                        className={
                          "px-5 py-3 " +
                          (c.align === "right" ? "text-right tabular-nums" : "")
                        }
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {hidden > 0 ? (
              <div className="px-5 py-3 text-xs text-ink-muted border-t border-line">
                + {hidden} more
              </div>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
