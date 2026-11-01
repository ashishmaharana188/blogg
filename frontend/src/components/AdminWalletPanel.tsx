import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWallet.css";
import "./adminWalletPolish.css";

type WalletTransaction = {
  eventKey: string;
  type: "funding" | "expense" | "income" | "settlement" | "savings-adjustment";
  description: string;
  amountPaise: number;
  walletDeltaPaise: number;
  savingsDeltaPaise: number;
  cycleId: string | null;
  autoEmiMandateId?: string;
  occurrenceMonth?: string;
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
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function longDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
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
  if (!response.ok) {
    throw new Error(
      payload.message || `Wallet request failed (${response.status}).`,
    );
  }
  return payload;
}

export default function AdminWalletPanel() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundingAmount, setFundingAmount] = useState("1000.00");
  const [intervalDays, setIntervalDays] = useState<30 | 31>(30);
  const [autoFundingEnabled, setAutoFundingEnabled] = useState(false);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [savingsTarget, setSavingsTarget] = useState("0.00");
  const [savingsReason, setSavingsReason] = useState(
    "Manual Savings balance adjustment",
  );
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [adjustingSavings, setAdjustingSavings] = useState(false);
  const [settling, setSettling] = useState(false);
  const [updatingTransaction, setUpdatingTransaction] = useState(false);
  const [removingTransactionKey, setRemovingTransactionKey] = useState<
    string | null
  >(null);
  const [editingEventKey, setEditingEventKey] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [showCycles, setShowCycles] = useState(true);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
    if (!mountNode || !isAdmin) return;
    setLoading(true);
    void refreshWallet();
  }, [mountNode, isAdmin, refreshWallet]);

  const parsedFundingPaise = useMemo(() => {
    const parsed = Number(fundingAmount);
    return Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * 100)
      : Number.NaN;
  }, [fundingAmount]);

  const completedCycleIds = useMemo(
    () => new Set((wallet?.recentCycles || []).map((cycle) => cycle.cycleId)),
    [wallet?.recentCycles],
  );

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
    const amountPaise = Math.round(parsed * 100);
    if (
      !Number.isFinite(parsed) ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise === 0
    ) {
      setError(
        "Enter a non-zero amount with up to two decimal places. Use a negative amount for an expense.",
      );
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

  const adjustSavings = async (resetToZero = false) => {
    const parsed = resetToZero ? 0 : Number(savingsTarget);
    const savingsBalancePaise = Math.round(parsed * 100);
    if (
      !Number.isFinite(parsed) ||
      !Number.isSafeInteger(savingsBalancePaise) ||
      savingsBalancePaise < 0
    ) {
      setError(
        "Enter a valid non-negative Savings balance with up to two decimal places.",
      );
      return;
    }
    const current = wallet?.savingsBalancePaise || 0;
    const confirmed = window.confirm(
      `Set Savings from ${money(current)} to ${money(savingsBalancePaise)}? This records a separate adjustment and does not rewrite any completed cycle.`,
    );
    if (!confirmed) return;
    setAdjustingSavings(true);
    setError("");
    setMessage("");
    try {
      const data = await walletRequest<WalletData>(
        "/api/admin/wallet/savings",
        {
          method: "PATCH",
          body: JSON.stringify({
            savingsBalancePaise,
            description:
              savingsReason.trim() || "Manual Savings balance adjustment",
          }),
        },
      );
      setWallet(data);
      setSavingsTarget((data.savingsBalancePaise / 100).toFixed(2));
      setMessage(
        "Savings balance updated. Its adjustment is recorded in transaction history.",
      );
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

  const isSystemTransaction = (transaction: WalletTransaction) =>
    transaction.type === "settlement" ||
    transaction.type === "savings-adjustment" ||
    Boolean(transaction.autoEmiMandateId);

  const beginEditTransaction = (transaction: WalletTransaction) => {
    if (isSystemTransaction(transaction)) return;
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
        { method: "PATCH", body: JSON.stringify({ amountPaise }) },
      );
      setWallet(data);
      setEditingEventKey(null);
      setEditingAmount("");
      setMessage(
        "Transaction updated. The completed cycle and linked Savings transfer were recalculated.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the transaction.",
      );
    } finally {
      setUpdatingTransaction(false);
    }
  };

  const removeTransaction = async (transaction: WalletTransaction) => {
    if (isSystemTransaction(transaction)) return;
    const confirmed = window.confirm(
      `Remove this ${transaction.type} transaction?\n\n${transaction.description}\n${money(transaction.walletDeltaPaise, true)}\n\nThe cycle result and linked Savings transfer will be recalculated.`,
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
        "Transaction removed. The completed cycle and linked Savings transfer were recalculated.",
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

  const renderTransactionActions = (
    transaction: WalletTransaction,
    context: "history" | "cycle",
  ) => {
    const isEditing = editingEventKey === transaction.eventKey;
    const isRemoving = removingTransactionKey === transaction.eventKey;
    const locked = isSystemTransaction(transaction);
    if (locked)
      return (
        <small className="admin-wallet-history-system-label">
          {transaction.type === "savings-adjustment"
            ? "Savings balance adjustment"
            : transaction.autoEmiMandateId
              ? "Scheduled EMI debit history"
              : "Linked Savings transfer"}
        </small>
      );

    if (
      context === "history" &&
      transaction.cycleId &&
      completedCycleIds.has(transaction.cycleId)
    ) {
      return (
        <small className="admin-wallet-cycle-manage-hint">
          Manage this entry in Completed cycles
        </small>
      );
    }

    if (isEditing) {
      return (
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
              onChange={(event) => setEditingAmount(event.target.value)}
              autoFocus
              required
            />
          </label>
          <div className="admin-wallet-history-actions">
            <button
              type="submit"
              className="admin-wallet-icon-button is-save"
              disabled={updatingTransaction}
              aria-label="Save amount"
              title="Save amount"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5 9.5 17 19 7.5" />
              </svg>
            </button>
            <button
              type="button"
              className="admin-wallet-icon-button"
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
      );
    }

    return (
      <div className="admin-wallet-history-actions">
        <button
          type="button"
          className="admin-wallet-icon-button"
          disabled={Boolean(removingTransactionKey) || updatingTransaction}
          onClick={() => beginEditTransaction(transaction)}
          aria-label="Edit transaction amount"
          title="Edit amount"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5 4 4M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" />
          </svg>
        </button>
        <button
          type="button"
          className="admin-wallet-icon-button is-danger"
          disabled={
            Boolean(removingTransactionKey) || updatingTransaction || isRemoving
          }
          onClick={() => void removeTransaction(transaction)}
          aria-label="Delete transaction"
          title="Delete entry"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
          </svg>
        </button>
      </div>
    );
  };

  if (!isAdmin || !mountNode) return null;

  return createPortal(
    <section
      className="admin-wallet-panel"
      aria-labelledby="admin-wallet-title"
    >
      <header className="admin-wallet-panel__header">
        <div>
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
                  const displayAmount =
                    transaction.type === "settlement" ||
                    transaction.type === "savings-adjustment"
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
                          {longDate(transaction.createdAt)} ·{" "}
                          {transaction.type.replaceAll("-", " ")}
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
                        <strong
                          className={
                            displayAmount > 0
                              ? "is-positive"
                              : displayAmount < 0
                                ? "is-negative"
                                : ""
                          }
                        >
                          {money(displayAmount, true)}
                        </strong>
                        {renderTransactionActions(transaction, "history")}
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

          <section
            className="admin-wallet-section admin-wallet-cycle-section"
            aria-label="Completed cycles and Savings controls"
          >
            <button
              type="button"
              className="admin-wallet-cycle-toggle"
              aria-expanded={showCycles}
              onClick={() => setShowCycles((value) => !value)}
            >
              <span>
                <strong>Completed cycles</strong>
                <small>
                  {wallet?.recentCycles.length || 0} recent settlements ·
                  Savings {money(wallet?.savingsBalancePaise || 0)}
                </small>
              </span>
              <span aria-hidden="true">{showCycles ? "⌄" : "›"}</span>
            </button>
            {showCycles && (
              <div className="admin-wallet-cycle-content">
                <div className="admin-wallet-cycle-savings">
                  <div className="admin-wallet-cycle-savings-copy">
                    <strong>Savings balance</strong>
                    <span>
                      Set the total value or reset it to zero. Completed cycle
                      entries remain individually editable below.
                    </span>
                  </div>
                  <div className="admin-wallet-savings-fields">
                    <label>
                      <span>Set Savings to (₹)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={savingsTarget}
                        onChange={(event) =>
                          setSavingsTarget(event.target.value)
                        }
                        placeholder="0.00"
                      />
                    </label>
                    <label className="admin-wallet-savings-reason">
                      <span>Reason (optional)</span>
                      <input
                        type="text"
                        maxLength={240}
                        value={savingsReason}
                        onChange={(event) =>
                          setSavingsReason(event.target.value)
                        }
                        placeholder="Manual balance correction"
                      />
                    </label>
                    <div className="admin-wallet-savings-actions">
                      <button
                        type="button"
                        className="admin-wallet-icon-button is-save"
                        disabled={adjustingSavings}
                        onClick={() => void adjustSavings(false)}
                        aria-label="Set Savings balance"
                        title="Set Savings balance"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 12.5 9.5 17 19 7.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="admin-wallet-icon-button is-danger"
                        disabled={
                          adjustingSavings || wallet?.savingsBalancePaise === 0
                        }
                        onClick={() => void adjustSavings(true)}
                        aria-label="Reset Savings to zero"
                        title="Reset Savings to zero"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {wallet?.recentCycles.length ? (
                  <div className="admin-wallet-completed-cycles">
                    {wallet.recentCycles.map((cycle) => {
                      const cycleTransactions =
                        wallet.recentTransactions.filter(
                          (transaction) =>
                            transaction.cycleId === cycle.cycleId &&
                            transaction.type !== "settlement",
                        );
                      const expanded = expandedCycleId === cycle.cycleId;
                      return (
                        <article
                          className="admin-wallet-completed-cycle"
                          key={cycle.cycleId}
                        >
                          <button
                            type="button"
                            className="admin-wallet-completed-cycle-toggle"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedCycleId(
                                expanded ? null : cycle.cycleId,
                              )
                            }
                          >
                            <span className="admin-wallet-completed-cycle-main">
                              <strong>
                                {shortDate(cycle.startedAt)} –{" "}
                                {shortDate(cycle.closedAt)}
                              </strong>
                              <small>
                                {cycle.entryCount} entries · Funding{" "}
                                {money(cycle.fundingPaise)}
                              </small>
                            </span>
                            <span className="admin-wallet-completed-cycle-end">
                              <strong
                                className={
                                  (cycle.savingsTransferPaise || 0) < 0
                                    ? "is-negative"
                                    : "is-positive"
                                }
                              >
                                {money(cycle.savingsTransferPaise || 0, true)}
                              </strong>
                              <span aria-hidden="true">
                                {expanded ? "⌃" : "›"}
                              </span>
                            </span>
                          </button>
                          {expanded && (
                            <div className="admin-wallet-cycle-entries">
                              {cycleTransactions.length ? (
                                cycleTransactions.map((transaction) => (
                                  <article
                                    className="admin-wallet-history-row"
                                    key={transaction.eventKey}
                                  >
                                    <div className="admin-wallet-history-copy">
                                      <strong>{transaction.description}</strong>
                                      <span>
                                        {longDate(transaction.createdAt)} ·{" "}
                                        {transaction.type}
                                      </span>
                                    </div>
                                    <div className="admin-wallet-history-value">
                                      <strong
                                        className={
                                          transaction.walletDeltaPaise > 0
                                            ? "is-positive"
                                            : transaction.walletDeltaPaise < 0
                                              ? "is-negative"
                                              : ""
                                        }
                                      >
                                        {money(
                                          transaction.walletDeltaPaise,
                                          true,
                                        )}
                                      </strong>
                                      {renderTransactionActions(
                                        transaction,
                                        "cycle",
                                      )}
                                    </div>
                                  </article>
                                ))
                              ) : (
                                <p className="admin-wallet-empty">
                                  No individual entries are available in the
                                  recent transaction window for this cycle.
                                </p>
                              )}
                              <p className="admin-wallet-cycle-note">
                                Editing or removing an entry recalculates this
                                cycle’s Savings transfer automatically.
                              </p>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="admin-wallet-empty">
                    Completed cycles will appear here after settlement.
                  </p>
                )}
              </div>
            )}
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
