import { useCallback, useEffect, useState, type FormEvent } from "react";
import { API_BASE_URL } from "../services/apiBase";
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
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Accept: "application/json", ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Date unavailable";
}

export default function PushupsAdminPanel() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await requestJson<ConfigResponse>("/api/health/pushups/admin/config");
      setConfig(next);
      setSelected(next.selectedMetrics || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load push-up configuration.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const importFiles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!files.length) { setError("Choose a Samsung Health ZIP or exercise CSV/JSON files first."); return; }
    const body = new FormData();
    files.forEach((file) => body.append("files", file, file.name));
    setUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/health/pushups/admin/import`, {
        method: "POST", credentials: "include", cache: "no-store", body,
        headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({})) as { message?: string; sessionsProcessed?: number; availableMetrics?: Metric[] };
      if (!response.ok) throw new Error(result.message || `Import failed (${response.status}).`);
      setMessage(`Imported ${result.sessionsProcessed || 0} push-up session(s). Review the detected display options below.`);
      setFiles([]);
      const input = document.getElementById("pushups-health-files") as HTMLInputElement | null;
      if (input) input.value = "";
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import push-up records.");
    } finally { setUploading(false); }
  };

  const toggleMetric = (id: string, checked: boolean) => {
    setError(""); setMessage("");
    if (checked && selected.length >= 3) { setError("Choose up to three push-up metrics."); return; }
    setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  };

  const saveConfig = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await requestJson<{ selectedMetrics: string[] }>("/api/health/pushups/admin/config", {
        method: "PUT", body: JSON.stringify({ selectedMetrics: selected }),
      });
      setSelected(result.selectedMetrics);
      setMessage("Push-up widget settings saved.");
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "pushups" } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save widget settings.");
    } finally { setSaving(false); }
  };

  return (
    <section className="account-showcase-section account-health-card pushups-admin-panel" aria-labelledby="pushups-admin-title">
      <div className="pushups-admin-heading">
        <div>
          <p className="account-eyebrow">EXERCISE METRICS</p>
          <h3 id="pushups-admin-title">Push-ups widget</h3>
          <p>Upload a Samsung Health ZIP or the exercise CSV with its referenced JSON files. Blogg detects which push-up fields exist and only offers supported displays.</p>
        </div>
        <span className="pushups-admin-count">{selected.length}/3</span>
      </div>

      <form className="pushups-import-form" onSubmit={(event) => void importFiles(event)}>
        <label htmlFor="pushups-health-files">Samsung Health export</label>
        <input id="pushups-health-files" type="file" multiple accept=".zip,.csv,.json,application/zip,application/json,text/csv" onChange={(event) => setFiles(Array.from(event.currentTarget.files || []))} disabled={uploading} />
        {files.length > 0 && <p className="pushups-muted">{files.length} file(s) selected</p>}
        <button type="submit" className="showcase-outline-button pushups-primary-button" disabled={uploading || !files.length}>{uploading ? "Analysing export…" : "Import push-up data"}</button>
      </form>

      <div className="pushups-config-block">
        <div className="pushups-config-title">
          <strong>Choose what visitors see</strong>
          <span>Maximum 3</span>
        </div>
        {loading ? <p className="pushups-muted">Loading detected metrics…</p> : !config?.availableMetrics.length ? (
          <p className="pushups-muted">No push-up records imported yet. Import the ZIP first to detect available metrics.</p>
        ) : (
          <div className="pushups-metric-options">
            {config.availableMetrics.map((metric) => {
              const checked = selected.includes(metric.id);
              const disabled = !checked && selected.length >= 3;
              return (
                <label className={`pushups-metric-option ${checked ? "is-selected" : ""}`} key={metric.id}>
                  <input type="checkbox" checked={checked} disabled={disabled || saving} onChange={(event) => toggleMetric(metric.id, event.currentTarget.checked)} />
                  <span className="pushups-metric-copy"><strong>{metric.label}</strong><small>{metric.description}</small></span>
                </label>
              );
            })}
          </div>
        )}
        <div className="pushups-save-row">
          <span className="pushups-muted">{config?.sessionCount ?? 0} session(s) · {(config?.totalRepetitions ?? 0).toLocaleString()} total recorded reps</span>
          <button type="button" className="showcase-outline-button pushups-save-button" disabled={saving || loading || selected.length > 3 || !config?.availableMetrics.length} onClick={() => void saveConfig()}>{saving ? "Saving…" : "Save display"}</button>
        </div>
        {config?.sessions?.[0] && <p className="pushups-muted">Latest detected session: {formatDate(config.sessions[0].startedAt)}{config.sessions[0].repetitions != null ? ` · ${config.sessions[0].repetitions} reps` : ""}{config.sessions[0].sets.length ? ` · sets: ${config.sessions[0].sets.map((item) => item.reps).join(" + ")}` : ""}</p>}
      </div>
      {(error || message) && <p className={`pushups-feedback ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>{error || message}</p>}
    </section>
  );
}
