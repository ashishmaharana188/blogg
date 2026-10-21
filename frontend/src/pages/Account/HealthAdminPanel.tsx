import { useCallback, useEffect, useState, type FormEvent } from "react";
import { API_BASE_URL } from "../../services/apiBase";
import AssetStateBox from "../../components/AssetStateBox";
import { reportUiFailure } from "../../utils/uiDiagnostics";
import "./healthAdminPanel.css";
import "./samsungHealthMetrics.css";

type StepDay = {
  day: string;
  steps: number;
  runSteps: number | null;
  walkSteps: number | null;
  distanceM: number | null;
  calories: number | null;
};
type HeartRateSample = { measuredAt: string; bpm: number };
type RunSummary = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  distanceM: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgCadence: number | null;
  heartRateSamples: Array<{ time: string; bpm: number }>;
};
type HealthPanelSection = "overview" | "steps" | "running";

type HealthSummary = {
  steps: {
    date: string;
    today: number | null;
    average7d: number | null;
    observedDays7d: number;
    recentDays: StepDay[];
  };
  latestHeartRate: { bpm: number; measuredAt: string } | null;
  latestRun: RunSummary | null;
  recentRuns: RunSummary[];
  latestImport: {
    createdAt: string;
    filenames: string[];
    stepDaysProcessed: number;
    runSessionsProcessed: number;
    heartRateSamplesProcessed: number;
  } | null;
  recentHeartRates: HeartRateSample[];
};

type SamsungMetric = { id: string; label: string; description: string };
type ExerciseSession = {
  sessionId?: string;
  exerciseType?: number;
  activityName?: string;
  startedAt: string;
  durationSeconds?: number | null;
  repetitions?: number | null;
  calories?: number | null;
  avgHeartRate?: number | null;
  minHeartRate?: number | null;
  maxHeartRate?: number | null;
  sets?: Array<{ reps: number }>;
  values?: Record<string, unknown>;
};
type SamsungMetricData = {
  selectedMetrics: string[];
  availableMetrics?: SamsungMetric[];
  sessions?: ExerciseSession[];
  latestSession?: { startedAt: string; exerciseType?: number; activityName?: string; values: Record<string, unknown> } | null;
  recentSessions?: ExerciseSession[];
  sessionCount?: number;
  totalRepetitions?: number;
};

const METRIC_LABELS: Record<string, string> = {
  repetitions: "Repetitions / count",
  sets: "Set breakdown",
  duration: "Workout duration",
  heart_rate: "Heart rate",
  calories: "Calories",
  history: "Workout history",
};

