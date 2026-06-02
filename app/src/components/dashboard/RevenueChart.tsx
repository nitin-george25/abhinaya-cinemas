import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";

import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { fmtINR } from "../../lib/dashboard";
import type { BoAggregate } from "../../lib/dashboard";
import type { DateISO } from "../../lib/types";

interface Props {
  dates: DateISO[];
  bo: BoAggregate;
}

/** Track viewport width so we can pick a label density appropriate for it. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

export function RevenueChart({ dates, bo }: Props) {
  const narrow = useIsNarrow();
  const data = useMemo(
    () =>
      dates.map((d) => ({
        date: d,
        label: format(parseISO(d), "d MMM"),
        gross: bo.daily.get(d)?.grossColl ?? 0,
      })),
    [dates, bo],
  );

  // Target ~5 visible labels on phones, ~12 on desktop. Recharts' interval
  // means "skip N between each rendered label", so we divide.
  const targetLabels = narrow ? 5 : 12;
  const interval = data.length > targetLabels
    ? Math.max(0, Math.ceil(data.length / targetLabels) - 1)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue by day</CardTitle>
        <span className="text-xs text-ink-muted">BO gross · ₹</span>
      </CardHeader>
      <CardBody>
        <div className="h-64 sm:h-72 -ml-2 -mr-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#F1EFEA" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: narrow ? 10 : 11, fill: "#5C6470" }}
                interval={interval}
                tickLine={false}
                axisLine={{ stroke: "#E6E4DE" }}
                minTickGap={narrow ? 12 : 8}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#5C6470" }}
                tickFormatter={(v) => "₹" + (Number(v) / 1000).toFixed(0) + "k"}
                width={narrow ? 44 : 60}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(247,182,31,0.08)" }}
                contentStyle={{
                  border: "1px solid #E6E4DE",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                formatter={(v) => [fmtINR(Number(v)), "BO Gross"]}
                labelClassName="text-ink-muted text-xs"
              />
              <Bar dataKey="gross" fill="#F7B61F" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
