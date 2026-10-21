import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";
import AssetStateBox from "./AssetStateBox";
import { reportUiFailure } from "../utils/uiDiagnostics";
import "./pushupsAdminPanel.css";

type Metric = { id: string; label: string; description: string };
type PushupSession = {
  sessionId: string;
  startedAt: string;
  durationSeconds: number | null;
  repetitions: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  sets: Array<{ reps: number; durationSeconds?: number; weight?: number; weightUnit?: string }>;
};
type ConfigResponse = {
  availableMetrics: Metric[];
  selectedMetrics: string[];
  sessions: PushupSession[];
  sessionCount: number;
  totalRepetitions: number;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Date unavailable";
}

/**
 * Inline configuration for the existing PERSONAL METRICS / Samsung Health card.
 * This intentionally renders no independent card, title band, import form, or Feed widget.
 * The parent Samsung Health importer sends the same selected export to both import routes.
 */
export default function PushupsAdminPanel() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestJson<ConfigResponse>("/api/health/pushups/admin/config");
      setConfig(next);
      setSelected(next.selectedMetrics || []);
      setLoadFailed(false);
    } catch (reason) {
      reportUiFailure("SamsungHealthMetrics.loadDisplayConfig", reason);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHealthDataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source === "overview" || detail?.source === "pushups") void refresh();
    };
    window.addEventListener("health-data-updated", onHealthDataUpdated);
    return () => window.removeEventListener("health-data-updated", onHealthDataUpdated);
  }, [refresh]);

  const toggleMetric = (id: string, checked: boolean) => {
    setMessage("");
    setSaveFailed(false);
    if (checked && selected.length >= 3) return;
    setSelected((current) => checked
      ? [...current.filter((item) => item !== id), id]
      : current.filter((item) => item !== id));
  };

  const saveConfig = async () => {
    setSaving(true);
    setMessage("");
    setSaveFailed(false);
    try {
      const result = await requestJson<{ selectedMetrics: string[] }>("/api/health/pushups/admin/config", {
        method: "PUT",
        body: JSON.stringify({ selectedMetrics: selected }),
      });
      setSelected(result.selectedMetrics);
      setMessage("Display preferences saved.");
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "pushups" } }));
    } catch (reason) {
      reportUiFailure("SamsungHealthMetrics.saveDisplayConfig", reason);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pushups-admin-panel" aria-labelledby="samsung-health-display-options">
      <div className="pushups-config-title">
        <strong id="samsung-health-display-options">Choose which available push-up data to display</strong>
        <span>Up to 3</span>
      </div>

      {loading ? (
        <AssetStateBox status="loading" compact />
      ) : loadFailed ? (
        <AssetStateBox status="error" compact onRetry={() => void refresh()} />
      ) : !config?.availableMetrics.length ? (
        <p className="pushups-muted">No push-up fields have been detected yet. Import your Samsung Health export above to make available fields selectable.</p>
      ) : (
        <div className="pushups-metric-options">
          {config.availableMetrics.map((metric) => {
            const checked = selected.includes(metric.id);
            const disabled = !checked && selected.length >= 3;
            return (
              <label className={`pushups-metric-option ${checked ? "is-selected" : ""}`} key={metric.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || saving}
                  onChange={(event) => toggleMetric(metric.id, event.currentTarget.checked)}
                />
                <span className="pushups-metric-copy">
                  <strong>{metric.label}</strong>
                  <small>{metric.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {saving && <AssetStateBox status="loading" compact />}
      {saveFailed && <AssetStateBox status="error" compact onRetry={() => void saveConfig()} />}

      <div className="pushups-save-row">
        <span className="pushups-muted">
          {config?.sessionCount ?? 0} push-up session(s) · {(config?.totalRepetitions ?? 0).toLocaleString()} total recorded reps
        </span>
        <button
          type="button"
          className="showcase-outline-button pushups-save-button"
          disabled={saving || loading || loadFailed || selected.length > 3 || !config?.availableMetrics.length}
          onClick={() => void saveConfig()}
        >
          {saving ? "Saving…" : "Save display"}
        </button>
      </div>
      {config?.sessions?.[0] && (
        <p className="pushups-muted">
          Latest detected session: {formatDate(config.sessions[0].startedAt)}
          {config.sessions[0].repetitions != null ? ` · ${config.sessions[0].repetitions} reps` : ""}
          {config.sessions[0].sets.length ? ` · sets: ${config.sessions[0].sets.map((item) => item.reps).join(" + ")}` : ""}
        </p>
      )}
      {message && <p className="pushups-feedback is-success" role="status">{message}</p>}
    </div>
  );
}
