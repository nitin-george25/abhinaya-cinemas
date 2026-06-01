// Route page: /settings/screens — Screens, class assignments, and price cards.

import { ScreensSection, PriceCardsSection } from "../Settings";

export default function SettingsScreensPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          Screens &amp; Classes
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Configure screens, seat classes, and per-screen price cards.
        </p>
      </div>
      <ScreensSection />
      <PriceCardsSection />
    </div>
  );
}
