// Route page: /fb/menu-items — owner-only F&B catalog editor.

import { MenuItemsSection } from "../Settings";

export default function FBMenuItemsPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Menu items</h2>
        <p className="text-sm text-ink-muted mt-1">
          Owner only. F&amp;B catalog used by the POS DSR upload and the
          per-item editor in the legacy console.
        </p>
      </div>
      <MenuItemsSection />
    </div>
  );
}
