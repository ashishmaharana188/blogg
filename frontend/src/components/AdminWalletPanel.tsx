import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWallet.css";

type WalletTransaction = {
  eventKey: string;
  type: "funding" | "expense" | "income" | "settlement" | "savings-adjustment";
  description: string;
  amountPaise: number;
  walletDeltaPaise: number;
  savingsDeltaPaise: number;
  cycleId: string | null;
  createdAt: string;
};

type WalletCycle = {
  cycleId: string;
  startedAt: string;
  scheduledEndAt: string | null;
  closedAt: string | null;
  fundingPaise: number;
  netPnlPaise: number;
  savingsTransferPaise: number | null;
  entryCount: number;
  status: "open" | "closed";
};

type WalletData = {
  autoFundingEnabled: boolean;
  fundingAmountPaise: number;
  intervalDays: 30 | 31;
  nextFundingAt: string | null;
  currentCycleId: string | null;
  currentCycleStartAt: string | null;
  walletBalancePaise: number;
  netPnlPaise: number;
  savingsBalancePaise: number;
  updatedAt: string;
  recentTransactions: WalletTransaction[];
  recentCycles: WalletCycle[];
};

function money(paise: number, showSign = false): string {
  const absolute = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(paise) / 100);
  if (showSign && paise > 0) return `+${absolute}`;
  if (paise < 0) return `−${absolute}`;
  return absolute;
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not scheduled"
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

function longDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

async function walletRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
    throw new Error(
      payload.message || `Wallet request failed (${response.status}).`,
    );
  return payload;
}

