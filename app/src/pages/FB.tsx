import { PlaceholderPage } from "./PlaceholderPage";

export default function FBPage() {
  return (
    <PlaceholderPage
      title="F&B sales"
      phase="C6"
      description={
        <>
          F&amp;B Sales view, Menu Items editor, bulk-upload pane for
          backfilling from POS PDFs / CSVs. Same sub-tabs as the legacy
          console, restructured around the new design system.
        </>
      }
    />
  );
}
