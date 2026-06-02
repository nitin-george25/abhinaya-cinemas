// Route page: /reports/box-office — placeholder until the BO report ships.

import { Card, CardBody } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";

export default function ReportsBoPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          Box Office reports
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Day-wise BO collection breakdowns, distributor settlements, and
          movie-wise rollups.
        </p>
      </div>
      <Card>
        <CardBody className="py-12 text-center space-y-3">
          <Badge tone="neutral">Coming soon</Badge>
          <p className="text-sm text-ink-muted">
            The BO report is the next workstream. Until then, use{" "}
            <a className="text-amber-600 underline" href="/admin/dcr/box-office/history">
              Box Office &rarr; History
            </a>{" "}
            for the same data.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
