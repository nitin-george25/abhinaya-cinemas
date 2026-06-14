import { Navigate, Route, Routes } from "react-router-dom";
import { SyncProvider, useSync } from "./lib/hooks/SyncContext";
import { AppShell } from "./components/layout/AppShell";
import { BootingScreen } from "./components/auth/BootingScreen";
import { ChangePinScreen } from "./components/auth/ChangePinScreen";
import { SignInScreen } from "./components/auth/SignInScreen";
import { Button } from "./components/ui/Button";

import Dashboard from "./pages/Dashboard";
import EntryPage from "./pages/Entry";
import HistoryPage from "./pages/History";
import FBEntryPage from "./pages/fb/Entry";
import FBHistoryPage from "./pages/fb/History";
import FBChecklistPage from "./pages/fb/Checklist";
import FBMenuItemsPage from "./pages/fb/MenuItems";
import ActivityPage from "./pages/Activity";
import BackupPage from "./pages/Backup";
import SettingsMoviesPage from "./pages/settings/Movies";
import SettingsScreensPage from "./pages/settings/Screens";
import SettingsTaxPage from "./pages/settings/Tax";
import SettingsUsersPage from "./pages/settings/Users";
import SettingsCashPage from "./pages/settings/Cash";
import SettingsWhatsappPage from "./pages/settings/Whatsapp";
import ReportsBoPage from "./pages/reports/Bo";
import ReportsFbPage from "./pages/reports/Fb";
import DcrPage from "./pages/Dcr";
import CashClosingsPage from "./pages/cash/Closings";
import CashClosingDetailPage from "./pages/cash/ClosingDetail";
import CashPettyPage from "./pages/cash/Petty";
import CashPettyMinePage from "./pages/cash/PettyMine";
import CashPaymentsPage from "./pages/cash/Payments";
import CashSettlementsPage from "./pages/cash/Settlements";
import CashLedgerPage from "./pages/cash/Ledger";
import CashReportsPage from "./pages/cash/Reports";
import RenovationsPage from "./pages/projects/Renovations";
import ProjectDetailPage from "./pages/projects/ProjectDetail";
import DailyManagerRosterPage from "./pages/operations/DailyManagerRoster";

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
  const { state, signOut, dismissSessionExpired } = useSync();

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
      // Forced PIN change — username+PIN users whose PIN was issued by
      // the owner/manager (create or reset) must pick their own before
      // they reach the app. Google users never carry the flag.
      if (state.mustChangePin && state.username) return <ChangePinScreen />;
      {
        const role = state.role;
        const expiredOverlay = state.sessionExpired ? (
          <SessionExpiredDialog onDismiss={() => { void dismissSessionExpired(); }} />
        ) : null;
        const canEnterBO = role === "owner" || role === "manager" || role === "daily_manager";
        const canDoFB    = canEnterBO; // same set: owner, manager, daily_manager
        const canSeeAdmin = role === "owner" || role === "manager"; // Dashboard, Activity, Backup, Settings
        const canSeeReports = role === "owner" || role === "manager" || role === "accountant";
        const canCloseCash = canEnterBO; // owner, manager, daily_manager
        const canApprovePayments = role === "owner" || role === "manager" || role === "accountant";
        const isCashier = role === "cashier";
        const landing =
          isCashier                 ? "/cash/closings"     :
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
                  <Route path="/fb/entry"     element={<FBEntryPage />} />
                  <Route path="/fb/history"   element={<FBHistoryPage />} />
                  {/* Checklist moved to Operations; keep the old URL working. */}
                  <Route path="/fb/checklist" element={<Navigate to="/operations/checklist" replace />} />
                </>
              ) : null}
              {role === "owner" ? (
                <Route path="/fb/menu-items" element={<FBMenuItemsPage />} />
              ) : null}

              {/* Operations — staff rosters + daily SOP checklists.
                  owner, manager, daily_manager (ENTRY_ROLES). Manage/approve
                  rights are gated inside the pages + by RLS. */}
              {canEnterBO ? (
                <>
                  <Route path="/operations" element={<Navigate to="/operations/rosters/daily-managers" replace />} />
                  <Route path="/operations/rosters" element={<Navigate to="/operations/rosters/daily-managers" replace />} />
                  <Route path="/operations/rosters/daily-managers" element={<DailyManagerRosterPage />} />
                  <Route path="/operations/checklist" element={<FBChecklistPage />} />
                </>
              ) : null}

              {/* Reports — owner, manager, accountant */}
              {canSeeReports ? (
                <>
                  <Route path="/reports"             element={<Navigate to="/reports/fb" replace />} />
                  <Route path="/reports/box-office"  element={<ReportsBoPage />} />
                  <Route path="/reports/fb"          element={<ReportsFbPage />} />
                </>
              ) : null}

              {/* Settings · Cash — owner + accountant (manages bank accounts,
                  parties, etc.) Sits OUTSIDE the canSeeAdmin gate so
                  accountants can reach it. */}
              {role === "owner" || role === "accountant" ? (
                <Route path="/settings/cash" element={<SettingsCashPage />} />
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
                  {/* Users page is now owner OR manager. Manager scope is
                      enforced inside the UsersSection + admin-users Edge
                      Function — they can only manage cashier + daily_manager. */}
                  <Route path="/settings/users" element={<SettingsUsersPage />} />
                  {/* WhatsApp settings — owner only. */}
                  {role === "owner" ? (
                    <Route path="/settings/whatsapp" element={<SettingsWhatsappPage />} />
                  ) : null}
                </>
              ) : null}

              {/* Cash management — see role gates below. */}
              {/* "My / new petty expense" — open to anyone who handles
                  on-site cash. Cashiers landed here, but daily managers and
                  owners need to be able to raise the same request from
                  the FAB when they're on the floor. */}
              {(isCashier || canCloseCash) ? (
                <Route path="/cash/petty/mine" element={<CashPettyMinePage />} />
              ) : null}
              {/* /cash/closings is now the unified "Cash Closing" tab —
                  visible to cashiers too so they can confirm closings
                  awaiting their signature. */}
              <Route path="/cash"              element={<Navigate to="/cash/closings" replace />} />
              {/* Legacy redirect: old /cash/today → unified page. */}
              <Route path="/cash/today"        element={<Navigate to="/cash/closings" replace />} />
              <Route path="/cash/closings"     element={<CashClosingsPage />} />
              <Route path="/cash/closings/:id" element={<CashClosingDetailPage />} />
              {/* Petty queue — owner/manager/daily_manager can approve; the
                  page itself adapts to read-only when an accountant opens
                  it (for reconciliation reporting). */}
              {(canCloseCash || role === "accountant") ? (
                <Route path="/cash/petty"      element={<CashPettyPage />} />
              ) : null}
              {canApprovePayments ? (
                <>
                  <Route path="/cash/payments"    element={<CashPaymentsPage />} />
                  <Route path="/cash/settlements" element={<CashSettlementsPage />} />
                  <Route path="/cash/ledger"      element={<CashLedgerPage />} />
                  <Route path="/cash/reports"     element={<CashReportsPage />} />
                </>
              ) : null}

              {/* Project Management — owner, manager, daily_manager. Per-project
                  edit rights are enforced by RLS, not the route gate. */}
              {canEnterBO ? (
                <>
                  <Route path="/projects"             element={<Navigate to="/projects/renovations" replace />} />
                  <Route path="/projects/renovations" element={<RenovationsPage />} />
                  <Route path="/projects/renovations/:id" element={<ProjectDetailPage />} />
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
            {expiredOverlay}
          </AppShell>
        );
      }
  }
}

/**
 * Renders over the current view when the auth session expires mid-session.
 * Until the user clicks OK their work stays on screen — no destructive
 * navigation. Clicking OK signs out cleanly and routes to /sign-in.
 */
function SessionExpiredDialog({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-paper-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Session expired</h2>
          <p className="text-sm text-ink-muted mt-1">
            You've been signed out. Please sign in again to continue.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={onDismiss}>OK</Button>
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="max-w-md py-16 text-center mx-auto">
      <p className="text-ink-muted text-sm">No such page.</p>
      <a className="text-amber-600 underline text-sm mt-2 inline-block" href="/">
        Back to home
      </a>
    </div>
  );
}
