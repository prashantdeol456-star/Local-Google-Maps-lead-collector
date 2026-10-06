import { CollectorPage } from "./pages/CollectorPage";
import { LoginPage } from "./pages/LoginPage";
import { backendClient, useBackendStatus } from "./services/backendClient";

export function App() {
  const { status, setStatus, refresh } = useBackendStatus();

  if (!status) return <div className="loading">Loading…</div>;

  if (!status.loggedIn) return <LoginPage status={status} onLoggedIn={setStatus} onRetry={refresh} />;

  async function logout() {
    const res = await backendClient.logout();
    if (res.ok) setStatus(res.data);
  }

  return <CollectorPage backendStatus={status} onLogout={logout} onRetry={refresh} />;
}
