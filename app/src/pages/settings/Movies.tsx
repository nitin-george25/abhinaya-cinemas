// Route page: /settings/movies — Movies catalog editor.

import { MoviesSection } from "../Settings";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

export default function SettingsMoviesPage() {
  return (
    <div className="space-y-5 max-w-7xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Movies</h2>
        <p className="text-sm text-ink-muted mt-1">
          Master catalog. Edits sync to every screen and entry.
        </p>
      </div>
      <MoviesSection />
    </div>
  );
}
