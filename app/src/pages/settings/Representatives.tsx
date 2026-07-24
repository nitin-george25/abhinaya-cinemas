// Route page: /settings/representatives — distributor representatives catalog.

import { RepresentativesSection } from "../Settings";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

export default function SettingsRepresentativesPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Representatives</h2>
        <p className="text-sm text-ink-muted mt-1">
          The people distributors send to collect a settlement. Each belongs to one
          distributor, and a Picture Ending statement only offers that film's.
        </p>
      </div>
      <RepresentativesSection />
    </div>
  );
}
