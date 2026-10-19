import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { fetchAdminPresence, updateAdminPresence, type AdminActivity, type AdminPresence } from "../../services/adminStatusService";
import "./accountPage.css";

const ACTIVITIES: AdminActivity[] = ["Writing", "Reading", "Editing"];

export default function AccountPage() {
  const navigate = useNavigate();
  const { user, isAdmin, loading, logout, refreshUser } = useAuth();
  const [presence, setPresence] = useState<AdminPresence>({ online: false, activity: "Offline", lastSeen: null });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setPresence(await fetchAdminPresence()); } catch { /* Status is informational; don't break the account page. */ }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void updateAdminPresence().then(refresh).catch(() => { void refreshUser(); void refresh(); });
    } else {
      void refresh();
    }
    const pollId = window.setInterval(() => { void refresh(); }, 20_000);
    const heartbeatId = isAdmin
      ? window.setInterval(() => { void updateAdminPresence().catch(() => refreshUser()); }, 30_000)
      : null;
    return () => {
      window.clearInterval(pollId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
    };
  }, [refresh, refreshUser, isAdmin]);

  const changeActivity = async (activity: AdminActivity) => {
    setBusy(true);
    setMessage("");
    try {
      await updateAdminPresence({ activity });
      await refresh();
      setMessage(`Activity set to ${activity}.`);
    } catch {
      setMessage("Could not update activity. Check your admin session.");
    } finally { setBusy(false); }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await updateAdminPresence({ online: false }).catch(() => undefined);
      await logout();
      navigate("/feed", { replace: true });
    } finally { setBusy(false); }
  };

  return (
    <div className="account-page typewriter-font">
      <div className="account-page-shell">
        <header className="account-page-header">
          <Link to="/feed" className="account-page-nav-link">BLOG FEED</Link>
          <span className="account-page-rule" aria-hidden="true" />
          <Link to="/blog" className="account-page-nav-link">BLOG PROFILE</Link>
        </header>

        <main className="account-page-main">
          <section className="account-status-card" aria-labelledby="account-status-heading">
            <p className="account-eyebrow">SITE ACCOUNT</p>
            <h1 id="account-status-heading" className="account-status-title">Administrator status</h1>

            <div className="account-presence-row" aria-live="polite">
              <span className={`account-presence-pill ${presence.online ? "is-online" : "is-offline"}`}>
                <span className="account-presence-dot" />
                {presence.online ? "Online" : "Offline"}
              </span>
              {presence.online && (
                <span className="account-activity-pill">{presence.activity}</span>
              )}
            </div>

            {isAdmin ? (
              <>
                <p className="account-description">
                  Signed in as the site administrator{user?.email ? ` (${user.email})` : ""}. Public visitors can read the site; only this account can change its content.
                </p>
                <label className="account-field-label" htmlFor="admin-activity">Your current activity</label>
                <select
                  id="admin-activity"
                  value={ACTIVITIES.includes(presence.activity as AdminActivity) ? presence.activity : "Reading"}
                  disabled={busy}
                  onChange={(event) => void changeActivity(event.target.value as AdminActivity)}
                  className="account-activity-select"
                >
                  {ACTIVITIES.map((activity) => <option key={activity} value={activity}>{activity}</option>)}
                </select>
                {message && <p className="account-message" role="status">{message}</p>}
                <div className="account-card-footer">
                  <button type="button" disabled={busy} onClick={() => void handleLogout()} className="account-secondary-button">
                    {busy ? "Please wait…" : "Log out"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="account-description">
                  The site is public and read-only for visitors. The administrator account is the only account that can create or edit notes, folders, and stacks.
                </p>
                <div className="account-card-footer">
                  <Link to="/login" className="account-primary-link">Administrator login</Link>
                </div>
                {!loading && <p className="account-footnote">No public registration is available.</p>}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
