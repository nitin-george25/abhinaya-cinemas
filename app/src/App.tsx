import { Navigate, Route, Routes } from "react-router-dom";
import { SyncProvider, useSync } from "./lib/hooks/SyncContext";
import { AppShell } from "./components/layout/AppShell";
import { BootingScreen } from "./components/auth/BootingScreen";
import { SignInScreen } from "./components/auth/SignInScreen";
import { Button } from "./components/ui/Button";

import Dashboard from "./pages/Dashboard";
import EntryPage from "./pages/Entry";
import HistoryPage from "./pages/History";
import FBEntryPage from "./pages/fb/Entry";
import FBHistoryPage from "./pages/fb/History";
import FBMenuItemsPage from "./pages/fb/MenuItems";
import ActivityPage from "./pages/Activity";
import BackupPage from "./pages/Backup";
import SettingsMoviesPage from "./pages/settings/Movies";
import SettingsScreensPage from "./pages/settings/Screens";
import SettingsTaxPage from "./pages/settings/Tax";
import SettingsUsersPage from "./pages/settings/Users";
import ReportsBoPage from "./pages/reports/Bo";
import ReportsFbPage from "./pages/reports/Fb";
import DcrPage from "./pages/Dcr";

export default function App() {
  return (
    <SyncProvider>
      <AppGate />
    </SyncProvider>
  );
}

/**
 * Routes the user based on auth status. Mirrors the legacy 02-cloud boot
 * sequence: booting → signed-out → unauthorized → ready.
 */
function AppGate() {
  const { state, signOut } = useSync();

  switch (state.status) {
    case "booting":
      return <BootingScreen label="Checking sign-in…" />;

    case "signed-out":
      return <SignInScreen />;

    case "unauthorized":
      return (
        <SignInScreen
          message={
            state.error ??
            "Your email isn't on the access list yet. Ask the owner to add you."
          }
        />
      );

    case "error":
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink text-white px-6">
          <div className="max-w-sm text-center space-y-4">
            <h1 className="text-xl font-semibold">Could not connect</h1>
            <p className="text-white/60 text-sm">
              {state.error ?? "Check your connection and try again."}
            </p>
            <Button
              variant="secondary"
              onClick={() => location.reload()}
            >
              Retry
            </Button>
            <button
              className="block text-xs text-white/40 underline mt-2 mx-auto"
              onClick={() => { void signOut(); }}
            >
              Sign out
            </button>
          </div>
        </div>
      );

    case "ready":
      if (!state.role) return <SignInScreen />;
      {
        const role = state.role;
        const canEnterBO = role === "owner" || role === "manager" || role === "daily_manager";
        const canDoFB    = canEnterBO; // same set: owner, manager, daily_manager
        const canSeeAdmin = role === "owner" || role === "manager"; // Dashboard, Activity, Backup, Settings
        const canSeeReports = role === "owner" || role === "manager" || role === "accountant";
        const landing =
          role === "accountant"     ? "/box-office/history" :
          role === "daily_manager"  ? "/box-office/entry"   :
                                      "/dashboard";
        return (
          <AppShell role={role}>
            <Routes>
              <Route path="/" element={<Navigate to={landing} replace />} />

              {/* Box Office */}
              <Route
                path="/box-office"
                element={
                  <Navigate
                    to={
                      role === "accountant"
                        ? "/box-office/history"
                        : "/box-office/entry"
                    }
                    replace
                  />
                }
              />
              {canEnterBO ? (
                <Route path="/box-office/entry" element={<EntryPage />} />
              ) : null}
              <Route path="/box-office/history" element={<HistoryPage />} />

              {/* Legacy URL redirects */}
              <Route path="/entry"    element={<Navigate to="/box-office/entry"   replace />} />
              <Route path="/history"  element={<Navigate to="/box-office/history" replace />} />
              <Route path="/fb"       element={<Navigate to="/fb/history"         replace />} />
              <Route path="/settings" element={<Navigate to="/settings/movies"    replace />} />

              {/* F&B — owner, manager, daily_manager */}
              {canDoFB ? (
                <>
                  <Route path="/fb/entry"   element={<FBEntryPage />} />
                  <Route path="/fb/history" element={<FBHistoryPage />} />
                </>
              ) : null}
              {role === "owner" ? (
                <Route path="/fb/menu-items" element={<FBMenuItemsPage />} />
              ) : null}

              {/* Reports — owner, manager, accountant */}
              {canSeeReports ? (
                <>
                  <Route path="/reports"             element={<Navigate to="/reports/fb" replace />} />
                  <Route path="/reports/box-office"  element={<ReportsBoPage />} />
                  <Route path="/reports/fb"          element={<ReportsFbPage />} />
                </>
              ) : null}

              {/* Admin-only: Dashboard, Activity, Backup, Settings */}
              {canSeeAdmin ? (
                <>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/activity"  element={<ActivityPage />} />
                  <Route path="/backup"    element={<BackupPage />} />
                  <Route path="/settings/movies"  element={<SettingsMoviesPage />} />
                  <Route path="/settings/screens" element={<SettingsScreensPage />} />
                  <Route path="/settings/tax"     element={<SettingsTaxPage />} />
                  {role === "owner" ? (
                    <Route path="/settings/users" element={<SettingsUsersPage />} />
                  ) : null}
                </>
              ) : null}

              {/* DCR view is reachable from Entry + History. Accountants
                  see it too, since History is their landing tab. */}
              <Route
                path="/dcr/:date/:movieId/:screenId"
                element={<DcrPage />}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        );
      }
  }
}

function NotFound() {
  return (
    <div className="max-w-md py-16 text-center mx-auto">
      <p className="text-ink-muted text-sm">No such page.</p>
      <a className="text-amber-600 underline text-sm mt-2 inline-block" href="/admin/dcr/">
        Back to home
      </a>
    </div>
  );
}
