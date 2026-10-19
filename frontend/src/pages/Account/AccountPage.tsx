import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { fetchAdminPresence, updateAdminPresence, type AdminActivity, type AdminPresence } from "../../services/adminStatusService";

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
    <div className="min-h-full overflow-y-auto bg-white px-5 py-8 sm:px-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-5">
          <Link to="/feed" className="text-black hover:font-bold">BLOG FEED</Link>
          <Link to="/blog" className="text-sm text-slate-600 hover:text-black">BLOG PROFILE</Link>
        </div>
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Site account</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Administrator status</h1>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${presence.online ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <span className={`h-2 w-2 rounded-full ${presence.online ? "bg-emerald-500" : "bg-slate-400"}`} />
              {presence.online ? "Online" : "Offline"}
            </span>
            {presence.online && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{presence.activity}</span>}
          </div>
          {isAdmin ? (
            <>
              <p className="mt-5 text-sm text-slate-600">Signed in as the site administrator{user?.email ? ` (${user.email})` : ""}. Public visitors can read the site; only this account can change its content.</p>
              <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="admin-activity">Your current activity</label>
              <select id="admin-activity" value={ACTIVITIES.includes(presence.activity as AdminActivity) ? presence.activity : "Reading"} disabled={busy} onChange={(event) => void changeActivity(event.target.value as AdminActivity)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-600">
                {ACTIVITIES.map((activity) => <option key={activity} value={activity}>{activity}</option>)}
              </select>
              {message && <p className="mt-3 text-sm text-slate-600" role="status">{message}</p>}
              <button type="button" disabled={busy} onClick={() => void handleLogout()} className="mt-6 rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Log out</button>
            </>
          ) : (
            <>
              <p className="mt-5 text-sm leading-6 text-slate-600">The site is public and read-only for visitors. The administrator account is the only account that can create or edit notes, folders, and stacks.</p>
              <Link to="/login" className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black">Administrator login</Link>
            </>
          )}
          {!loading && !isAdmin && <p className="mt-4 text-xs text-slate-400">No public registration is available.</p>}
        </section>
      </div>
    </div>
  );
}