export default function AdminWalletPanel() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundingAmount, setFundingAmount] = useState("1000");
  const [intervalDays, setIntervalDays] = useState<30 | 31>(30);
  const [autoFundingEnabled, setAutoFundingEnabled] = useState(false);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [settling, setSettling] = useState(false);
  const [savingsTarget, setSavingsTarget] = useState("");
  const [savingsReason, setSavingsReason] = useState("Manual savings adjustment");
  const [adjustingSavings, setAdjustingSavings] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCycles, setShowCycles] = useState(false);
  const [editingEventKey, setEditingEventKey] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [updatingTransaction, setUpdatingTransaction] = useState(false);
  const [removingTransactionKey, setRemovingTransactionKey] = useState<
    string | null
  >(null);

  const isAdminAccountView =
    location.pathname.replace(/\/+$/, "") === "/account" &&
    new URLSearchParams(location.search).get("view") !== "public";

  useEffect(() => {
    if (!isAdmin || !isAdminAccountView) {
      setMountNode(null);
      return;
    }

    let mount: HTMLDivElement | null = null;
    let anchor: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed || mount) return Boolean(mount);

      const youtubeColumn = document.querySelector<HTMLElement>(
        ".account-dashboard-youtube-column",
      );
      const youtubePanel = youtubeColumn?.querySelector<HTMLElement>(
        ":scope > .account-dashboard-youtube",
      );
      if (!youtubeColumn || !youtubePanel) return false;

      // Health's placement bootstrap keeps its Steps/Daily Activity host
      // immediately before the first direct-child .account-dashboard-featured-card-list.
      // This dedicated marker reserves that slot; Wallet sits after it, so
      // neither bootstrap has to move the other's element.
      anchor = youtubeColumn.querySelector<HTMLDivElement>(
        ":scope > .admin-wallet-health-anchor",
      );
      if (!anchor) {
        anchor = document.createElement("div");
        anchor.className =
          "admin-wallet-health-anchor account-dashboard-featured-card-list";
        anchor.setAttribute("aria-hidden", "true");
        anchor.style.setProperty("display", "none", "important");
        youtubePanel.insertAdjacentElement("afterend", anchor);
      }

      mount = document.createElement("div");
      mount.className = "admin-wallet-panel-mount";
      anchor.insertAdjacentElement("afterend", mount);
      setMountNode(mount);
      observer?.disconnect();
      return true;
    };

    if (!tryAttach()) {
      // The observer exists only until the Account dashboard columns render.
      observer = new MutationObserver(() => tryAttach());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      mount?.remove();
      anchor?.remove();
      setMountNode((current) => (current === mount ? null : current));
    };
  }, [isAdmin, isAdminAccountView]);

  const refreshWallet = useCallback(async () => {
    setError("");
    try {
      const data = await walletRequest<WalletData>("/api/admin/wallet");
      setWallet(data);
      setSavingsTarget((data.savingsBalancePaise / 100).toFixed(2));
      setFundingAmount((data.fundingAmountPaise / 100).toFixed(2));
      setIntervalDays(data.intervalDays);
      setAutoFundingEnabled(data.autoFundingEnabled);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load the wallet.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mountNode && isAdmin) {
      setLoading(true);
      void refreshWallet();
    }
  }, [mountNode, isAdmin, refreshWallet]);

  const parsedFundingPaise = useMemo(() => {
    const parsed = Number(fundingAmount);
    return Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * 100)
      : Number.NaN;
  }, [fundingAmount]);

  const saveSettings = async (enabled = autoFundingEnabled) => {
    if (!Number.isSafeInteger(parsedFundingPaise) || parsedFundingPaise < 0) {
      setError("Enter a valid non-negative funding amount.");
      return;
    }
    if (enabled && parsedFundingPaise <= 0) {
      setError(
        "Set a funding amount greater than zero before enabling auto funding.",
      );
      return;
    }

    setSavingSettings(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>(
        "/api/admin/wallet/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            autoFundingEnabled: enabled,
            fundingAmountPaise: parsedFundingPaise,
            intervalDays,
          }),
        },
      );
      setWallet(data);
      setAutoFundingEnabled(data.autoFundingEnabled);
      setFundingAmount((data.fundingAmountPaise / 100).toFixed(2));
      setIntervalDays(data.intervalDays);
      setMessage(
        enabled
          ? "Wallet funding settings saved. First activation funds the wallet immediately."
          : "Automatic funding paused. The current wallet and history are preserved.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save wallet settings.",
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(entryAmount);
    if (!Number.isFinite(parsed) || parsed === 0) {
      setError("Enter a non-zero amount. Use a negative value for an expense.");
      return;
    }
    const amountPaise = Math.round(parsed * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise === 0) {
      setError("Enter a valid amount with up to two decimal places.");
      return;
    }
    if (!entryDescription.trim()) {
      setError("Enter a description for this transaction.");
      return;
    }

    setSavingEntry(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>(
        "/api/admin/wallet/entries",
        {
          method: "POST",
          body: JSON.stringify({
            amountPaise,
            description: entryDescription.trim(),
          }),
        },
      );
      setWallet(data);
      setEntryAmount("");
      setEntryDescription("");
      setMessage("Wallet transaction recorded.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not record the transaction.",
      );
    } finally {
      setSavingEntry(false);
    }
  };

  const beginEditTransaction = (transaction: WalletTransaction) => {
    if (transaction.type === "settlement") return;
    setEditingEventKey(transaction.eventKey);
    setEditingAmount((transaction.walletDeltaPaise / 100).toFixed(2));
    setError("");
    setMessage("");
  };

  const updateTransactionAmount = async (transaction: WalletTransaction) => {
    const parsed = Number(editingAmount);
    const amountPaise = Math.round(parsed * 100);
    if (
      !Number.isFinite(parsed) ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise === 0
    ) {
      setError("Enter a non-zero amount with up to two decimal places.");
      return;
    }
    if (transaction.type === "expense" && amountPaise >= 0) {
      setError("Expense amounts must remain negative. Use a minus sign.");
      return;
    }
    if (
      (transaction.type === "income" || transaction.type === "funding") &&
      amountPaise <= 0
    ) {
      setError("Income and funding amounts must remain positive.");
      return;
    }

    setUpdatingTransaction(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>(
        `/api/admin/wallet/transactions/${encodeURIComponent(transaction.eventKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ amountPaise }),
        },
      );
      setWallet(data);
      setEditingEventKey(null);
      setEditingAmount("");
      setMessage(
        "Transaction amount updated. Wallet, cycle P&L and any linked Savings transfer were recalculated.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the transaction amount.",
      );
    } finally {
      setUpdatingTransaction(false);
    }
  };

  const removeTransaction = async (transaction: WalletTransaction) => {
    if (transaction.type === "settlement") return;
    const confirmed = window.confirm(
      `Remove this ${transaction.type} transaction?\n\n${transaction.description}\n${money(transaction.walletDeltaPaise, true)}\n\nThe cycle balance and any linked Savings transfer will be recalculated.`,
    );
    if (!confirmed) return;

    setRemovingTransactionKey(transaction.eventKey);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>(
        `/api/admin/wallet/transactions/${encodeURIComponent(transaction.eventKey)}`,
        { method: "DELETE" },
      );
      setWallet(data);
      if (editingEventKey === transaction.eventKey) {
        setEditingEventKey(null);
        setEditingAmount("");
      }
      setMessage(
        "Transaction removed. Wallet, cycle P&L and any linked Savings transfer were recalculated.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not remove the transaction.",
      );
    } finally {
      setRemovingTransactionKey(null);
    }
  };

  const adjustSavings = async (resetToZero = false) => {
    const parsed = resetToZero ? 0 : Number(savingsTarget);
    const savingsBalancePaise = Math.round(parsed * 100);
    if (!Number.isFinite(parsed) || !Number.isSafeInteger(savingsBalancePaise)) {
      setError("Enter a valid Savings balance with up to two decimal places.");
      return;
    }

    const current = wallet?.savingsBalancePaise || 0;
    const confirmed = window.confirm(
      `Set Savings from ${money(current)} to ${money(savingsBalancePaise)}? This creates an adjustment record and leaves completed wallet cycles unchanged.`,
    );
    if (!confirmed) return;

    setAdjustingSavings(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>("/api/admin/wallet/savings", {
        method: "PATCH",
        body: JSON.stringify({
          savingsBalancePaise,
          description: savingsReason.trim() || "Manual Savings balance adjustment",
        }),
      });
      setWallet(data);
      setSavingsTarget((data.savingsBalancePaise / 100).toFixed(2));
      setMessage("Savings balance updated. The adjustment is visible in transaction history.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the Savings balance.",
      );
    } finally {
      setAdjustingSavings(false);
    }
  };

  const settleWallet = async () => {
    if (!wallet?.currentCycleId) {
      setError("There is no open wallet cycle to settle.");
      return;
    }
    const confirmed = window.confirm(
      `Transfer the current wallet balance of ${money(wallet.walletBalancePaise)} to Savings and close this cycle?`,
    );
    if (!confirmed) return;

    setSettling(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>("/api/admin/wallet/settle", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setWallet(data);
      setMessage("Current cycle transferred to Savings.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not settle the wallet.",
      );
    } finally {
      setSettling(false);
    }
  };

  if (!isAdmin || !mountNode) return null;

  return createPortal(
    <section
      className="admin-wallet-panel"
      aria-labelledby="admin-wallet-title"
    >
      <header className="admin-wallet-panel__header">
        <div>
          <h2 id="admin-wallet-title">Wallet</h2>
          <p>Current cycle ledger and accumulated savings.</p>
        </div>
        <span
          className={`admin-wallet-status${autoFundingEnabled ? " is-on" : ""}`}
        >
          {autoFundingEnabled ? "Auto funding on" : "Auto funding off"}
        </span>
      </header>

      {loading ? (
        <p className="admin-wallet-feedback">Loading wallet…</p>
      ) : (
        <>
          <div className="admin-wallet-summary-grid">
            <div className="admin-wallet-metric">
              <span>Current wallet</span>
              <strong>{money(wallet?.walletBalancePaise || 0)}</strong>
              <small>Available balance this cycle</small>
            </div>
            <div className="admin-wallet-metric">
              <span>Net P&amp;L</span>
              <strong
                className={
                  (wallet?.netPnlPaise || 0) < 0 ? "is-negative" : "is-positive"
                }
              >
                {money(wallet?.netPnlPaise || 0)}
              </strong>
              <small>Current cycle result</small>
            </div>
            <div className="admin-wallet-metric">
              <span>Total savings</span>
              <strong
                className={
                  (wallet?.savingsBalancePaise || 0) < 0
                    ? "is-negative"
                    : "is-positive"
                }
              >
                {money(wallet?.savingsBalancePaise || 0)}
              </strong>
              <small>Completed cycle transfers</small>
            </div>
            <div className="admin-wallet-metric">
              <span>Next funding</span>
              <strong className="admin-wallet-date">
                {shortDate(wallet?.nextFundingAt)}
              </strong>
              <small>
                {wallet?.currentCycleStartAt
                  ? `Cycle began ${shortDate(wallet.currentCycleStartAt)}`
                  : "No open cycle"}
              </small>
            </div>
          </div>

          <section
            className="admin-wallet-section"
            aria-label="Savings balance controls"
          >
            <div className="admin-wallet-section-heading admin-wallet-section-heading--single">
              <div><h3>Adjust Savings balance</h3></div>
            </div>
            <div className="admin-wallet-savings-fields">
              <label>
                <span>Set Savings to (₹)</span>
                <input
                  type="number"
                  step="0.01"
                  value={savingsTarget}
                  onChange={(event) => setSavingsTarget(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className="admin-wallet-savings-reason">
                <span>Reason (optional)</span>
                <input
                  type="text"
                  maxLength={240}
                  value={savingsReason}
                  onChange={(event) => setSavingsReason(event.target.value)}
                  placeholder="Manual balance correction"
                />
              </label>
              <div className="admin-wallet-savings-actions">
                <button
                  type="button"
                  className="admin-wallet-button"
                  disabled={adjustingSavings}
                  onClick={() => void adjustSavings(false)}
                >
                  {adjustingSavings ? "Updating…" : "Set value"}
                </button>
                <button
                  type="button"
                  className="admin-wallet-button admin-wallet-button--secondary"
                  disabled={adjustingSavings || wallet?.savingsBalancePaise === 0}
                  onClick={() => void adjustSavings(true)}
                >
                  Reset to ₹0
                </button>
              </div>
            </div>
            <p className="admin-wallet-note">
              This changes Savings only. The adjustment is recorded in transaction history and does not rewrite completed wallet cycles.
            </p>
          </section>

          <section
            className="admin-wallet-section"
            aria-label="Automatic funding settings"
          >
            <div className="admin-wallet-section-heading">
              <div>
                <h3>Automatic funding</h3>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoFundingEnabled}
                aria-label="Toggle automatic wallet funding"
                className={`admin-wallet-switch${autoFundingEnabled ? " is-on" : ""}`}
                disabled={savingSettings}
                onClick={() => void saveSettings(!autoFundingEnabled)}
              >
                <span />
              </button>
            </div>
            <div className="admin-wallet-settings-fields">
              <label>
                <span>Funding amount (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fundingAmount}
                  onChange={(event) => setFundingAmount(event.target.value)}
                  placeholder="1000.00"
                />
              </label>
              <label>
                <span>Funding interval</span>
                <select
                  value={intervalDays}
                  onChange={(event) =>
                    setIntervalDays(Number(event.target.value) as 30 | 31)
                  }
                >
                  <option value={30}>Every 30 days</option>
                  <option value={31}>Every 31 days</option>
                </select>
              </label>
              <button
                type="button"
                className="admin-wallet-button admin-wallet-button--secondary"
                disabled={savingSettings}
                onClick={() => void saveSettings()}
              >
                {savingSettings ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </section>

          <section
            className="admin-wallet-section"
            aria-label="Record a wallet transaction"
          >
            <div className="admin-wallet-section-heading admin-wallet-section-heading--single">
              <div>
                <h3>Record transaction</h3>
              </div>
            </div>
            <form
              className="admin-wallet-entry-form"
              onSubmit={(event) => void addEntry(event)}
            >
              <label>
                <span>Amount (₹)</span>
                <input
                  type="number"
                  step="0.01"
                  value={entryAmount}
                  onChange={(event) => setEntryAmount(event.target.value)}
                  placeholder="-250.00 or 500.00"
                  required
                />
              </label>
              <label className="admin-wallet-entry-description">
                <span>Description</span>
                <input
                  type="text"
                  maxLength={240}
                  value={entryDescription}
                  onChange={(event) => setEntryDescription(event.target.value)}
                  placeholder="What was this transaction for?"
                  required
                />
              </label>
              <button
                type="submit"
                className="admin-wallet-button"
                disabled={savingEntry}
              >
                {savingEntry ? "Recording…" : "Add transaction"}
              </button>
            </form>
          </section>

          <section
            className="admin-wallet-section"
            aria-label="Wallet transaction history"
          >
            <div className="admin-wallet-section-heading">
              <div>
                <h3>Transaction history</h3>
              </div>
              <div className="admin-wallet-history-heading-actions">
                <button
                  type="button"
                  className="admin-wallet-button admin-wallet-button--secondary"
                  disabled={settling || !wallet?.currentCycleId}
                  onClick={() => void settleWallet()}
                >
                  {settling ? "Transferring…" : "Transfer to Savings"}
                </button>
              </div>
            </div>

            {wallet?.recentTransactions.length ? (
              <div className="admin-wallet-history-list">
                {wallet.recentTransactions.map((transaction) => {
                  const isEditing = editingEventKey === transaction.eventKey;
                  const isRemoving =
                    removingTransactionKey === transaction.eventKey;
                  const isSystemSettlement = transaction.type === "settlement" || transaction.type === "savings-adjustment";
                  const displayedAmountPaise = transaction.type === "savings-adjustment"
                    ? transaction.savingsDeltaPaise
                    : transaction.walletDeltaPaise;
                  return (
                    <article
                      className="admin-wallet-history-row"
                      key={transaction.eventKey}
                    >
                      <div className="admin-wallet-history-copy">
                        <strong>{transaction.description}</strong>
                        <span>
                          {longDate(transaction.createdAt)} · {transaction.type}
                        </span>
                        {transaction.savingsDeltaPaise !== 0 && (
                          <small>
                            Savings{" "}
                            {transaction.savingsDeltaPaise > 0 ? "+" : "−"}
                            {money(Math.abs(transaction.savingsDeltaPaise))}
                          </small>
                        )}
                      </div>

                      <div className="admin-wallet-history-value">
                        {isEditing ? (
                          <form
                            className="admin-wallet-history-edit-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void updateTransactionAmount(transaction);
                            }}
                          >
                            <label>
                              <span>Signed amount (₹)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={editingAmount}
                                onChange={(event) =>
                                  setEditingAmount(event.target.value)
                                }
                                autoFocus
                                required
                              />
                            </label>
                            <div className="admin-wallet-history-actions">
                              <button
                                type="submit"
                                className="admin-wallet-history-action is-save"
                                disabled={updatingTransaction}
                                aria-label={
                                  updatingTransaction
                                    ? "Saving amount"
                                    : "Save amount"
                                }
                                title={
                                  updatingTransaction
                                    ? "Saving amount"
                                    : "Save amount"
                                }
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 12.5 9.5 17 19 7.5" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="admin-wallet-history-action"
                                disabled={updatingTransaction}
                                onClick={() => {
                                  setEditingEventKey(null);
                                  setEditingAmount("");
                                }}
                                aria-label="Cancel editing"
                                title="Cancel editing"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m7 7 10 10M17 7 7 17" />
                                </svg>
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <strong
                              className={
                                displayedAmountPaise > 0
                                  ? "is-positive"
                                  : displayedAmountPaise < 0
                                    ? "is-negative"
                                    : ""
                              }
                            >
                              {money(transaction.walletDeltaPaise, true)}
                            </strong>
                            {isSystemSettlement ? (
                              <small className="admin-wallet-history-system-label">
                                Linked Savings transfer
                              </small>
                            ) : (
                              <div className="admin-wallet-history-actions">
                                <button
                                  type="button"
                                  className="admin-wallet-history-action"
                                  disabled={
                                    Boolean(removingTransactionKey) ||
                                    updatingTransaction
                                  }
                                  onClick={() =>
                                    beginEditTransaction(transaction)
                                  }
                                  aria-label="Edit transaction amount"
                                  title="Edit transaction amount"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m15 5 4 4M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="admin-wallet-history-action is-danger"
                                  disabled={
                                    Boolean(removingTransactionKey) ||
                                    updatingTransaction ||
                                    isRemoving
                                  }
                                  onClick={() =>
                                    void removeTransaction(transaction)
                                  }
                                  aria-label={
                                    isRemoving
                                      ? "Removing transaction"
                                      : "Delete transaction"
                                  }
                                  title={
                                    isRemoving
                                      ? "Removing transaction"
                                      : "Delete transaction"
                                  }
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="admin-wallet-empty">
                No wallet transactions have been recorded yet.
              </p>
            )}
          </section>

          <section className="admin-wallet-section admin-wallet-cycle-section">
            <button
              type="button"
              className="admin-wallet-cycle-toggle"
              aria-expanded={showCycles}
              onClick={() => setShowCycles((value) => !value)}
            >
              <span>
                <strong>Completed cycles</strong>
                <small>
                  {wallet?.recentCycles.length || 0} recent settlements
                </small>
              </span>
              <span aria-hidden="true">{showCycles ? "−" : "+"}</span>
            </button>
            {showCycles &&
              (wallet?.recentCycles.length ? (
                <div className="admin-wallet-history-list">
                  {wallet.recentCycles.map((cycle) => (
                    <article
                      className="admin-wallet-history-row"
                      key={cycle.cycleId}
                    >
                      <div className="admin-wallet-history-copy">
                        <strong>
                          {shortDate(cycle.startedAt)} –{" "}
                          {shortDate(cycle.closedAt)}
                        </strong>
                        <span>
                          {cycle.entryCount} manual entries · Funding{" "}
                          {money(cycle.fundingPaise)}
                        </span>
                      </div>
                      <strong
                        className={
                          cycle.savingsTransferPaise !== null &&
                          cycle.savingsTransferPaise < 0
                            ? "is-negative"
                            : "is-positive"
                        }
                      >
                        {money(cycle.savingsTransferPaise || 0, true)}
                      </strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="admin-wallet-empty">
                  Completed cycles will appear here after settlement.
                </p>
              ))}
          </section>
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
