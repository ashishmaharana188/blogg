import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./adminWallet.css";

type FeedWalletSummary = {
  walletBalancePaise: number;
  netPnlPaise: number;
  savingsBalancePaise: number;
  autoFundingEnabled: boolean;
  fundingAmountPaise: number;
  nextFundingAt: string | null;
};

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

/** A protected, read-only wallet summary mounted beside the Feed widgets. */
export default function AdminWalletFeedWidget() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [wallet, setWallet] = useState<FeedWalletSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin || location.pathname.replace(/\/+$/, "") !== "/feed") {
      setMountNode(null);
      return;
    }

    let mount: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed || mount) return Boolean(mount);
      const rail = document.querySelector<HTMLElement>(".blog-feed-widget-rail");
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
      setMountNode((current) => current === mount ? null : current);
      setWallet(null);
      setError("");
    };
  }, [isAdmin, location.pathname]);

  useEffect(() => {
    if (!isAdmin || !mountNode) return;
    let cancelled = false;
    setError("");
    fetch(`${API_BASE_URL}/api/admin/wallet`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `Wallet request failed (${response.status}).`);
        return payload as FeedWalletSummary;
      })
      .then((data) => {
        if (!cancelled) setWallet(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Wallet summary is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, mountNode]);

  if (!isAdmin || !mountNode) return null;

  return createPortal(
    <aside className="admin-wallet-feed-widget" aria-label="Administrator wallet summary">
      <div className="admin-wallet-feed-widget__heading">
        <span>WALLET</span>
        <span className="admin-wallet-feed-widget__admin">ADMIN</span>
      </div>
      {error ? (
        <p className="admin-wallet-feed-widget__error">{error}</p>
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
            <strong className={wallet.netPnlPaise < 0 ? "is-negative" : "is-positive"}>
              {money(wallet.netPnlPaise)}
            </strong>
          </div>
          <div className="admin-wallet-feed-widget__metric">
            <span>Total savings</span>
            <strong className={wallet.savingsBalancePaise < 0 ? "is-negative" : "is-positive"}>
              {money(wallet.savingsBalancePaise)}
            </strong>
          </div>
          <div className="admin-wallet-feed-widget__footer">
            <span>{wallet.autoFundingEnabled ? `Auto · ${money(wallet.fundingAmountPaise)}` : "Auto funding off"}</span>
            <span>Next: {dateLabel(wallet.nextFundingAt)}</span>
          </div>
        </>
      )}
      <Link to="/account" className="admin-wallet-feed-widget__link">Manage Wallet <span aria-hidden="true">→</span></Link>
    </aside>,
    mountNode,
  );
}
