import { PlaceholderPage } from "./PlaceholderPage";

export default function BackupPage() {
  return (
    <PlaceholderPage
      title="Backup"
      phase="C6"
      description={
        <>
          Export the full cloud snapshot as JSON, import a snapshot back
          (owner-only). Last-export indicator + backup-reminder logic from
          the legacy Backup tab.
        </>
      }
    />
  );
}
