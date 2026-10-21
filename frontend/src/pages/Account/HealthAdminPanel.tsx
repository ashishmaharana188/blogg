import { useCallback, useEffect, useState, type FormEvent } from "react";
import { API_BASE_URL } from "../../services/apiBase";
import AssetStateBox from "../../components/AssetStateBox";
import PushupsAdminPanel from "../../components/PushupsAdminPanel";
import { reportUiFailure } from "../../utils/uiDiagnostics";
import "./healthAdminPanel.css";

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
  }, [isAdmin]);

  useEffect(() => {
    void refresh();

    const onHealthDataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: HealthPanelSection }>).detail;
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
      setError("Choose at least one Samsung Health ZIP, CSV, or JSON file.");
      return;
    }

    const submitImport = async (endpoint: string) => {
      const body = new FormData();
      files.forEach((file) => body.append("files", file, file.name));
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        credentials: "include",
        body,
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      return {
        ok: response.ok,
        status: response.status,
        payload,
        message: typeof payload.message === "string" ? payload.message : `Request failed (${response.status})`,
      };
    };

    setUploading(true);
    try {
      // Keep one Samsung Health file picker. Send the selected export to the
      // existing steps/running/heart-rate importer and to the exercise parser.
      const [healthResult, exerciseResult] = await Promise.all([
        submitImport("/api/health/admin/import"),
        submitImport("/api/health/pushups/admin/import"),
      ]);

      const noGeneralRecords = !healthResult.ok &&
        /No supported records found|No CSV or JSON files were found/i.test(healthResult.message);
      const noPushupRecords = !exerciseResult.ok &&
        /No Push-ups sessions were found|No push-up records were found/i.test(exerciseResult.message);

      const unexpectedFailures = [
        !healthResult.ok && !noGeneralRecords
          ? { source: "SamsungHealth.importMetrics", message: healthResult.message }
          : null,
        !exerciseResult.ok && !noPushupRecords
          ? { source: "SamsungHealth.importExerciseData", message: exerciseResult.message }
          : null,
      ].filter((item): item is { source: string; message: string } => item !== null);

      for (const failure of unexpectedFailures) {
        reportUiFailure(failure.source, new Error(failure.message));
      }

      if ((!healthResult.ok && !noGeneralRecords) || (!exerciseResult.ok && !noPushupRecords)) {
        if (!healthResult.ok && !exerciseResult.ok) {
          throw new Error("The selected Samsung Health export could not be imported.");
        }
      }
      if (!healthResult.ok && !exerciseResult.ok) {
        throw new Error("No supported Samsung Health records were found in the selected files.");
      }

      const counts: string[] = [];
      if (healthResult.ok) {
        const data = healthResult.payload as {
          filesProcessed?: number;
          stepDaysProcessed?: number;
          runSessionsProcessed?: number;
          heartRateSamplesProcessed?: number;
        };
        counts.push(
          `${Number(data.stepDaysProcessed || 0)} daily step record(s)`,
          `${Number(data.runSessionsProcessed || 0)} run session(s)`,
          `${Number(data.heartRateSamplesProcessed || 0)} standalone heart-rate sample(s)`,
        );
      }
      if (exerciseResult.ok) {
        const data = exerciseResult.payload as { sessionsProcessed?: number };
        counts.push(`${Number(data.sessionsProcessed || 0)} push-up session(s)`);
      }
      if (unexpectedFailures.length) {
        setImportFailed(true);
        setMessage(`Import partially completed: ${counts.join(", ")}. Some record types could not be imported.`);
      } else {
        setMessage(`Samsung Health import complete: ${counts.join(", ")}.`);
        setImportFailed(false);
      }

      if (!unexpectedFailures.length) {
        setFiles([]);
        const input = document.getElementById("health-samsung-files") as HTMLInputElement | null;
        if (input) input.value = "";
      }
      window.dispatchEvent(new CustomEvent("health-data-updated", { detail: { source: "overview" } }));
      await refresh();
    } catch (reason) {
      reportUiFailure("HealthAdminPanel.import", reason);
      setImportFailed(true);
    } finally {
      setUploading(false);
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
          <p className="health-import-hint">Choose <strong>activity.day_summary</strong> or <strong>tracker.pedometer_day_summary</strong> for steps; <strong>exercise CSV</strong> plus its matching <strong>live_data JSON</strong> for running/BPM; and <strong>tracker.heart_rate CSV</strong> for standalone heart-rate history. The same export is also scanned for available Push-ups fields. Upload a full ZIP or select files individually.</p>
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

        {isAdmin && <div className="health-last-import">
          {summary?.latestImport ? <>
            <strong>Last import</strong>
            <span>{formatDate(summary.latestImport.createdAt)} · {summary.latestImport.filenames.length} source file(s)</span>
            <details><summary>Show imported filenames</summary><ul>{summary.latestImport.filenames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></details>
          </> : <span>No import history yet.</span>}
        </div>}
        {isAdmin && <PushupsAdminPanel />}
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
      )}
    </>
  );
}
