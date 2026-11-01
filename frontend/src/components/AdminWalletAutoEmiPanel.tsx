import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWalletEnhancements.css";
import "./adminWalletPolish.css";

type EmiMandate = {
  mandateId: string;
  enabled: boolean;
  amountPaise: number;
  dayOfMonth: number;
  description: string;
  nextEmiAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type EmiHistoryEntry = {
  eventKey: string;
  mandateId: string;
  occurrenceMonth: string;
  description: string;
  amountPaise: number;
  createdAt: string | null;
};

type EmiPayload = {
  mandates: EmiMandate[];
  history: EmiHistoryEntry[];
};

const EMPTY_PAYLOAD: EmiPayload = { mandates: [], history: [] };

function formatMoney(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(paise) / 100);
}

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
  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

export default function AdminWalletAutoEmiPanel() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [payload, setPayload] = useState<EmiPayload>(EMPTY_PAYLOAD);
  const [amount, setAmount] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState(5);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyMandateId, setBusyMandateId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDay, setEditDay] = useState(5);
  const [editDescription, setEditDescription] = useState("");
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

  const refresh = async () => {
    const data = await request<EmiPayload>("/api/admin/wallet/emi");
    setPayload(data);
    return data;
  };

  useEffect(() => {
    if (!mountNode || !isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    request<EmiPayload>("/api/admin/wallet/emi")
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the EMI mandates.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mountNode, isAdmin]);

  const createMandate = async () => {
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
      setError("Enter a name for this EMI mandate.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await request<EmiPayload>("/api/admin/wallet/emi", {
        method: "POST",
        body: JSON.stringify({
          amountPaise,
          dayOfMonth,
          description: description.trim(),
          enabled: true,
        }),
      });
      setPayload(data);
      setAmount("");
      setDescription("");
      setDayOfMonth(5);
      setMessage(
        "EMI mandate created. Its first debit is scheduled for the next occurrence.",
      );
      window.dispatchEvent(new Event("admin-wallet-data-updated"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the EMI mandate.",
      );
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (mandate: EmiMandate) => {
    setEditingId(mandate.mandateId);
    setEditAmount((mandate.amountPaise / 100).toFixed(2));
    setEditDay(mandate.dayOfMonth);
    setEditDescription(mandate.description);
    setError("");
    setMessage("");
  };

  const updateMandate = async (mandateId: string) => {
    const parsedAmount = Number(editAmount);
    const amountPaise = Math.round(parsedAmount * 100);
    if (
      !Number.isFinite(parsedAmount) ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0
    ) {
      setError("Enter a valid positive EMI amount.");
      return;
    }
    if (!editDescription.trim()) {
      setError("Enter a name for this EMI mandate.");
      return;
    }

    setBusyMandateId(mandateId);
    setError("");
    setMessage("");
    try {
      const data = await request<EmiPayload>(
        `/api/admin/wallet/emi/${encodeURIComponent(mandateId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            amountPaise,
            dayOfMonth: editDay,
            description: editDescription.trim(),
          }),
        },
      );
      setPayload(data);
      setEditingId(null);
      setMessage(
        "Mandate updated. Previous monthly debits remain unchanged in history.",
      );
      window.dispatchEvent(new Event("admin-wallet-data-updated"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the EMI mandate.",
      );
    } finally {
      setBusyMandateId(null);
    }
  };

  const toggleMandate = async (mandate: EmiMandate) => {
    setBusyMandateId(mandate.mandateId);
    setError("");
    setMessage("");
    try {
      const data = await request<EmiPayload>(
        `/api/admin/wallet/emi/${encodeURIComponent(mandate.mandateId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !mandate.enabled }),
        },
      );
      setPayload(data);
      setMessage(
        mandate.enabled
          ? "Mandate paused. Existing debit history is preserved."
          : "Mandate resumed. The next debit is scheduled for the next occurrence.",
      );
      window.dispatchEvent(new Event("admin-wallet-data-updated"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not change the mandate status.",
      );
    } finally {
      setBusyMandateId(null);
    }
  };

  const deleteMandate = async (mandate: EmiMandate) => {
    const confirmed = window.confirm(
      `Delete the recurring debit "${mandate.description}"?\n\nFuture debits will stop. Previous monthly debits will remain in wallet history.`,
    );
    if (!confirmed) return;

    setBusyMandateId(mandate.mandateId);
    setError("");
    setMessage("");
    try {
      const data = await request<EmiPayload>(
        `/api/admin/wallet/emi/${encodeURIComponent(mandate.mandateId)}`,
        { method: "DELETE" },
      );
      setPayload(data);
      if (editingId === mandate.mandateId) setEditingId(null);
      setMessage("Mandate deleted. Previous debit records were retained.");
      window.dispatchEvent(new Event("admin-wallet-data-updated"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the EMI mandate.",
      );
    } finally {
      setBusyMandateId(null);
    }
  };

  if (!isAdmin || !mountNode) return null;

  const enabledCount = payload.mandates.filter(
    (mandate) => mandate.enabled,
  ).length;

  return createPortal(
    <section
      className="admin-wallet-section admin-wallet-auto-emi"
      aria-label="Automatic EMI debit mandates"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className="admin-wallet-section-heading">
        <div>
          <h3>Recurring EMI mandates</h3>
        </div>
        <div className="admin-wallet-emi-heading-actions">
          <span className="admin-wallet-emi-count">
            {enabledCount} active · {payload.mandates.length} total
          </span>
          <button
            type="button"
            className="admin-wallet-icon-button"
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? "Expand recurring EMI mandates"
                : "Minimise recurring EMI mandates"
            }
            title={collapsed ? "Expand" : "Minimise"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={collapsed ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6"} />
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {loading ? (
            <p className="admin-wallet-feedback">Loading EMI mandates…</p>
          ) : (
            <>
              {payload.mandates.length > 0 ? (
                <div className="admin-wallet-emi-mandates">
                  {payload.mandates.map((mandate) => {
                    const isEditing = editingId === mandate.mandateId;
                    const isBusy = busyMandateId === mandate.mandateId;
                    return (
                      <article
                        className="admin-wallet-emi-mandate"
                        key={mandate.mandateId}
                      >
                        {isEditing ? (
                          <div className="admin-wallet-emi-edit">
                            <div className="admin-wallet-emi-fields">
                              <label>
                                <span>Monthly amount (₹)</span>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={editAmount}
                                  onChange={(event) =>
                                    setEditAmount(event.target.value)
                                  }
                                />
                              </label>
                              <label>
                                <span>Debit day</span>
                                <select
                                  value={editDay}
                                  onChange={(event) =>
                                    setEditDay(Number(event.target.value))
                                  }
                                >
                                  {Array.from(
                                    { length: 31 },
                                    (_, index) => index + 1,
                                  ).map((day) => (
                                    <option key={day} value={day}>
                                      {ordinal(day)} of each month
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="admin-wallet-emi-description">
                                <span>Mandate description</span>
                                <input
                                  type="text"
                                  maxLength={120}
                                  value={editDescription}
                                  onChange={(event) =>
                                    setEditDescription(event.target.value)
                                  }
                                />
                              </label>
                            </div>
                            <div className="admin-wallet-emi-actions">
                              <button
                                type="button"
                                className="admin-wallet-icon-button is-save"
                                disabled={isBusy}
                                onClick={() =>
                                  void updateMandate(mandate.mandateId)
                                }
                                aria-label="Save mandate changes"
                                title="Save changes"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 12.5 9.5 17 19 7.5" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="admin-wallet-icon-button"
                                disabled={isBusy}
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel mandate editing"
                                title="Cancel"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m7 7 10 10M17 7 7 17" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="admin-wallet-emi-mandate-main">
                              <div className="admin-wallet-emi-mandate-title">
                                <strong>{mandate.description}</strong>
                                <span
                                  className={`admin-wallet-emi-mandate-status ${mandate.enabled ? "is-enabled" : "is-paused"}`}
                                >
                                  {mandate.enabled ? "Active" : "Paused"}
                                </span>
                              </div>
                              <div className="admin-wallet-emi-mandate-meta">
                                <strong>
                                  {formatMoney(mandate.amountPaise)} / month
                                </strong>
                                <span>
                                  Debit on the {ordinal(mandate.dayOfMonth)}
                                </span>
                                <span>
                                  Next: {formatDate(mandate.nextEmiAt)}
                                </span>
                              </div>
                            </div>
                            <div className="admin-wallet-emi-actions">
                              <button
                                type="button"
                                className="admin-wallet-icon-button"
                                disabled={isBusy}
                                onClick={() => beginEdit(mandate)}
                                aria-label={`Edit ${mandate.description}`}
                                title="Edit mandate"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m15 5 4 4M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="admin-wallet-icon-button"
                                disabled={isBusy}
                                onClick={() => void toggleMandate(mandate)}
                                aria-label={
                                  mandate.enabled
                                    ? `Pause ${mandate.description}`
                                    : `Resume ${mandate.description}`
                                }
                                title={
                                  mandate.enabled
                                    ? "Pause mandate"
                                    : "Resume mandate"
                                }
                              >
                                {mandate.enabled ? (
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M8 5v14M16 5v14" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m8 5 11 7-11 7V5Z" />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                className="admin-wallet-icon-button is-danger"
                                disabled={isBusy}
                                onClick={() => void deleteMandate(mandate)}
                                aria-label={`Delete ${mandate.description}`}
                                title="Delete mandate"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
                                </svg>
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="admin-wallet-empty">
                  No EMI mandates yet. Add one below to track monthly wallet
                  debits.
                </p>
              )}

              <div className="admin-wallet-emi-create">
                <div className="admin-wallet-section-heading admin-wallet-section-heading--single">
                  <div>
                    <h4>Add EMI mandate</h4>
                  </div>
                </div>
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
                    <span>Debit day</span>
                    <select
                      value={dayOfMonth}
                      onChange={(event) =>
                        setDayOfMonth(Number(event.target.value))
                      }
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
                    <span>Mandate description</span>
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
                    className="admin-wallet-button"
                    disabled={saving}
                    onClick={() => void createMandate()}
                  >
                    {saving ? "Adding…" : "Add mandate"}
                  </button>
                </div>
              </div>

              <div className="admin-wallet-emi-history">
                <button
                  type="button"
                  className="admin-wallet-emi-history-toggle"
                  aria-expanded={showHistory}
                  onClick={() => setShowHistory((value) => !value)}
                >
                  <span className="admin-wallet-emi-history-label">
                    <strong>Debit history</strong>
                    <small>
                      {payload.history.length} recorded monthly debits
                    </small>
                  </span>
                  <span
                    className="admin-wallet-emi-history-chevron"
                    aria-hidden="true"
                  >
                    {showHistory ? "⌃" : "⌄"}
                  </span>
                </button>
                {showHistory &&
                  (payload.history.length > 0 ? (
                    <div className="admin-wallet-emi-history-list">
                      {payload.history.map((entry) => (
                        <article
                          className="admin-wallet-history-row"
                          key={entry.eventKey}
                        >
                          <div className="admin-wallet-history-copy">
                            <strong>{entry.description}</strong>
                            <span>
                              {entry.occurrenceMonth} ·{" "}
                              {formatDate(entry.createdAt)}
                            </span>
                          </div>
                          <strong className="is-negative">
                            −{formatMoney(entry.amountPaise)}
                          </strong>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="admin-wallet-empty">
                      Monthly debit records will appear here after the first
                      scheduled occurrence.
                    </p>
                  ))}
              </div>
            </>
          )}
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
