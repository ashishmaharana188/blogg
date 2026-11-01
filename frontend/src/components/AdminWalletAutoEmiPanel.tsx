import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWalletEnhancements.css";

type EmiSettings = {
  enabled: boolean;
  amountPaise: number;
  dayOfMonth: number;
  description: string;
  nextEmiAt: string | null;
};

const DEFAULT_SETTINGS: EmiSettings = {
  enabled: false,
  amountPaise: 0,
  dayOfMonth: 5,
  description: "Monthly EMI",
  nextEmiAt: null,
};

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  }).format(date);
}

function ordinal(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

/**
 * Monthly internal-wallet debit settings. This records an expense in Blogg's
 * wallet ledger; it does not initiate a bank, UPI, or card payment.
 */
export default function AdminWalletAutoEmiPanel() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<EmiSettings>(DEFAULT_SETTINGS);
  const [amount, setAmount] = useState("0.00");
  const [dayOfMonth, setDayOfMonth] = useState(5);
  const [description, setDescription] = useState("Monthly EMI");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const adminAccountView =
    location.pathname.replace(/\/+$/, "") === "/account" &&
    new URLSearchParams(location.search).get("view") !== "public";

  useEffect(() => {
    if (!isAdmin || !adminAccountView) {
      setMountNode(null);
      return;
    }

    let mount: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed || mount) return Boolean(mount);
      const walletPanel = document.querySelector<HTMLElement>(
        ".admin-wallet-panel",
      );
      const fundingSection = walletPanel?.querySelector<HTMLElement>(
        '.admin-wallet-section[aria-label="Automatic funding settings"]',
      );
      if (!walletPanel || !fundingSection) return false;

      mount = document.createElement("div");
      mount.className = "admin-wallet-auto-emi-mount";
      fundingSection.insertAdjacentElement("afterend", mount);
      setMountNode(mount);
      observer?.disconnect();
      return true;
    };

    if (!tryAttach()) {
      observer = new MutationObserver(() => tryAttach());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      mount?.remove();
      setMountNode((current) => (current === mount ? null : current));
    };
  }, [isAdmin, adminAccountView]);

  useEffect(() => {
    if (!mountNode || !isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    request<EmiSettings>("/api/admin/wallet/emi")
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setAmount((data.amountPaise / 100).toFixed(2));
        setDayOfMonth(data.dayOfMonth);
        setDescription(data.description);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the EMI schedule.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mountNode, isAdmin]);

  const save = async () => {
    const parsedAmount = Number(amount);
    const amountPaise = Math.round(parsedAmount * 100);
    if (
      !Number.isFinite(parsedAmount) ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0
    ) {
      setError(
        "Enter an EMI amount greater than zero, with up to two decimal places.",
      );
      return;
    }
    if (!description.trim()) {
      setError("Enter a description for this recurring debit.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await request<EmiSettings>("/api/admin/wallet/emi", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: settings.enabled,
          amountPaise,
          dayOfMonth,
          description: description.trim(),
        }),
      });
      setSettings(data);
      setAmount((data.amountPaise / 100).toFixed(2));
      setDayOfMonth(data.dayOfMonth);
      setDescription(data.description);
      setMessage(
        data.enabled
          ? `Monthly wallet debit saved. Next debit: ${formatDate(data.nextEmiAt)}.`
          : "Automatic EMI debit is paused. Existing wallet history is unchanged.",
      );
      window.dispatchEvent(new Event("admin-wallet-data-updated"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the EMI schedule.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = () => {
    setSettings((current) => ({ ...current, enabled: !current.enabled }));
    setMessage("");
    setError("");
  };

  if (!isAdmin || !mountNode) return null;

  return createPortal(
    <section
      className="admin-wallet-section admin-wallet-auto-emi"
      aria-label="Automatic EMI debit"
    >
      <div className="admin-wallet-section-heading">
        <div>
          <h3>Automatic EMI debit</h3>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Enable automatic EMI wallet debit"
          aria-checked={settings.enabled}
          className={`admin-wallet-switch${settings.enabled ? " is-on" : ""}`}
          disabled={loading || saving}
          onClick={toggleEnabled}
        >
          <span />
        </button>
      </div>

      {loading ? (
        <p className="admin-wallet-feedback">Loading EMI schedule…</p>
      ) : (
        <>
          <div className="admin-wallet-emi-fields">
            <label>
              <span>Monthly amount (₹)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="2500.00"
              />
            </label>
            <label>
              <span>Deduct on day</span>
              <select
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(Number(event.target.value))}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map(
                  (day) => (
                    <option key={day} value={day}>
                      {ordinal(day)} of each month
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="admin-wallet-emi-description">
              <span>Description</span>
              <input
                type="text"
                maxLength={120}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Motorcycle EMI"
              />
            </label>
            <button
              type="button"
              className="admin-wallet-button admin-wallet-button--secondary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save EMI schedule"}
            </button>
          </div>
          <div className="admin-wallet-emi-status">
            <span>
              {settings.enabled
                ? "Monthly debit enabled"
                : "Monthly debit paused"}
            </span>
            <strong>Next debit: {formatDate(settings.nextEmiAt)}</strong>
          </div>
        </>
      )}

      {message && (
        <p className="admin-wallet-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="admin-wallet-error" role="alert">
          {error}
        </p>
      )}
    </section>,
    mountNode,
  );
}
