import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authContext";
import "./adminWalletEnhancements.css";

/**
 * Adds the collapsible history control. Wallet placement is handled once by
 * AdminWalletPanel using the same stable anchor expected by the Health bootstrap.
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

    let disposed = false;
    let walletMount: HTMLElement | null = null;
    let toggleMount: HTMLDivElement | null = null;
    let documentObserver: MutationObserver | null = null;
    let walletObserver: MutationObserver | null = null;

    const attachToWallet = (candidate: HTMLElement) => {
      if (disposed || toggleMount) return Boolean(toggleMount);
      walletMount = candidate;

      const attachHistory = () => {
        if (disposed || !walletMount || toggleMount) return Boolean(toggleMount);
        const section = walletMount.querySelector<HTMLElement>(
          '.admin-wallet-section[aria-label="Wallet transaction history"]',
        );
        const heading = section?.querySelector<HTMLElement>(
          ".admin-wallet-section-heading",
        );
        if (!section || !heading) return false;

        toggleMount = document.createElement("div");
        toggleMount.className = "admin-wallet-history-toggle-mount";
        const actionGroup = heading.querySelector<HTMLElement>(
          ".admin-wallet-history-heading-actions",
        );
        (actionGroup || heading).appendChild(toggleMount);
        setHistorySection(section);
        setMountNode(toggleMount);
        walletObserver?.disconnect();
        walletObserver = null;
        return true;
      };

      if (!attachHistory()) {
        // Watch only the Wallet subtree, and stop as soon as history is ready.
        walletObserver = new MutationObserver(() => attachHistory());
        walletObserver.observe(walletMount, {
          childList: true,
          subtree: true,
        });
      }
      return true;
    };

    const existingMount = document.querySelector<HTMLElement>(
      ".admin-wallet-panel-mount",
    );
    if (existingMount) {
      attachToWallet(existingMount);
    } else {
      // This observer is temporary: it stops as soon as Wallet creates its mount.
      documentObserver = new MutationObserver(() => {
        const candidate = document.querySelector<HTMLElement>(
          ".admin-wallet-panel-mount",
        );
        if (candidate && attachToWallet(candidate)) {
          documentObserver?.disconnect();
          documentObserver = null;
        }
      });
      documentObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      disposed = true;
      documentObserver?.disconnect();
      walletObserver?.disconnect();
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
