import type { ReactNode } from "react";
import { Card, CardBody } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

interface Props {
  title: string;
  phase: string;             // e.g. "C3"
  description: ReactNode;
  notes?: ReactNode;
}

/** Shared scaffold for the C2 stub pages. Each real page replaces this in C3+. */
export function PlaceholderPage({ title, phase, description, notes }: Props) {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge tone="amber">{`Phase ${phase}`}</Badge>
          <span className="text-xs uppercase tracking-wider text-ink-muted">Placeholder</span>
        </div>
        <h2 className="font-display text-3xl font-bold tracking-tight">{title}</h2>
        <p className="text-ink-muted mt-2 leading-relaxed">{description}</p>
      </div>
      {notes ? (
        <Card>
          <CardBody className="text-sm text-ink-muted leading-relaxed space-y-1.5">
            {notes}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