function getMetricValue(metricId: string, data: SamsungMetricData): { value: string; detail?: string } {
  const session = data.sessions?.[0];
  const latest = data.latestSession;
  const values = session?.values ?? latest?.values ?? {};
  const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  if (metricId === "repetitions") {
    const value = numberValue(session?.repetitions) ?? numberValue(values.repetitions);
    return { value: value === null ? "—" : value.toLocaleString(), detail: "Latest session" };
  }
  if (metricId === "sets") {
    const sessionSets = session?.sets?.map((set) => set.reps);
    const rawSets = Array.isArray(values.sets) ? values.sets.filter((value): value is number => typeof value === "number") : [];
    const sets = sessionSets?.length ? sessionSets : rawSets;
    return { value: sets.length ? sets.join(" + ") : "—", detail: sets.length ? `${sets.length} set(s)` : "No set data" };
  }
  if (metricId === "duration") {
    const value = numberValue(session?.durationSeconds) ?? numberValue(values.durationSeconds);
    return { value: value === null ? "—" : formatDuration(value), detail: "Latest session" };
  }
  if (metricId === "calories") {
    const value = numberValue(session?.calories) ?? numberValue(values.calories);
    return { value: value === null ? "—" : `${value.toFixed(1)} kcal`, detail: "Latest session" };
  }
  if (metricId === "heart_rate") {
    const raw = values.heartRate as { average?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
    const average = numberValue(session?.avgHeartRate) ?? numberValue(raw?.average);
    const minimum = numberValue(session?.minHeartRate) ?? numberValue(raw?.minimum);
    const maximum = numberValue(session?.maxHeartRate) ?? numberValue(raw?.maximum);
    return { value: average === null ? "—" : `${Math.round(average)} bpm`, detail: minimum !== null || maximum !== null ? `${minimum === null ? "—" : Math.round(minimum)}–${maximum === null ? "—" : Math.round(maximum)} BPM range` : "Latest session average" };
  }
  const history = values.history as { sessionCount?: unknown; totalRepetitions?: unknown; totalCount?: unknown } | undefined;
  const count = data.sessionCount ?? numberValue(history?.sessionCount) ?? 0;
  const total = data.totalRepetitions ?? numberValue(history?.totalCount) ?? numberValue(history?.totalRepetitions) ?? 0;
  return { value: `${count.toLocaleString()} session(s)`, detail: `${total.toLocaleString()} total count / reps` };
}

function metricTrendNumber(metricId: string, session: ExerciseSession): number | null {
  const values = session.values ?? {};
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  if (metricId === "repetitions") return numeric(session.repetitions) ?? numeric(values.repetitions);
  if (metricId === "duration") return numeric(session.durationSeconds) ?? numeric(values.durationSeconds);
  if (metricId === "calories") return numeric(session.calories) ?? numeric(values.calories);
  if (metricId === "heart_rate") {
    const heartRate = values.heartRate as { average?: unknown } | undefined;
    return numeric(session.avgHeartRate) ?? numeric(heartRate?.average);
  }
  if (metricId === "sets") {
    const sets = session.sets?.map((set) => set.reps) ?? (Array.isArray(values.sets) ? values.sets.filter((value): value is number => typeof value === "number") : []);
    return sets.length ? sets.reduce((sum, value) => sum + value, 0) : null;
  }
  return 1;
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return payload.message || payload.detail || `Request failed (${response.status})`;
}

async function fetchHealthSummary(isAdmin: boolean): Promise<HealthSummary> {
  const endpoint = isAdmin ? "/api/health/admin/summary" : "/api/health/public-summary";
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    credentials: isAdmin ? "include" : "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<HealthSummary>;
}

function formatDate(value?: string | null): string {
  if (!value) return "No records yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "No records yet";
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDistance(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export default function HealthAdminPanel({ isAdmin, section }: { isAdmin: boolean; section: HealthPanelSection }) {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [metricData, setMetricData] = useState<SamsungMetricData | null>(null);
  const [metricSelection, setMetricSelection] = useState<string[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(section === "overview" || section === "running");
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [metricsSaved, setMetricsSaved] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await fetchHealthSummary(isAdmin));
      setError("");
      setLoadFailed(false);
    } catch (reason) {
      reportUiFailure("HealthAdminPanel.loadSummary", reason);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }

    if (section === "overview" || section === "running") {
      setMetricsLoading(true);
      try {
        const endpoint = isAdmin ? "/api/health/exercises/admin/config" : "/api/health/exercises/public";
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          credentials: isAdmin ? "include" : "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Samsung Health metrics request failed (${response.status})`);
        const next = await response.json() as SamsungMetricData;
        setMetricData(next);
        setMetricSelection(next.selectedMetrics || []);
        setMetricsFailed(false);
      } catch (reason) {
        reportUiFailure("SamsungHealth.loadMetricConfig", reason);
        setMetricsFailed(true);
      } finally {
        setMetricsLoading(false);
      }
    }
  }, [isAdmin, section]);

  useEffect(() => {
    void refresh();

    const onHealthDataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: HealthPanelSection | "metrics" }>).detail;
      if (detail?.source !== section || detail?.source === "metrics") void refresh();
    };
    window.addEventListener("health-data-updated", onHealthDataUpdated);
    return () => window.removeEventListener("health-data-updated", onHealthDataUpdated);
  }, [isAdmin, refresh, section]);

  const importFiles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setImportFailed(false);
    if (!files.length) {
      setImportFailed(true);
      return;
    }
    const body = new FormData();
    files.forEach((file) => body.append("files", file, file.name));
    setUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/health/admin/import`, {
        method: "POST",
        credentials: "include",
        body,
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as {
        message?: string;
        filesProcessed?: number;
        sourceFilesProcessed?: number;
        stepDaysProcessed?: number;
        runSessionsProcessed?: number;
        heartRateSamplesProcessed?: number;
        exerciseSessionsProcessed?: number;
      };
      if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
      const counts = [
        `${Number(payload.stepDaysProcessed || 0)} daily step record(s)`,
        `${Number(payload.runSessionsProcessed || 0)} run session(s)`,
        `${Number(payload.heartRateSamplesProcessed || 0)} standalone heart-rate sample(s)`,
        `${Number(payload.exerciseSessionsProcessed || 0)} exercise session(s)`,
      ];
      setMessage(`Samsung Health import complete: ${counts.join(", ")}.`);
      setFiles([]);
      const input = document.getElementById("health-samsung-files") as HTMLInputElement | null;
      if (input) input.value = "";
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "metrics" } }));
    } catch (reason) {
      reportUiFailure("HealthAdminPanel.import", reason);
      setImportFailed(true);
    } finally {
      setUploading(false);
    }
  };

  const saveMetricSelection = async () => {
    setSavingMetrics(true);
    setMetricsSaved(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/health/exercises/admin/config`, {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ selectedMetrics: metricSelection }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; selectedMetrics?: string[]; availableMetrics?: SamsungMetric[] };
      if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
      setMetricSelection(payload.selectedMetrics || []);
      setMetricData((previous) => previous ? { ...previous, selectedMetrics: payload.selectedMetrics || [], availableMetrics: payload.availableMetrics || previous.availableMetrics } : previous);
      setMetricsFailed(false);
      setMetricsSaved(true);
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "metrics" } }));
    } catch (reason) {
      reportUiFailure("SamsungHealth.saveMetricSelection", reason);
      setMetricsFailed(true);
    } finally {
      setSavingMetrics(false);
    }
  };


  const recentDays = summary?.steps.recentDays || [];
  const chartMaximum = Math.max(1, ...recentDays.map((day) => day.steps));
  const recentBpm = (summary?.recentHeartRates || []).slice().reverse();
  const bpmValues = recentBpm.map((sample) => sample.bpm);
  const bpmMinimum = bpmValues.length ? Math.min(...bpmValues) : 0;
  const bpmRange = Math.max(1, (bpmValues.length ? Math.max(...bpmValues) : 1) - bpmMinimum);
  const latestRun = summary?.latestRun;

  return (
    <>
      {section === "overview" && (
      <section className="account-showcase-section account-health-card health-admin-overview" aria-labelledby="health-panel-title">
        <div className="health-panel-heading">
          <div>
            <p className="account-eyebrow">PERSONAL METRICS</p>
            <h2 id="health-panel-title">Samsung Health</h2>
            <p>{isAdmin ? "Import selected CSV and JSON files. Re-imports update existing records instead of duplicating them." : "Daily steps, recent running sessions and heart-rate summaries."}</p>
          </div>
          <button type="button" className="showcase-outline-button" onClick={() => void refresh()} disabled={loading || uploading}>
            {"Refresh"}
          </button>
        </div>

        {loading && !summary && <AssetStateBox status="loading" compact />}
        {loadFailed && <AssetStateBox status="error" compact onRetry={() => void refresh()} />}

        {isAdmin && <form className="health-import-form" onSubmit={importFiles}>
          <label htmlFor="health-samsung-files">Samsung Health export files</label>
          <input
            id="health-samsung-files"
            type="file"
            multiple
            accept=".zip,.csv,.json,application/zip,application/x-zip-compressed,application/json,text/csv"
            onChange={(event) => setFiles(Array.from(event.currentTarget.files || []))}
            disabled={uploading}
          />
          <p className="health-import-hint">Import one Samsung Health ZIP or choose CSV/JSON files individually. The same import scans daily steps, running, heart-rate records, and exercise activities.</p>
          {files.length > 0 && <p className="health-selected-files">{files.length} file(s) selected: {files.map((file) => file.name).join(", ")}</p>}
          <div className="health-import-actions">
            <button className="showcase-outline-button health-import-button" type="submit" disabled={uploading || files.length === 0}>
              {"Import selected files"}
            </button>
            <button className="showcase-outline-button" type="button" onClick={() => { setFiles([]); const input = document.getElementById("health-samsung-files") as HTMLInputElement | null; if (input) input.value = ""; }} disabled={uploading || files.length === 0}>Clear selection</button>
          </div>
          {message && <p className="health-feedback is-success" role="status">{message}</p>}
          {error && <AssetStateBox status="error" compact />}
          {uploading && <AssetStateBox status="loading" compact />}
          {importFailed && <AssetStateBox status="error" compact onRetry={() => { document.querySelector<HTMLFormElement>(".health-import-form")?.requestSubmit(); }} />}
        </form>}

        {isAdmin && (
          <details className="health-metric-settings">
            <summary>Customize displayed Samsung Health metrics</summary>
            <div className="health-metric-settings-body">
              {metricsLoading ? <AssetStateBox status="loading" compact /> : metricsFailed ? (
                <AssetStateBox status="error" compact onRetry={() => void refresh()} />
              ) : !metricData?.availableMetrics?.length ? (
                <p className="health-muted">Import a Samsung Health export first. Available metric options will appear here automatically.</p>
              ) : (
                <>
                  <p className="health-metric-settings-hint">Choose up to three exercise fields. The selected fields appear in the Exercise & Other Activities section here and in the existing Samsung Health Feed card.</p>
                  <div className="health-metric-settings-options">
                    {metricData.availableMetrics.map((metric) => {
                      const checked = metricSelection.includes(metric.id);
                      const disabled = !checked && metricSelection.length >= 3;
                      return (
                        <label className={`health-metric-option ${checked ? "is-selected" : ""}`} key={metric.id}>
                          <input type="checkbox" checked={checked} disabled={disabled || savingMetrics} onChange={(event) => {
                            const isChecked = event.currentTarget.checked;
                            setMetricsSaved(false);
                            setMetricSelection((current) => isChecked
                              ? [...current.filter((id) => id !== metric.id), metric.id]
                              : current.filter((id) => id !== metric.id));
                          }} />
                          <span><strong>{metric.label}</strong><small>{metric.description}</small></span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="health-metric-settings-footer">
                    <span>{metricSelection.length}/3 selected</span>
                    <button type="button" className="showcase-outline-button" onClick={() => void saveMetricSelection()} disabled={savingMetrics || metricSelection.length > 3}>
                      {savingMetrics ? "Saving…" : "Save display"}
                    </button>
                  </div>
                  {metricsSaved && <p className="health-feedback is-success" role="status">Display preferences saved.</p>}
                  {metricsFailed && <AssetStateBox status="error" compact onRetry={() => void saveMetricSelection()} />}
                </>
              )}
            </div>
          </details>
        )}

        {/* Exercise metrics render in their own activity section, not beside the file picker. */}

        {isAdmin && <div className="health-last-import">
          {summary?.latestImport ? <>
            <strong>Last import</strong>
            <span>{formatDate(summary.latestImport.createdAt)} · {summary.latestImport.filenames.length} source file(s)</span>
            <details><summary>Show imported filenames</summary><ul>{summary.latestImport.filenames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></details>
          </> : <span>No import history yet.</span>}
        </div>}
      </section>
      )}

      {section === "steps" && (
      <section className="account-showcase-section account-health-card health-admin-steps" aria-labelledby="health-steps-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">DAILY ACTIVITY</p>
          <h3 id="health-steps-title">Steps and overview</h3>
        </div>
        {loading && !summary ? <AssetStateBox status="loading" compact /> : loadFailed && !summary ? <AssetStateBox status="error" compact onRetry={() => void refresh()} /> : <>
          <div className="health-metric-grid">
            <article className="health-metric-card">
              <span>Steps today</span>
              <strong>{summary?.steps.today == null ? "—" : summary.steps.today.toLocaleString()}</strong>
              <small>{summary?.steps.date || "Awaiting data"}</small>
            </article>
            <article className="health-metric-card">
              <span>Average steps</span>
              <strong>{summary?.steps.average7d == null ? "—" : summary.steps.average7d.toLocaleString()}</strong>
              <small>{summary?.steps.observedDays7d || 0} recorded day(s) in the last 7 days</small>
            </article>
            <article className="health-metric-card">
              <span>Latest heart rate</span>
              <strong>{summary?.latestHeartRate ? `${summary.latestHeartRate.bpm} bpm` : "—"}</strong>
              <small>{formatDate(summary?.latestHeartRate?.measuredAt)}</small>
            </article>
            <article className="health-metric-card">
              <span>Most recent run</span>
              <strong>{latestRun ? formatDistance(latestRun.distanceM) : "—"}</strong>
              <small>{latestRun ? `${formatDuration(latestRun.durationSeconds)} · ${latestRun.avgHeartRate == null ? "No average BPM" : `${Math.round(latestRun.avgHeartRate)} bpm avg`}` : "No run imported"}</small>
            </article>
          </div>

          <div className="health-admin-subsection">
            <div className="health-admin-subheading"><h3>Recent daily steps</h3><span>Recorded days only</span></div>
            {recentDays.length ? <div className="health-step-history">
              {recentDays.slice().reverse().map((day) => (
                <div className="health-step-day" key={day.day}>
                  <span className="health-step-day-date">{new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  <span className="health-step-bar"><span style={{ width: `${Math.max(0, Math.min(100, (day.steps / chartMaximum) * 100))}%` }} /></span>
                  <strong>{day.steps.toLocaleString()}</strong>
                </div>
              ))}
            </div> : <p className="health-muted">No step records imported yet.</p>}
          </div>
        </>}
      </section>
      )}

      {section === "running" && (
      <>
      <section className="account-showcase-section account-health-card health-admin-running" aria-labelledby="health-running-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">RUNNING AND BPM</p>
          <h3 id="health-running-title">Runs and heart rate</h3>
        </div>
        {loading && !summary ? <AssetStateBox status="loading" compact /> : loadFailed && !summary ? <AssetStateBox status="error" compact onRetry={() => void refresh()} /> : <>
          <div className="health-admin-subsection health-admin-subsection-first">
            <div className="health-admin-subheading"><h3>Running sessions</h3><span>{summary?.recentRuns.length || 0} shown</span></div>
            {summary?.recentRuns.length ? <div className="health-run-list">
              {summary.recentRuns.slice(0, 5).map((run) => (
                <article className="health-run-row" key={run.sessionId}>
                  <div className="health-run-title"><strong>{formatDistance(run.distanceM)} run</strong><span>{formatDate(run.startedAt)}</span></div>
                  <div className="health-run-metrics">
                    <span>{formatDuration(run.durationSeconds)}</span>
                    <span>{run.avgHeartRate == null ? "—" : `${Math.round(run.avgHeartRate)} avg bpm`}</span>
                    <span>{run.calories == null ? "—" : `${Math.round(run.calories)} kcal`}</span>
                    <span>{run.avgSpeedMps == null ? "—" : `${(run.avgSpeedMps * 3.6).toFixed(1)} km/h`}</span>
                  </div>
                  {!!run.heartRateSamples.length && <div className="health-hr-spark" aria-label={`Heart-rate trace for run, from ${run.heartRateSamples[0].bpm} to ${run.heartRateSamples[run.heartRateSamples.length - 1].bpm} beats per minute`}>
                    {run.heartRateSamples.map((point, index) => {
                      const values = run.heartRateSamples.map((sample) => sample.bpm);
                      const span = Math.max(1, Math.max(...values) - Math.min(...values));
                      const height = 15 + ((point.bpm - Math.min(...values)) / span) * 35;
                      return <span key={`${point.time}-${index}`} title={`${Math.round(point.bpm)} bpm`} style={{ height: `${height}px` }} />;
                    })}
                  </div>}
                </article>
              ))}
            </div> : <p className="health-muted">No running sessions imported yet. Include an exercise CSV and the JSON file named in its live_data column.</p>}
          </div>

          <div className="health-admin-subsection">
            <div className="health-admin-subheading"><h3>Recent BPM samples</h3><span>{recentBpm.length} samples</span></div>
            {recentBpm.length ? <>
              <div className="health-hr-history-chart" role="img" aria-label={`Recent heart-rate samples, ${Math.min(...bpmValues)} to ${Math.max(...bpmValues)} beats per minute`}>
                {recentBpm.map((sample, index) => <span key={`${sample.measuredAt}-${index}`} title={`${Math.round(sample.bpm)} bpm · ${formatDate(sample.measuredAt)}`} style={{ height: `${15 + ((sample.bpm - bpmMinimum) / bpmRange) * 35}px` }} />)}
              </div>
              <p className="health-muted">Range: {Math.min(...bpmValues)}–{Math.max(...bpmValues)} bpm. Includes standalone heart-rate records and samples captured during running sessions.</p>
            </> : <p className="health-muted">No heart-rate samples imported yet.</p>}
          </div>
        </>}
      </section>

      <section className="account-showcase-section account-health-card health-selected-exercise" aria-labelledby="health-exercise-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">EXERCISE & OTHER ACTIVITIES</p>
          <h3 id="health-exercise-title">Exercise sessions</h3>
        </div>
        {metricsLoading ? <AssetStateBox status="loading" compact /> : metricsFailed ? (
          <AssetStateBox status="error" compact onRetry={() => void refresh()} />
        ) : !metricData || (!(metricData.sessions?.length) && !metricData.latestSession) ? (
          <p className="health-muted">Exercise records will appear here after importing a Samsung Health export containing supported exercise activities.</p>
        ) : (
          <>
            <div className="health-selected-exercise-heading">
              <div><strong>{metricData.sessions?.[0]?.activityName || metricData.latestSession?.activityName || "Exercise"}</strong></div>
              <span>{formatDate(metricData.sessions?.[0]?.startedAt || metricData.latestSession?.startedAt)}</span>
            </div>
            {metricData.selectedMetrics.length ? (
              <div className="health-selected-exercise-cards">
                {metricData.selectedMetrics.map((id) => {
                  const shown = getMetricValue(id, metricData);
                  return <article className="health-selected-exercise-card" key={id}>
                    <span>{METRIC_LABELS[id] || id}</span><strong>{shown.value}</strong>{shown.detail && <small>{shown.detail}</small>}
                  </article>;
                })}
              </div>
            ) : <p className="health-muted">No exercise fields are currently selected. Open “Customize displayed Samsung Health metrics” in the import card to choose up to three fields.</p>}

            <details className="health-exercise-details">
              <summary>Expand exercise history and trend</summary>
              {(() => {
                const sessions = (metricData.sessions || metricData.recentSessions || []).slice(0, 8).reverse();
                const trendMetric = metricData.selectedMetrics.find((id) => id !== "history") || (metricData.selectedMetrics.includes("history") ? "history" : undefined);
                const numberFrom = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
                let points: Array<{ key: string; label: string; value: number }> = [];
                if (trendMetric === "history") {
                  const counts = new Map<string, number>();
                  sessions.forEach((session) => {
                    const day = new Date(session.startedAt).toISOString().slice(0, 10);
                    counts.set(day, (counts.get(day) || 0) + 1);
                  });
                  points = [...counts.entries()].map(([day, value]) => ({ key: day, label: day, value }));
                } else if (trendMetric) {
                  points = sessions.map((session) => {
                    const value = metricTrendNumber(trendMetric, session);
                    return value === null ? null : { key: session.startedAt, label: session.startedAt, value };
                  }).filter((point): point is { key: string; label: string; value: number } => point !== null && numberFrom(point.value) !== null);
                }
                const maximum = Math.max(1, ...points.map((point) => point.value));
                return <>
                  {sessions.length > 0 && <div className="health-exercise-session-list">
                    {sessions.slice().reverse().map((session, index) => {
                      const values = session.values ?? {};
                      const count = session.repetitions ?? (typeof values.repetitions === "number" ? values.repetitions : null);
                      return (
                        <div className="health-exercise-session-row" key={`${session.sessionId || session.startedAt}-${index}`}>
                          <strong>{session.activityName || "Exercise"}</strong>
                          <span>{formatDate(session.startedAt)}</span>
                          <span>{count == null ? "" : `${count.toLocaleString()} count / reps`}</span>
                        </div>
                      );
                    })}
                  </div>}
                  {points.length > 0 && <div className="health-exercise-trend">
                    <div className="health-admin-subheading"><h4>Recent activity trend · {METRIC_LABELS[trendMetric || "history"]}</h4><span>{sessions.length} sessions</span></div>
                    <div className="health-exercise-trend-bars" role="img" aria-label={`Recent exercise trend for ${METRIC_LABELS[trendMetric || "history"].toLowerCase()}`}>
                      {points.map((point) => <span key={point.key} title={`${new Date(point.label).toLocaleDateString()} · ${point.value}`}><i style={{ height: `${Math.max(6, (point.value / maximum) * 100)}%` }} /><small>{new Date(point.label).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small></span>)}
                    </div>
                  </div>}
                  {!sessions.length && <p className="health-muted">No exercise history is available.</p>}
                </>;
              })()}
            </details>
          </>
        )}
      </section>
      </>
      )}
    </>
  );
}
