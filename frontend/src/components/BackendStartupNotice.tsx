import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../services/apiBase";
import "./backendStartupNotice.css";

const PROBE_TIMEOUT_MS = 4_500;
const RETRY_DELAY_MS = 2_500;
const HEALTHY_POLL_DELAY_MS = 15_000;

type HealthResponse = {
  status?: string;
};

/**
 * Shows a lightweight notice when the API cannot respond yet, such as while
 * the hosted backend is waking up after a restart. It does not block navigation
 * or replace the page's existing loading artwork.
 */
export default function BackendStartupNotice() {
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let nextCheckTimer: number | null = null;
    let timeoutTimer: number | null = null;
    let activeController: AbortController | null = null;

    const scheduleCheck = (delay: number) => {
      if (cancelled) return;
      if (nextCheckTimer !== null) window.clearTimeout(nextCheckTimer);
      nextCheckTimer = window.setTimeout(() => {
        nextCheckTimer = null;
        void checkBackend();
      }, delay);
    };

    const checkBackend = async () => {
      if (cancelled || checking) return;
      checking = true;
      const controller = new AbortController();
      activeController = controller;
      timeoutTimer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      let responding = false;
      try {
        const response = await fetch(`${API_BASE_URL}/healthz`, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (response.ok) {
          const payload = (await response.json()) as HealthResponse;
          responding = payload?.status === "ok";
        }
      } catch {
        // Connection refused, host still waking, and timeout are all expected here.
      } finally {
        if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
        timeoutTimer = null;
        if (activeController === controller) activeController = null;
        checking = false;
      }

      if (cancelled) return;
      setBackendUnavailable(!responding);
      scheduleCheck(responding ? HEALTHY_POLL_DELAY_MS : RETRY_DELAY_MS);
    };

    const checkNow = () => {
      if (cancelled || checking) return;
      if (nextCheckTimer !== null) {
        window.clearTimeout(nextCheckTimer);
        nextCheckTimer = null;
      }
      void checkBackend();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkNow();
    };

    window.addEventListener("online", checkNow);
    document.addEventListener("visibilitychange", handleVisibility);
    void checkBackend();

    return () => {
      cancelled = true;
      window.removeEventListener("online", checkNow);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (nextCheckTimer !== null) window.clearTimeout(nextCheckTimer);
      if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
      activeController?.abort();
    };
  }, [location.pathname, location.search]);

  if (!backendUnavailable) return null;

  return (
    <div className="backend-startup-notice" role="status" aria-live="polite">
      <span className="backend-startup-notice__spinner" aria-hidden="true" />
      <div className="backend-startup-notice__copy">
        <strong>Blogg’s backend is starting up</strong>
        <p>
          After a site restart, the backend can take around 30 seconds to wake up.
          Feed, account details, and blogs may take longer to open while it starts.
          Keep this page open; this notice will disappear when the backend responds.
        </p>
      </div>
    </div>
  );
}
