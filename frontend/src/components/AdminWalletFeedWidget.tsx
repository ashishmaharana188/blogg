import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWallet.css";
import "./adminWalletFeedGraph.css";

type FeedWalletSummary = {
  walletBalancePaise: number;
  netPnlPaise: number;
  savingsBalancePaise: number;
  autoFundingEnabled: boolean;
  fundingAmountPaise: number;
  nextFundingAt: string | null;
};

type WalletView = "line" | "numerical";

function money(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function dateLabel(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function cleanLineValue(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0.00";
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2);
}

/**
 * Public Feed representation of Savings. The endpoint returns Savings / ₹10,000
 * to two decimals; the exact rupee balance remains admin-only.
 */
export default function AdminWalletFeedWidget() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [wallet, setWallet] = useState<FeedWalletSummary | null>(null);
  const [lineValue, setLineValue] = useState("0.00");
  const [adminError, setAdminError] = useState("");
  const [view, setView] = useState<WalletView>("line");

  useEffect(() => {
    setView(isAdmin ? "numerical" : "line");
  }, [isAdmin]);

  useEffect(() => {
    if (location.pathname.replace(/\/+$/, "") !== "/feed") {
      setMountNode(null);
      return;
    }

    let mount: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed || mount) return Boolean(mount);
      const rail = document.querySelector<HTMLElement>(
        ".blog-feed-widget-rail",
      );
      if (!rail) return false;
      mount = document.createElement("div");
      mount.className = "admin-wallet-feed-widget-mount";
      rail.appendChild(mount);
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
      setWallet(null);
      setLineValue("0.00");
      setAdminError("");
    };
  }, [location.pathname]);

  // Public endpoint returns Savings / ₹10,000 to two decimals. The path renderer
  // turns these digits into one continuous monoline numeral.
  useEffect(() => {
    if (!mountNode) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/showcase/wallet-graph`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          value?: unknown;
          message?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.message ||
              `Wallet line request failed (${response.status}).`,
          );
        return cleanLineValue(payload.value);
      })
      .then((value) => {
        if (!cancelled) setLineValue(value);
      })
      .catch(() => {
        if (!cancelled) setLineValue("0.00");
      });
    return () => {
      cancelled = true;
    };
  }, [mountNode]);

  // Exact figures are requested only by authenticated administrators.
  useEffect(() => {
    if (!isAdmin || !mountNode) {
      setWallet(null);
      setAdminError("");
      return;
    }
    let cancelled = false;
    setAdminError("");
    fetch(`${API_BASE_URL}/api/admin/wallet`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            payload.message || `Wallet request failed (${response.status}).`,
          );
        return payload as FeedWalletSummary;
      })
      .then((data) => {
        if (!cancelled) setWallet(data);
      })
      .catch((reason) => {
        if (!cancelled)
          setAdminError(
            reason instanceof Error
              ? reason.message
              : "Wallet summary is unavailable.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, mountNode]);

  // The ambient SVG reads the string and replaces its route segment with the
  // connected monoline digits, then continues along its normal background path.
  useEffect(() => {
    if (!mountNode) return;
    const surface = mountNode.querySelector<HTMLElement>(
      "[data-wallet-graph-surface='true']",
    );
    if (surface) surface.dataset.walletLineValue = lineValue;
    window.dispatchEvent(new Event("blogg-wallet-graph-update"));
  }, [lineValue, mountNode, view]);

  if (!mountNode) return null;

  const lineMode = !isAdmin || view === "line";

  return createPortal(
    <aside
      className={`admin-wallet-feed-widget${lineMode ? " admin-wallet-feed-widget--graph" : " admin-wallet-feed-widget--numerical"}`}
      aria-label={
        lineMode
          ? "Savings value represented by a continuous line numeral in units of ten thousand rupees"
          : "Administrator wallet summary"
      }
      data-wallet-graph-mode={lineMode ? "graph" : "numerical"}
    >
      <div className="admin-wallet-feed-widget__heading">
        {isAdmin ? (
          <div className="admin-wallet-feed-widget__admin-controls">
            <span className="admin-wallet-feed-widget__admin">ADMIN</span>
            <div
              className="admin-wallet-feed-widget__view-switch"
              role="group"
              aria-label="Wallet display"
            >
              <button
                type="button"
                className={view === "line" ? "is-active" : ""}
                aria-pressed={view === "line"}
                onClick={() => setView("line")}
              >
                Line
              </button>
              <button
                type="button"
                className={view === "numerical" ? "is-active" : ""}
                aria-pressed={view === "numerical"}
                onClick={() => setView("numerical")}
              >
                Numerical
              </button>
            </div>
          </div>
        ) : (
          <span className="admin-wallet-feed-widget__public-label"></span>
        )}
      </div>

      {lineMode ? (
        <div
          className="admin-wallet-feed-widget__graph-surface"
          data-wallet-graph-surface="true"
          data-wallet-line-value={lineValue}
          role="img"
          aria-label="Savings divided by ten thousand rupees, drawn as flowing line digits"
        />
      ) : (
        <>
          {adminError ? (
            <p className="admin-wallet-feed-widget__error">{adminError}</p>
          ) : !wallet ? (
            <p className="admin-wallet-feed-widget__muted">Loading wallet…</p>
          ) : (
            <>
              <div className="admin-wallet-feed-widget__metric">
                <span>Current wallet</span>
                <strong>{money(wallet.walletBalancePaise)}</strong>
              </div>
              <div className="admin-wallet-feed-widget__metric">
                <span>Net P&amp;L</span>
                <strong
                  className={
                    wallet.netPnlPaise < 0 ? "is-negative" : "is-positive"
                  }
                >
                  {money(wallet.netPnlPaise)}
                </strong>
              </div>
              <div className="admin-wallet-feed-widget__metric">
                <span>Total savings</span>
                <strong
                  className={
                    wallet.savingsBalancePaise < 0
                      ? "is-negative"
                      : "is-positive"
                  }
                >
                  {money(wallet.savingsBalancePaise)}
                </strong>
              </div>
              <div className="admin-wallet-feed-widget__footer">
                <span>
                  {wallet.autoFundingEnabled
                    ? `Auto · ${money(wallet.fundingAmountPaise)}`
                    : "Auto funding off"}
                </span>
                <span>Next: {dateLabel(wallet.nextFundingAt)}</span>
              </div>
            </>
          )}
        </>
      )}
    </aside>,
    mountNode,
  );
}
