// Route page: /settings/distributors — Distributors catalog editor.

import { DistributorsSection } from "../Settings";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

export default function SettingsDistributorsPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Distributors</h2>
        <p className="text-sm text-ink-muted mt-1">
          Distributor records and their point-of-contact. Pick one on each movie.
        </p>
      </div>
      <DistributorsSection />
    </div>
  );
}
