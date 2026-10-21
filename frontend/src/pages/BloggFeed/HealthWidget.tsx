import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../../services/apiBase";
import AssetStateBox from "../../components/AssetStateBox";
import { reportUiFailure } from "../../utils/uiDiagnostics";
import "./healthWidget.css";

type HealthPublicSummary = {
  steps?: {
    date?: string;
    today?: number | null;
    average7d?: number | null;
    observedDays7d?: number;
    recentDays?: Array<{ day: string; steps: number }>;
  };
  latestHeartRate?: { bpm: number } | null;
  latestRun?: {
    durationSeconds: number | null;
    distanceM: number | null;
    avgHeartRate: number | null;
  } | null;
};
type PushupMetricId = "repetitions" | "sets" | "duration" | "heart_rate" | "calories" | "history";
type PushupPublicData = {
  selectedMetrics?: PushupMetricId[];
  latestSession?: { startedAt: string; values: Record<string, unknown> } | null;
};

const PUSHUP_LABELS: Record<PushupMetricId, string> = {
  repetitions: "PUSH-UPS",
  sets: "SETS",
  duration: "WORKOUT TIME",
  heart_rate: "HEART RATE",
  calories: "CALORIES",
  history: "HISTORY",
};

function formatDistance(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatPushupValue(id: PushupMetricId, values: Record<string, unknown>): string {
  if (id === "repetitions") {
    return typeof values.repetitions === "number" ? values.repetitions.toLocaleString() : "—";
  }
  if (id === "sets") {
    return Array.isArray(values.sets) && values.sets.every((item) => typeof item === "number")
      ? values.sets.join(" + ")
      : "—";
  }
  if (id === "duration") {
    const seconds = values.durationSeconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }
  if (id === "calories") {
    return typeof values.calories === "number" ? `${values.calories.toFixed(1)} kcal` : "—";
  }
  if (id === "heart_rate") {
    const hr = values.heartRate as { average?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
    if (!hr || typeof hr.average !== "number") return "—";
    return `${Math.round(hr.average)} avg · ${typeof hr.minimum === "number" ? Math.round(hr.minimum) : "—"}–${typeof hr.maximum === "number" ? Math.round(hr.maximum) : "—"} BPM`;
  }
  const history = values.history as { sessionCount?: unknown; totalRepetitions?: unknown } | undefined;
  return history && typeof history.sessionCount === "number"
    ? `${history.sessionCount} session(s) · ${typeof history.totalRepetitions === "number" ? history.totalRepetitions.toLocaleString() : 0} reps`
    : "—";
}

export default function HealthWidget() {
  const [summary, setSummary] = useState<HealthPublicSummary | null>(null);
  const [pushupData, setPushupData] = useState<PushupPublicData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pushupsFailed, setPushupsFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setLoadFailed(false);
    setPushupsFailed(false);

    const healthRequest = fetch(`${API_BASE_URL}/api/health/public-summary`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Health summary request failed (${response.status})`);
      return response.json() as Promise<HealthPublicSummary>;
    });

    const pushupsRequest = fetch(`${API_BASE_URL}/api/health/pushups/public`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Samsung Health metric request failed (${response.status})`);
      return response.json() as Promise<PushupPublicData>;
    });

    const [healthResult, pushupsResult] = await Promise.allSettled([healthRequest, pushupsRequest]);
    if (healthResult.status === "fulfilled") {
      setSummary(healthResult.value);
    } else {
      reportUiFailure("HealthWidget.loadSummary", healthResult.reason);
      setLoadFailed(true);
    }

    if (pushupsResult.status === "fulfilled") {
      setPushupData(pushupsResult.value);
    } else {
      reportUiFailure("HealthWidget.loadSelectedMetrics", pushupsResult.reason);
      setPushupsFailed(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const steps = summary?.steps;
  const recentDays = (steps?.recentDays || []).slice().reverse();
  const maxSteps = Math.max(1, ...recentDays.map((day) => day.steps));
  const run = summary?.latestRun;
  const latestBpm = summary?.latestHeartRate?.bpm ?? run?.avgHeartRate ?? null;
  const todayValue = steps?.today;
  const hasHealthRecords = todayValue != null || Boolean(run) || Boolean(summary?.latestHeartRate);
  const selectedPushupMetrics = (pushupData?.selectedMetrics || []).slice(0, 3);
  const hasPushupRecords = Boolean(pushupData?.latestSession && selectedPushupMetrics.length);
  const hasRecords = hasHealthRecords || hasPushupRecords;

  return (
    <aside className="blog-feed-health-widget" aria-label="Personal metrics, Samsung Health">
      <div className="blog-feed-health-heading">
        <div>
          <span className="blog-feed-health-eyebrow">PERSONAL METRICS</span>
          <strong>Samsung Health</strong>
        </div>
        <span
          className="blog-feed-health-live-mark"
          title="Imported from Samsung Health"
          aria-label="Imported health data"
        >
          ●
        </span>
      </div>

      {!loaded ? (
        <AssetStateBox status="loading" compact />
      ) : loadFailed ? (
        <AssetStateBox status="error" compact onRetry={() => void refresh()} />
      ) : !hasRecords && !pushupsFailed ? (
        <p className="blog-feed-health-empty">No health data imported yet.</p>
      ) : (
        <>
          {hasHealthRecords && (
            <>
              <div className="blog-feed-health-primary">
                <span>STEPS TODAY</span>
                <strong>{todayValue == null ? "—" : todayValue.toLocaleString()}</strong>
              </div>
              <div className="blog-feed-health-step-chart" role="img" aria-label="Steps by recorded day over the last seven days">
                {recentDays.map((day) => (
                  <span key={day.day} title={`${day.day}: ${day.steps.toLocaleString()} steps`}>
                    <i style={{ height: `${Math.max(3, (day.steps / maxSteps) * 100)}%` }} />
                  </span>
                ))}
                {!recentDays.length && <span className="blog-feed-health-no-bars">No daily history</span>}
              </div>
              <div className="blog-feed-health-secondary">
                <div>
                  <span>7-DAY AVG</span>
                  <strong>{steps?.average7d == null ? "—" : Math.round(steps.average7d).toLocaleString()}</strong>
                </div>
                <div>
                  <span>HEART RATE</span>
                  <strong>{latestBpm == null ? "—" : `${Math.round(latestBpm)} bpm`}</strong>
                  <small>
                    {summary?.latestHeartRate
                      ? "Latest sample"
                      : run?.avgHeartRate != null
                        ? "Latest run average"
                        : "No BPM data"}
                  </small>
                </div>
              </div>
              <div className="blog-feed-health-run">
                <div className="blog-feed-health-run-symbol" aria-hidden="true">↗</div>
                <div>
                  <span>RECENT RUN</span>
                  <strong>{run ? formatDistance(run.distanceM) : "No run recorded"}</strong>
                  <small>
                    {run
                      ? `${formatDuration(run.durationSeconds)} · ${run.avgHeartRate == null ? "BPM unavailable" : `${Math.round(run.avgHeartRate)} avg bpm`}`
                      : "Running sessions appear after import"}
                  </small>
                </div>
              </div>
            </>
          )}

          {pushupsFailed ? (
            <AssetStateBox status="error" compact onRetry={() => void refresh()} />
          ) : hasPushupRecords ? (
            <div className="blog-feed-health-pushups">
              <div className="blog-feed-health-pushups-heading">
                <span>PUSH-UPS</span>
                <time dateTime={pushupData!.latestSession!.startedAt}>
                  {new Date(pushupData!.latestSession!.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </time>
              </div>
              <div className="blog-feed-health-pushup-metrics">
                {selectedPushupMetrics.map((id) => (
                  <div className="blog-feed-health-pushup-metric" key={id}>
                    <span>{PUSHUP_LABELS[id]}</span>
                    <strong>{formatPushupValue(id, pushupData!.latestSession!.values)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : !hasHealthRecords ? (
            <p className="blog-feed-health-empty">No health data imported yet.</p>
          ) : null}
        </>
      )}
    </aside>
  );
}
