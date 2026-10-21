import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../../services/apiBase";
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

export default function HealthWidget() {
  const [summary, setSummary] = useState<HealthPublicSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/health/public-summary`,
        {
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok)
        throw new Error(`Health summary request failed (${response.status})`);
      setSummary((await response.json()) as HealthPublicSummary);
    } catch (error) {
      console.warn("Could not load public health summary:", error);
    } finally {
      setLoaded(true);
    }
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
  const hasRecords =
    todayValue != null || Boolean(run) || Boolean(summary?.latestHeartRate);

  return (
    <aside className="blog-feed-health-widget" aria-label="Health summary">
      <div className="blog-feed-health-heading">
        <span
          className="blog-feed-health-live-mark"
          title="Imported from Samsung Health"
          aria-label="Imported health data"
        >
          ●
        </span>
      </div>

      {!loaded ? (
        <p className="blog-feed-health-empty">Loading health data…</p>
      ) : !hasRecords ? (
        <p className="blog-feed-health-empty">No health data imported yet.</p>
      ) : (
        <>
          <div className="blog-feed-health-primary">
            <span>STEPS TODAY</span>
            <strong>
              {todayValue == null ? "—" : todayValue.toLocaleString()}
            </strong>
          </div>
          <div
            className="blog-feed-health-step-chart"
            role="img"
            aria-label="Steps by recorded day over the last seven days"
          >
            {recentDays.map((day) => (
              <span
                key={day.day}
                title={`${day.day}: ${day.steps.toLocaleString()} steps`}
              >
                <i
                  style={{
                    height: `${Math.max(3, (day.steps / maxSteps) * 100)}%`,
                  }}
                />
              </span>
            ))}
            {!recentDays.length && (
              <span className="blog-feed-health-no-bars">No daily history</span>
            )}
          </div>
          <div className="blog-feed-health-secondary">
            <div>
              <span>7-DAY AVG</span>
              <strong>
                {steps?.average7d == null
                  ? "—"
                  : Math.round(steps.average7d).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>HEART RATE</span>
              <strong>
                {latestBpm == null ? "—" : `${Math.round(latestBpm)} bpm`}
              </strong>
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
            <div className="blog-feed-health-run-symbol" aria-hidden="true">
              ↗
            </div>
            <div>
              <span>RECENT RUN</span>
              <strong>
                {run ? formatDistance(run.distanceM) : "No run recorded"}
              </strong>
              <small>
                {run
                  ? `${formatDuration(run.durationSeconds)} · ${run.avgHeartRate == null ? "BPM unavailable" : `${Math.round(run.avgHeartRate)} avg bpm`}`
                  : "Running sessions appear after import"}
              </small>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
