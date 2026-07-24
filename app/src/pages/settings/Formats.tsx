// Route page: /settings/formats — Picture Ending format-code catalog.

import { MovieFormatsSection } from "../Settings";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

export default function SettingsFormatsPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Formats</h2>
        <p className="text-sm text-ink-muted mt-1">
          Format codes printed beside the film title on a Picture Ending statement.
        </p>
      </div>
      <MovieFormatsSection />
    </div>
  );
}
