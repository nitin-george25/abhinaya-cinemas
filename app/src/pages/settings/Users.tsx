// Route page: /settings/users — owner-only user management.

import { UsersSection } from "../Settings";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

export default function SettingsUsersPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Users</h2>
        <p className="text-sm text-ink-muted mt-1">
          Owner manages any role; manager manages cashier and daily-manager
          users only. Add users, reset PINs, change roles.
        </p>
      </div>
      <UsersSection />
    </div>
  );
}
