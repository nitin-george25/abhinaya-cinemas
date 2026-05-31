import { PlaceholderPage } from "./PlaceholderPage";

export default function EntryPage() {
  return (
    <PlaceholderPage
      title="Today's entry"
      phase="C4"
      description={
        <>
          Date / movie / screen pickers, show editor with class-level ticket
          inputs, auto-fund + auto-serial logic, live DCR preview pane. Touch-
          friendly inputs so it works on a phone at the box office.
        </>
      }
      notes={
        <p>
          Highest-risk pane — math impact is direct. Engine is already ported
          (Phase C1); this page is the form on top of it.
        </p>
      }
    />
  );
}
