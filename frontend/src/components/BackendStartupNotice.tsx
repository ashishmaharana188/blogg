import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../services/apiBase";
import "./backendStartupNotice.css";

const PROBE_TIMEOUT_MS = 4_500;

type ProbeStatus = "checking" | "reachable" | "blocked" | "unavailable";

/**
 * Shows a compact, dismissible status for the optional backend health check.
 * A blocked check is not treated as a backend failure and does not block the app.
 */
export default function BackendStartupNotice() {
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("checking");
  const [dismissed, setDismissed] = useState(false);
  const location = useLocation();

  // Run a single probe on initial load and after client-side navigation.
  // Do not poll while healthy: repeated health checks could keep an idle hosted
  // service active and defeat its configured 15-minute inactivity shutdown.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(
      () => controller.abort(),
      PROBE_TIMEOUT_MS,
    );

    const checkBackend = async () => {
      let nextStatus: ProbeStatus = "unavailable";
      try {
        const response = await fetch(
          `${API_BASE_URL}/healthz?startupProbe=${Date.now()}`,
          {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const contentType = response.headers.get("content-type") || "";
        nextStatus =
          response.ok && contentType.toLowerCase().includes("application/json")
            ? "reachable"
            : "unavailable";
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "";
        // Browser fetch errors do not identify the blocking extension. An
        // online cross-origin rejection is therefore labelled as filtered.
        nextStatus = !navigator.onLine || errorName === "AbortError"
          ? "unavailable"
          : "blocked";
      } finally {
        window.clearTimeout(timeoutTimer);
      }

      if (!cancelled) setProbeStatus(nextStatus);
    };

    void checkBackend();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [location.pathname, location.search]);

  if (dismissed || probeStatus === "checking") return null;

  const isBlocked = probeStatus === "blocked";
  const isReachable = probeStatus === "reachable";

  return (
    <div className="backend-startup-notice" role="status" aria-live="polite">
      <span
        className="backend-startup-notice__dot"
        data-state={isBlocked ? "blocked" : isReachable ? "ready" : "waiting"}
        aria-hidden="true"
      />

      <div className="backend-startup-notice__items">
        <span className="backend-startup-notice__item" data-state={isBlocked ? "active" : isReachable ? "inactive" : "unknown"}>
          Ad blocker: {isBlocked ? "Active" : isReachable ? "Off" : "Unknown"}
        </span>
        <span className="backend-startup-notice__item" data-state={isReachable ? "active" : "inactive"}>
          NoSleep: {isReachable ? "On" : "Off"}
        </span>
        <span className="backend-startup-notice__item backend-startup-notice__item--info">
          Backend auto-sleeps after 15 min idle
        </span>
        {isBlocked && (
          <span className="backend-startup-notice__hint">
            Optional status request blocked; normal site requests are separate.
          </span>
        )}
        {!isBlocked && !isReachable && (
          <span className="backend-startup-notice__hint">
            Backend status could not be confirmed; it may be waking up.
          </span>
        )}
      </div>

      <button
        className="backend-startup-notice__close"
        type="button"
        aria-label="Close status notice"
        title="Close"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
