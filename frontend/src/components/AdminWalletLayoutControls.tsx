import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import "./adminWalletEnhancements.css";

/**
 * Places the wallet below Daily Activity in the wide center column and gives
 * transaction history its own collapsible, internally scrollable area.
 */
export default function AdminWalletLayoutControls() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [historySection, setHistorySection] = useState<HTMLElement | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);

  const adminAccountView =
    location.pathname.replace(/\/+$/, "") === "/account" &&
    new URLSearchParams(location.search).get("view") !== "public";

  useEffect(() => {
    if (!isAdmin || !adminAccountView) {
      setMountNode(null);
      setHistorySection(null);
      return;
    }

    let toggleMount: HTMLDivElement | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed) return;

      const youtubeColumn = document.querySelector<HTMLElement>(
        ".account-dashboard-youtube-column",
      );
      const walletMount = document.querySelector<HTMLElement>(
        ".admin-wallet-panel-mount",
      );
      const dailyActivity = youtubeColumn?.querySelector<HTMLElement>(
        ":scope > [data-health-admin-host='true'][data-health-section='steps']",
      );
      const youtubePanel = youtubeColumn?.querySelector<HTMLElement>(
        ":scope > .account-dashboard-youtube",
      );

      // Health's bootstrap inserts the Daily Activity host asynchronously.
      // Use the YouTube panel as a temporary anchor, then move Wallet below
      // Daily Activity as soon as that host appears.
      const anchor = dailyActivity || youtubePanel;
      if (youtubeColumn && walletMount && anchor) {
        if (
          walletMount.parentElement !== youtubeColumn ||
          walletMount.previousElementSibling !== anchor
        ) {
          anchor.insertAdjacentElement("afterend", walletMount);
        }
      }

      const section = document.querySelector<HTMLElement>(
        '.admin-wallet-section[aria-label="Wallet transaction history"]',
      );
      const heading = section?.querySelector<HTMLElement>(
        ".admin-wallet-section-heading",
      );

      if (section && heading) {
        if (!toggleMount || !toggleMount.isConnected) {
          toggleMount?.remove();
          toggleMount = document.createElement("div");
          toggleMount.className = "admin-wallet-history-toggle-mount";
          const actionGroup = heading.querySelector<HTMLElement>(
            ".admin-wallet-history-heading-actions",
          );
          (actionGroup || heading).appendChild(toggleMount);
          setHistorySection(section);
          setMountNode(toggleMount);
        } else {
          const actionGroup = heading.querySelector<HTMLElement>(
            ".admin-wallet-history-heading-actions",
          );
          const target = actionGroup || heading;
          if (toggleMount.parentElement !== target) target.appendChild(toggleMount);
          setHistorySection(section);
          setMountNode(toggleMount);
        }
      }
    };

    // Keep observing while the independent Health bootstrap mounts/reorders
    // its sections. DOM moves are no-ops once the wallet reaches its anchor.
    const observer = new MutationObserver(tryAttach);
    observer.observe(document.body, { childList: true, subtree: true });
    tryAttach();

    return () => {
      disposed = true;
      observer.disconnect();
      toggleMount?.remove();
      setMountNode((current) => current === toggleMount ? null : current);
      setHistorySection(null);
    };
  }, [isAdmin, adminAccountView]);

  useEffect(() => {
    if (!historySection) return;
    historySection.dataset.historyCollapsed = historyExpanded ? "false" : "true";
    return () => {
      delete historySection.dataset.historyCollapsed;
    };
  }, [historySection, historyExpanded]);

  if (!isAdmin || !adminAccountView || !mountNode) return null;

  return createPortal(
    <button
      type="button"
      className="admin-wallet-history-toggle"
      aria-expanded={historyExpanded}
      onClick={() => setHistoryExpanded((expanded) => !expanded)}
    >
      {historyExpanded ? "Hide history" : "Show history"}
    </button>,
    mountNode,
  );
}
