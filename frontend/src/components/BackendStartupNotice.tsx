import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../services/apiBase";
import "./backendStartupNotice.css";

const PROBE_TIMEOUT_MS = 4_500;
const RETRY_DELAY_MS = 2_500;
const BLOCKED_RETRY_DELAY_MS = 60_000;
const HEALTHY_POLL_DELAY_MS = 15_000;

type ProbeStatus = "checking" | "reachable" | "blocked" | "unavailable";
type NoSleepStatus = "checking" | "on" | "off" | "unsupported";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockApiLike = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: WakeLockApiLike;
};

/**
 * Explains when the optional health-check is blocked and reports whether the
 * browser has actually granted a screen wake lock. It never blocks navigation.
 */
export default function BackendStartupNotice() {
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("checking");
  const [noSleepStatus, setNoSleepStatus] = useState<NoSleepStatus>("checking");
  const location = useLocation();

  // Keep the current screen awake while this tab is visible. A screen wake lock
  // does not send traffic to, or prevent idle shutdown of, the hosted backend.
  useEffect(() => {
    let cancelled = false;
    let requesting = false;
    let wakeLock: WakeLockSentinelLike | null = null;

    const requestNoSleep = async () => {
      const api = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!api) {
        setNoSleepStatus("unsupported");
        return;
      }
      if (cancelled || requesting || wakeLock || document.visibilityState !== "visible") {
        return;
      }

      requesting = true;
      try {
        const lock = await api.request("screen");
        if (cancelled || document.visibilityState !== "visible") {
          await lock.release();
          if (!cancelled) setNoSleepStatus("off");
          return;
        }

        wakeLock = lock;
        setNoSleepStatus("on");
        lock.addEventListener("release", () => {
          if (wakeLock === lock) wakeLock = null;
          if (!cancelled) setNoSleepStatus("off");
        });
      } catch {
        if (!cancelled) setNoSleepStatus("off");
      } finally {
        requesting = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestNoSleep();
      } else if (!cancelled && wakeLock) {
        // Release explicitly so the visible-tab handler can request a fresh lock.
        const currentLock = wakeLock;
        wakeLock = null;
        setNoSleepStatus("off");
        void currentLock.release();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    void requestNoSleep();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (wakeLock) void wakeLock.release();
      wakeLock = null;
    };
  }, []);

  // The health endpoint is optional. Some ad blockers intentionally block it;
  // that is reported separately from an HTTP response indicating backend trouble.
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
        // fetch() does not expose the name of the blocking extension. When the
        // browser is online but the cross-origin request is rejected, report the
        // health check as blocked rather than claiming the backend is down.
        nextStatus = !navigator.onLine || errorName === "AbortError"
          ? "unavailable"
          : "blocked";
      } finally {
        if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
        timeoutTimer = null;
        if (activeController === controller) activeController = null;
        checking = false;
      }

      if (cancelled) return;
      setProbeStatus(nextStatus);
      if (nextStatus === "reachable") {
        scheduleCheck(HEALTHY_POLL_DELAY_MS);
      } else if (nextStatus === "blocked") {
        // Avoid repeatedly hitting an endpoint that the browser is deliberately blocking.
        scheduleCheck(BLOCKED_RETRY_DELAY_MS);
      } else {
        scheduleCheck(RETRY_DELAY_MS);
      }
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

  if (probeStatus === "checking" || probeStatus === "reachable") return null;

  const healthCheckBlocked = probeStatus === "blocked";
  const noSleepLabel =
    noSleepStatus === "on"
      ? "On"
      : noSleepStatus === "unsupported"
        ? "Not supported"
        : noSleepStatus === "checking"
          ? "Starting"
          : "Off";

  return (
    <div className="backend-startup-notice" role="status" aria-live="polite">
      <span
        className="backend-startup-notice__indicator"
        data-state={healthCheckBlocked ? "blocked" : "waiting"}
        aria-hidden="true"
      />
      <div className="backend-startup-notice__copy">
        <strong>
          {healthCheckBlocked
            ? "Ad blocker is blocking the optional status check"
            : "Blogg’s backend may be asleep"}
        </strong>
        <p>
          {healthCheckBlocked
            ? "The browser is blocking Blogg’s /healthz request, which is commonly caused by an ad blocker or privacy filter. This check is only used for the status notice; it is not required for normal site requests."
            : "The backend status check has not received a response. The hosted backend automatically shuts down after 15 minutes without activity and wakes when a new app request reaches it."}
        </p>

        <div className="backend-startup-notice__statuses" aria-label="Connection status">
          <span
            className="backend-startup-notice__status"
            data-state={healthCheckBlocked ? "active" : "unknown"}
          >
            Ad blocker: {healthCheckBlocked ? "Active" : "Not confirmed"}
          </span>
          <span
            className="backend-startup-notice__status"
            data-state={noSleepStatus === "on" ? "active" : "unknown"}
          >
            NoSleep: {noSleepLabel}
          </span>
          <span className="backend-startup-notice__status" data-state="info">
            Backend auto-sleep: 15 min idle
          </span>
        </div>

        <p className="backend-startup-notice__footnote">
          NoSleep keeps this visible tab’s screen awake only. It does not send
          keep-alive requests, so the backend can still sleep after 15 minutes
          without activity.
        </p>
      </div>
    </div>
  );
}
