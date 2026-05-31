import { useSync } from "../lib/hooks/SyncContext";
import { PlaceholderPage } from "./PlaceholderPage";

export default function HistoryPage() {
  const { state } = useSync();
  const entries = state.appState?.entries.length ?? 0;
  return (
    <PlaceholderPage
      title="History"
      phase="C5"
      description={
        <>
          Filterable table of every entry — by date range, movie, screen. Each
          row opens the DCR view with the PDF download button.
        </>
      }
      notes={<p>Currently {entries} entries in the cloud.</p>}
    />
  );
}
