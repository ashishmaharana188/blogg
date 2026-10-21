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
  activeTimeSeconds?: number | null;
};
type SleepDay = { day: string; minutes: number; efficiency?: number | null; score?: number | null };
type SleepSummary = {
  lastNightMinutes?: number | null;
  average7dMinutes?: number | null;
  observedNights7d?: number;
  lastNightScore?: number | null;
  lastNightEfficiency?: number | null;
  recentDays?: SleepDay[];
} | null;
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
  sleep?: SleepSummary;
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

function getSessionHeartRate(session: ExerciseSession): { average: number | null; minimum: number | null; maximum: number | null } {
  const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const raw = session.values?.heartRate as { average?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
  return {
    average: numeric(session.avgHeartRate) ?? numeric(raw?.average),
    minimum: numeric(session.minHeartRate) ?? numeric(raw?.minimum),
    maximum: numeric(session.maxHeartRate) ?? numeric(raw?.maximum),
  };
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
    const sets = session.sets?.length ? session.sets.map((set) => set.reps) : (Array.isArray(values.sets) ? values.sets.filter((value): value is number => typeof value === "number") : []);
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

async function fetchSleepSummary(): Promise<SleepSummary> {
  const response = await fetch(`${API_BASE_URL}/api/health/sleep-summary`, {
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as { sleep?: SleepSummary };
  return payload.sleep ?? null;
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

function formatSleep(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return `${hours}h ${String(remaining).padStart(2, "0")}m`;
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
      const healthSummary = await fetchHealthSummary(isAdmin);
      let sleepSummary: SleepSummary = null;
      try {
        sleepSummary = await fetchSleepSummary();
      } catch (sleepReason) {
        // Sleep is a separate, optional dataset. Its endpoint must not break the
        // working step/running/BPM panels if it is unavailable.
        reportUiFailure("HealthAdminPanel.loadSleepSummary", sleepReason);
      }
      setSummary({ ...healthSummary, sleep: sleepSummary });
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
      if (detail?.source !== section) void refresh();
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
      setError("Choose at least one Samsung Health export file.");
      setImportFailed(true);
      return;
    }

    const selectedFiles = [...files];
    setUploading(true);
    let standardPayload: {
      message?: string;
      filesProcessed?: number;
      sourceFilesProcessed?: number;
      stepDaysProcessed?: number;
      runSessionsProcessed?: number;
      heartRateSamplesProcessed?: number;
      exerciseSessionsProcessed?: number;
    } | null = null;
    let standardImportError = "";
    let sleepImportError = "";
    let sleepSessionsProcessed = 0;
    let sleepImportAttempted = false;

    try {
      const body = new FormData();
      selectedFiles.forEach((file) => body.append("files", file, file.name));
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
      if (response.ok) {
        standardPayload = payload;
      } else if (/No supported records found|No CSV or JSON files were found/i.test(payload.message || "")) {
        // A sleep-only file is valid, but the existing general-purpose importer
        // correctly has no step/run/heart/exercise record to save from it.
        standardImportError = payload.message || "No standard activity records were found.";
      } else {
        throw new Error(payload.message || `Health import failed (${response.status})`);
      }

      const sleepFiles = selectedFiles.filter((file) => /\.zip$/i.test(file.name) || /sleep/i.test(file.name));
      if (sleepFiles.length) {
        sleepImportAttempted = true;
        const sleepBody = new FormData();
        sleepFiles.forEach((file) => sleepBody.append("files", file, file.name));
        const sleepResponse = await fetch(`${API_BASE_URL}/api/health/admin/sleep/import`, {
          method: "POST",
          credentials: "include",
          body: sleepBody,
          headers: { Accept: "application/json" },
        });
        const sleepPayload = await sleepResponse.json().catch(() => ({})) as { message?: string; sessionsProcessed?: number };
        if (!sleepResponse.ok) sleepImportError = sleepPayload.message || `Sleep import failed (${sleepResponse.status})`;
        else sleepSessionsProcessed = Number(sleepPayload.sessionsProcessed || 0);
      }

      if (!standardPayload && sleepSessionsProcessed === 0) {
        throw new Error(sleepImportError
          ? `${standardImportError || "No standard activity records were imported."} Sleep import: ${sleepImportError}`
          : standardImportError || "No supported Samsung Health records were found in the selected files.");
      }

      const counts: string[] = [];
      if (standardPayload) {
        counts.push(
          `${Number(standardPayload.stepDaysProcessed || 0)} daily step record(s)`,
          `${Number(standardPayload.runSessionsProcessed || 0)} run session(s)`,
          `${Number(standardPayload.heartRateSamplesProcessed || 0)} standalone heart-rate sample(s)`,
          `${Number(standardPayload.exerciseSessionsProcessed || 0)} exercise session(s)`,
        );
      }
      if (sleepImportAttempted) counts.push(`${sleepSessionsProcessed} sleep session(s)`);
      setMessage(`Samsung Health import complete: ${counts.join(", ")}.`);
      if (sleepImportError) setError(`Other activity data was imported, but sleep import failed: ${sleepImportError}`);
      setFiles([]);
      const input = document.getElementById("health-samsung-files") as HTMLInputElement | null;
      if (input) input.value = "";
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "metrics" } }));
    } catch (reason) {
      const failure = reason instanceof Error ? reason : new Error("Samsung Health import failed.");
      reportUiFailure("HealthAdminPanel.import", failure);
      setError(failure.message);
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
  const recentRuns = (summary?.recentRuns || []).slice(0, 5);
  const latestDay = recentDays.find((day) => day.day === summary?.steps.date) || null;
  const sleep = summary?.sleep || null;
  const allExerciseSessions = metricData?.sessions?.length ? metricData.sessions : metricData?.recentSessions || [];
  const exerciseMetricIds = (metricData?.selectedMetrics || []).filter((id) => id !== "heart_rate");
  const exerciseTrendIds = exerciseMetricIds.filter((id) => id !== "history");
  const hasExerciseData = Boolean(
    (isAdmin && (metricData?.sessions?.length || metricData?.latestSession)) ||
    (allExerciseSessions.length && exerciseMetricIds.length > 0)
  );
  const heartMetricSessions = allExerciseSessions.filter((session) => {
    const heart = getSessionHeartRate(session);
    return heart.average != null || heart.minimum != null || heart.maximum != null;
  }).slice(0, 5);
  const hasHeartData = Boolean(
    summary?.latestHeartRate ||
    (summary?.recentHeartRates?.length || 0) > 0 ||
    (metricSelection.includes("heart_rate") && heartMetricSessions.length > 0)
  );

  return (
    <>
      {section === "overview" && (
      <section className="account-showcase-section account-health-card health-admin-overview" aria-labelledby="health-panel-title">
        <div className="health-panel-heading">
          <div>
            <p className="account-eyebrow">PERSONAL METRICS</p>
            <h2 id="health-panel-title">Samsung Health</h2>
            <p>{isAdmin ? "Import selected CSV and JSON files. Re-imports update existing records instead of duplicating them." : "Daily steps, running, exercise and heart-rate summaries."}</p>
          </div>
          <button type="button" className="showcase-outline-button" onClick={() => void refresh()} disabled={loading || uploading}>Refresh</button>
        </div>

        {loading && !summary && <AssetStateBox status="loading" compact />}
        {loadFailed && <AssetStateBox status="error" compact onRetry={() => void refresh()} />}

        {isAdmin && <form className="health-import-form" onSubmit={importFiles}>
          <label htmlFor="health-samsung-files">Samsung Health export files</label>
          <input id="health-samsung-files" type="file" multiple accept=".zip,.csv,.json,application/zip,application/x-zip-compressed,application/json,text/csv" onChange={(event) => setFiles(Array.from(event.currentTarget.files || []))} disabled={uploading} />
          <p className="health-import-hint">Import one Samsung Health ZIP or choose CSV/JSON files individually. Activity, BPM, exercise and sleep records are processed into their own sections.</p>
          {files.length > 0 && <p className="health-selected-files">{files.length} file(s) selected: {files.map((file) => file.name).join(", ")}</p>}
          <div className="health-import-actions">
            <button className="showcase-outline-button health-import-button" type="submit" disabled={uploading || files.length === 0}>Import selected files</button>
            <button className="showcase-outline-button" type="button" onClick={() => { setFiles([]); const input = document.getElementById("health-samsung-files") as HTMLInputElement | null; if (input) input.value = ""; }} disabled={uploading || files.length === 0}>Clear selection</button>
          </div>
          {message && <p className="health-feedback is-success" role="status">{message}</p>}
          {error && <p className="health-feedback is-error" role="alert">{error}</p>}
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
                  <p className="health-metric-settings-hint">Choose up to three fields. Heart-rate selections are shown in the Heart Rate / BPM section; workout count, sets, duration, calories and history are shown in Exercise &amp; Other Activities.</p>
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
                    <button type="button" className="showcase-outline-button" onClick={() => void saveMetricSelection()} disabled={savingMetrics || metricSelection.length > 3}>{savingMetrics ? "Saving…" : "Save display"}</button>
                  </div>
                  {metricsSaved && <p className="health-feedback is-success" role="status">Display preferences saved.</p>}
                  {metricsFailed && <AssetStateBox status="error" compact onRetry={() => void saveMetricSelection()} />}
                </>
              )}
            </div>
          </details>
        )}

        {isAdmin && <div className="health-last-import">
          {summary?.latestImport ? <>
            <strong>Last import</strong>
            <span>{formatDate(summary.latestImport.createdAt)} · {summary.latestImport.filenames.length} source file(s)</span>
            <details><summary>Show imported filenames</summary><ul>{summary.latestImport.filenames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></details>
          </> : <span>No import history yet.</span>}
          {!sleep && <span>Sleep metrics appear after importing a Samsung Health export that includes supported sleep CSV/JSON records.</span>}
        </div>}
      </section>
      )}

      {section === "steps" && (
      <section className="account-showcase-section account-health-card health-admin-steps" aria-labelledby="health-steps-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">DAILY ACTIVITY</p>
          <h3 id="health-steps-title">Steps and daily activity</h3>
        </div>
        {loading && !summary ? <AssetStateBox status="loading" compact /> : loadFailed && !summary ? <AssetStateBox status="error" compact onRetry={() => void refresh()} /> : <>
          <div className="health-metric-grid">
            <article className="health-metric-card">
              <span>Steps today</span>
              <strong>{summary?.steps.today == null ? "—" : summary.steps.today.toLocaleString()}</strong>
              <small>{summary?.steps.date || "Awaiting data"}</small>
            </article>
            <article className="health-metric-card">
              <span>Average daily steps</span>
              <strong>{summary?.steps.average7d == null ? "—" : summary.steps.average7d.toLocaleString()}</strong>
              <small>{summary?.steps.observedDays7d || 0} recorded day(s) in the last 7 days</small>
            </article>
            {(isAdmin || latestDay?.runSteps != null) && <article className="health-metric-card">
              <span>Running steps today</span>
              <strong>{latestDay?.runSteps == null ? "—" : latestDay.runSteps.toLocaleString()}</strong>
              <small>Recorded running activity</small>
            </article>}
            {(isAdmin || latestDay?.walkSteps != null) && <article className="health-metric-card">
              <span>Walking steps today</span>
              <strong>{latestDay?.walkSteps == null ? "—" : latestDay.walkSteps.toLocaleString()}</strong>
              <small>Recorded walking activity</small>
            </article>}
          </div>

          <div className="health-admin-subsection">
            <div className="health-admin-subheading"><h3>Recent daily steps</h3><span>Recorded days only</span></div>
            {recentDays.length ? <div className="health-step-history">
              {recentDays.slice().reverse().map((day) => (
                <div className="health-step-day" key={day.day}>
                  <span className="health-step-day-date">{new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  <span className="health-step-bar" title={`${day.steps.toLocaleString()} steps · ${day.distanceM == null ? "distance unavailable" : formatDistance(day.distanceM)}`}><span style={{ width: `${Math.max(0, Math.min(100, (day.steps / chartMaximum) * 100))}%` }} /></span>
                  <strong>{day.steps.toLocaleString()}</strong>
                </div>
              ))}
            </div> : <p className="health-muted">No step records imported yet.</p>}
          </div>

          {sleep && (
            <div className="health-admin-subsection health-sleep-section">
              <div className="health-admin-subheading"><h3>Sleep overview</h3><span>{sleep.observedNights7d || 0} recorded night(s)</span></div>
              <div className="health-metric-grid">
                <article className="health-metric-card"><span>Most recent night</span><strong>{formatSleep(sleep.lastNightMinutes)}</strong><small>Total recorded sleep interval</small></article>
                <article className="health-metric-card"><span>7-night average</span><strong>{formatSleep(sleep.average7dMinutes)}</strong><small>Recorded nights only</small></article>
                {(sleep.lastNightEfficiency != null || isAdmin) && <article className="health-metric-card"><span>Sleep efficiency</span><strong>{sleep.lastNightEfficiency == null ? "—" : `${Math.round(sleep.lastNightEfficiency * 10) / 10}%`}</strong><small>Most recent recorded night</small></article>}
                {(sleep.lastNightScore != null || isAdmin) && <article className="health-metric-card"><span>Sleep score</span><strong>{sleep.lastNightScore == null ? "—" : `${Math.round(sleep.lastNightScore * 10) / 10}/100`}</strong><small>Most recent recorded night</small></article>}
              </div>
              {sleep.recentDays?.length ? <div className="health-step-history">
                {sleep.recentDays.slice().reverse().map((day) => {
                  const maxMinutes = Math.max(1, ...sleep.recentDays!.map((entry) => entry.minutes));
                  return <div className="health-step-day" key={day.day}>
                    <span className="health-step-day-date">{new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    <span className="health-step-bar" title={`${formatSleep(day.minutes)}${day.efficiency == null ? "" : ` · ${Math.round(day.efficiency * 10) / 10}% efficiency`}${day.score == null ? "" : ` · score ${Math.round(day.score * 10) / 10}`}`}><span style={{ width: `${Math.max(0, Math.min(100, (day.minutes / maxMinutes) * 100))}%` }} /></span>
                    <strong>{formatSleep(day.minutes)}</strong>
                  </div>;
                })}
              </div> : null}
            </div>
          )}

          <div className="health-admin-subsection">
            <div className="health-admin-subheading"><h3>Recent running sessions</h3><span>{recentRuns.length} shown</span></div>
            {recentRuns.length ? <div className="health-run-list">
              {recentRuns.map((run) => (
                <article className="health-run-row" key={run.sessionId}>
                  <div className="health-run-title"><strong>{formatDistance(run.distanceM)} run</strong><span>{formatDate(run.startedAt)}</span></div>
                  <div className="health-run-metrics">
                    <span>{formatDuration(run.durationSeconds)}</span>
                    <span>{run.calories == null ? "—" : `${Math.round(run.calories)} kcal`}</span>
                    <span>{run.avgSpeedMps == null ? "—" : `${(run.avgSpeedMps * 3.6).toFixed(1)} km/h avg`}</span>
                  </div>
                </article>
              ))}
            </div> : <p className="health-muted">No running sessions imported yet. Import a Samsung Health export containing running sessions to populate this section.</p>}
          </div>
        </>}
      </section>
      )}

      {section === "running" && (
      <>
      {(isAdmin || hasHeartData) && <section className="account-showcase-section account-health-card health-admin-running" aria-labelledby="health-running-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">RUNNING AND BPM</p>
          <h3 id="health-running-title">Heart-rate measurements</h3>
        </div>
        {loading && !summary ? <AssetStateBox status="loading" compact /> : loadFailed && !summary ? <AssetStateBox status="error" compact onRetry={() => void refresh()} /> : <>
          <div className="health-admin-subsection health-admin-subsection-first">
            <div className="health-admin-subheading"><h3>Recent BPM samples</h3><span>{recentBpm.length} samples</span></div>
            {recentBpm.length ? <>
              <div className="health-hr-history-chart" role="img" aria-label={`Recent heart-rate samples, ${Math.min(...bpmValues)} to ${Math.max(...bpmValues)} beats per minute`}>
                {recentBpm.map((sample, index) => <span key={`${sample.measuredAt}-${index}`} title={`${Math.round(sample.bpm)} bpm · ${formatDate(sample.measuredAt)}`} style={{ height: `${15 + ((sample.bpm - bpmMinimum) / bpmRange) * 35}px` }} />)}
              </div>
              <p className="health-muted">Range: {Math.min(...bpmValues)}–{Math.max(...bpmValues)} bpm. Includes standalone heart-rate records and samples captured during running sessions.</p>
            </> : <p className="health-muted">No heart-rate samples imported yet.</p>}
          </div>
          {metricSelection.includes("heart_rate") && <div className="health-admin-subsection">
            <div className="health-admin-subheading"><h3>Exercise-session heart rate</h3><span>{heartMetricSessions.length} shown</span></div>
            {heartMetricSessions.length ? <div className="health-run-list">
              {heartMetricSessions.map((session, index) => <article className="health-run-row" key={`${session.sessionId || session.startedAt}-${index}`}>
                <div className="health-run-title"><strong>{session.activityName || "Exercise"}</strong><span>{formatDate(session.startedAt)}</span></div>
                {(() => {
                  const heart = getSessionHeartRate(session);
                  return <div className="health-run-metrics">
                    <span>{heart.average == null ? "—" : `${Math.round(heart.average)} avg bpm`}</span>
                    <span>{heart.minimum == null ? "—" : `${Math.round(heart.minimum)} min`}</span>
                    <span>{heart.maximum == null ? "—" : `${Math.round(heart.maximum)} max`}</span>
                  </div>;
                })()}
              </article>)}
            </div> : <p className="health-muted">The selected heart-rate metric has no exercise-session values in the current import.</p>}
          </div>}
        </>}
      </section>}

      {(isAdmin || hasExerciseData) && <section className="account-showcase-section account-health-card health-admin-exercise" aria-labelledby="health-exercise-title">
        <div className="health-column-heading">
          <p className="account-eyebrow">EXERCISE &amp; OTHER ACTIVITIES</p>
          <h3 id="health-exercise-title">Exercise sessions</h3>
        </div>
        {metricsLoading ? <AssetStateBox status="loading" compact /> : metricsFailed ? (
          <AssetStateBox status="error" compact onRetry={() => void refresh()} />
        ) : !metricData || (!(metricData.sessions?.length) && !(metricData.recentSessions?.length) && !metricData.latestSession) ? (
          <p className="health-muted">Exercise records will appear here after importing a Samsung Health export containing supported exercise activities.</p>
        ) : (() => {
          const sessions = (metricData.sessions?.length ? metricData.sessions : metricData.recentSessions || []).slice(0, 8);
          const latestSession = sessions[0] || metricData.latestSession;
          const trendMetric = exerciseTrendIds[0] || (exerciseMetricIds.includes("history") ? "history" : "repetitions");
          const trendValues = sessions.map((session) => metricTrendNumber(trendMetric, session));
          const trendMaximum = Math.max(1, ...trendValues.filter((value): value is number => value !== null));
          const formatTrend = (value: number | null): string => {
            if (value === null) return "—";
            if (trendMetric === "duration") return formatDuration(value);
            if (trendMetric === "calories") return `${value.toFixed(1)} kcal`;
            if (trendMetric === "history") return "1 session";
            if (trendMetric === "sets") return `${Math.round(value).toLocaleString()} reps`;
            return `${Math.round(value).toLocaleString()} reps / count`;
          };
          return <>
            {exerciseMetricIds.length > 0 && <div className="health-metric-grid">
              {exerciseMetricIds.map((id) => {
                const shown = getMetricValue(id, metricData);
                return <article className="health-metric-card" key={id}>
                  <span>{METRIC_LABELS[id] || id}</span>
                  <strong>{shown.value}</strong>
                  <small>{latestSession ? `${latestSession.activityName || "Latest activity"} · ${formatDate(latestSession.startedAt)}${shown.detail ? ` · ${shown.detail}` : ""}` : (shown.detail || "Latest session")}</small>
                </article>;
              })}
            </div>}
            <div className="health-admin-subsection health-exercise-history">
              <div className="health-admin-subheading"><h3>Recent exercise sessions</h3><span>{sessions.length} shown</span></div>
              {sessions.length ? <div className="health-step-history">
                {sessions.slice().reverse().map((session, index) => {
                  const value = metricTrendNumber(trendMetric, session);
                  const width = value === null ? 0 : Math.max(0, Math.min(100, (value / trendMaximum) * 100));
                  const timestamp = new Date(session.startedAt);
                  const dateLabel = Number.isFinite(timestamp.getTime())
                    ? timestamp.toLocaleDateString(undefined, { day: "numeric", month: "short" })
                    : "Unknown date";
                  const activityLabel = (session.activityName || "Exercise").replace(/^Exercise type /, "Type ");
                  return <div className="health-step-day" key={`${session.sessionId || session.startedAt}-${index}`} aria-label={`${activityLabel}, ${dateLabel}, ${formatTrend(value)}`}>
                    <span className="health-step-day-date" title={`${dateLabel} · ${formatDate(session.startedAt)}`}>{activityLabel}</span>
                    <span className="health-step-bar" title={`${activityLabel} · ${dateLabel} · ${formatTrend(value)}`}><span style={{ width: `${width}%` }} /></span>
                    <strong>{formatTrend(value)}</strong>
                  </div>;
                })}
              </div> : <p className="health-muted">No exercise history is available.</p>}
            </div>
          </>;
        })()}
      </section>}
      </>
      )}
    </>
  );
}
