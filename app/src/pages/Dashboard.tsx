import { useSync } from "../lib/hooks/SyncContext";
import { PlaceholderPage } from "./PlaceholderPage";

export default function Dashboard() {
  const { state } = useSync();
  const entries = state.appState?.entries.length ?? 0;
  return (
    <PlaceholderPage
      title="Dashboard"
      phase="C3"
      description={
        <>
          KPI strip, revenue chart, by-screen rollup, top movies table. Period
          selector with proper date math via <code>date-fns</code>. Recharts
          replaces the legacy Chart.js block.
        </>
      }
      notes={
        <>
          <p>Cloud is live — currently {entries} entries loaded.</p>
          <p>
            Comes online in Phase C3 (dashboard pane). Until then,{" "}
            <a className="text-amber-600 underline" href="/admin/dcr/">
              the legacy dashboard
            </a>{" "}
            stays the source of truth.
          </p>
        </>
      }
    />
  );
}
