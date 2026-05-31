import { useMemo } from "react";
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

export function RevenueChart({ dates, bo }: Props) {
  const data = useMemo(
    () =>
      dates.map((d) => ({
        date: d,
        label: format(parseISO(d), "d MMM"),
        gross: bo.daily.get(d)?.grossColl ?? 0,
      })),
    [dates, bo],
  );
  const wide = data.length > 30;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue by day</CardTitle>
        <span className="text-xs text-ink-muted">BO gross collection · ₹</span>
      </CardHeader>
      <CardBody>
        <div className="h-72 -ml-2 -mr-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#F1EFEA" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#5C6470" }}
                interval={wide ? "preserveStartEnd" : 0}
                tickLine={false}
                axisLine={{ stroke: "#E6E4DE" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#5C6470" }}
                tickFormatter={(v) => "₹" + (Number(v) / 1000).toFixed(0) + "k"}
                width={60}
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
