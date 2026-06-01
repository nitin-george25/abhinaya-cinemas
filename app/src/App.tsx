import { Navigate, Route, Routes } from "react-router-dom";
import { SyncProvider, useSync } from "./lib/hooks/SyncContext";
import { AppShell } from "./components/layout/AppShell";
import { BootingScreen } from "./components/auth/BootingScreen";
import { SignInScreen } from "./components/auth/SignInScreen";
import { Button } from "./components/ui/Button";

import Dashboard from "./pages/Dashboard";
import EntryPage from "./pages/Entry";
import HistoryPage from "./pages/History";
import FBPage from "./pages/FB";
import ActivityPage from "./pages/Activity";
import BackupPage from "./pages/Backup";
import SettingsPage from "./pages/Settings";
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
      return (
        <AppShell role={state.role}>
          <Routes>
            <Route
              path="/"
              element={
                <Navigate
                  to={state.role === "accountant" ? "/history" : "/dashboard"}
                  replace
                />
              }
            />
            {state.role !== "accountant" ? (
              <>
                <Route path="/dashboard"  element={<Dashboard />} />
                <Route path="/entry"      element={<EntryPage />} />
                <Route path="/fb/*"       element={<FBPage />} />
                <Route path="/activity"   element={<ActivityPage />} />
                <Route path="/backup"     element={<BackupPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />
              </>
            ) : null}
            <Route path="/history" element={<HistoryPage />} />
            {/* DCR view is reachable from Entry + History. Accountants
                see it too, since History is their landing tab. */}
            <Route
              path="/dcr/:date/:movieId/:screenId"
              element={<DcrPage />}
            />
            <Route path="*"        element={<NotFound />} />
          </Routes>
        </AppShell>
      );
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
