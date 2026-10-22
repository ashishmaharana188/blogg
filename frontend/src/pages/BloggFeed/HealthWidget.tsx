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
type ExerciseMetricId =
  | "repetitions"
  | "sets" // Filtered for compatibility with older saved widget settings.
  | "duration"
  | "heart_rate"
  | "calories"
  | "history"
  | "sleep";
type ExerciseDisplayMetricId = Exclude<ExerciseMetricId, "sets" | "sleep">;
type ExerciseSessionSummary = {
  startedAt: string;
  activityName?: string;
  exerciseType?: number;
  values: Record<string, unknown>;
};
type ExercisePublicData = {
  selectedMetrics?: ExerciseMetricId[];
  latestSession?: ExerciseSessionSummary | null;
  recentSessions?: ExerciseSessionSummary[];
  sessionCount?: number;
  totalRepetitions?: number;
};
type ExerciseAggregateData = {
  aggregates?: {
    repetitions?: {
      total: number;
      average: number | null;
      sessionCount: number;
    };
    duration?: {
      totalSeconds: number;
      averageSeconds: number | null;
      sessionCount: number;
    };
    calories?: { total: number; average: number | null; sessionCount: number };
    heart_rate?: {
      average: number | null;
      minimum: number | null;
      maximum: number | null;
      sessionCount: number;
    };
    history?: { sessionCount: number; totalRepetitions: number };
  };
};
type SleepSummary = {
  lastNightMinutes?: number | null;
  average7dMinutes?: number | null;
  observedNights7d?: number;
  lastNightScore?: number | null;
  lastNightEfficiency?: number | null;
  recentDays?: Array<{
    day: string;
    minutes: number;
    efficiency?: number | null;
    score?: number | null;
  }>;
} | null;

const EXERCISE_LABELS: Record<ExerciseDisplayMetricId, string> = {
  repetitions: "TOTAL REPS",
  duration: "WORKOUT DURATION",
  heart_rate: "HEART RATE",
  calories: "TOTAL CALORIES",
  history: "WORKOUT HISTORY",
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDistance(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function formatSleep(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, "0")}m`;
}

function metricValues(
  sessions: ExerciseSessionSummary[],
  id: ExerciseDisplayMetricId,
  aggregate?: ExerciseAggregateData | null,
): string {
  const all = aggregate?.aggregates;
  if (id === "repetitions" && all?.repetitions) {
    const total = Math.round(all.repetitions.total).toLocaleString();
    const average =
      all.repetitions.average == null
        ? "—"
        : Math.round(all.repetitions.average).toLocaleString();
    return `${total} total · ${average} avg`;
  }
  if (id === "duration" && all?.duration) {
    const total = formatDuration(all.duration.totalSeconds);
    const average =
      all.duration.averageSeconds == null
        ? "—"
        : formatDuration(all.duration.averageSeconds);
    return `${total} total · ${average} avg`;
  }
  if (id === "calories" && all?.calories) {
    const total = all.calories.total.toFixed(1);
    const average =
      all.calories.average == null ? "—" : all.calories.average.toFixed(1);
    return `${total} total · ${average} avg kcal`;
  }
  if (id === "heart_rate" && all?.heart_rate) {
    const heart = all.heart_rate;
    if (heart.average == null && heart.minimum == null && heart.maximum == null)
      return "—";
    return `${heart.average == null ? "—" : `${Math.round(heart.average)} avg`} · ${heart.minimum == null ? "—" : Math.round(heart.minimum)}–${heart.maximum == null ? "—" : Math.round(heart.maximum)} BPM`;
  }
  if (id === "history" && all?.history) {
    return `${all.history.sessionCount.toLocaleString()} sessions · ${Math.round(all.history.totalRepetitions).toLocaleString()} total reps`;
  }

  if (id === "repetitions") {
    const values = sessions
      .map((session) => finiteNumber(session.values?.repetitions))
      .filter((value): value is number => value !== null && value >= 0);
    if (!values.length) return "—";
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    return `${Math.round(total).toLocaleString()} total · ${Math.round(average).toLocaleString()} avg`;
  }

  if (id === "duration") {
    const values = sessions
      .map((session) => finiteNumber(session.values?.durationSeconds))
      .filter((value): value is number => value !== null && value >= 0);
    if (!values.length) return "—";
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    return `${formatDuration(total)} total · ${formatDuration(average)} avg`;
  }

  if (id === "calories") {
    const values = sessions
      .map((session) => finiteNumber(session.values?.calories))
      .filter((value): value is number => value !== null && value >= 0);
    if (!values.length) return "—";
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    return `${total.toFixed(1)} total · ${average.toFixed(1)} avg kcal`;
  }

  if (id === "heart_rate") {
    const heartRates = sessions
      .map((session) => {
        const raw = session.values?.heartRate;
        if (!raw || typeof raw !== "object") return null;
        const heart = raw as {
          average?: unknown;
          minimum?: unknown;
          maximum?: unknown;
        };
        return {
          average: finiteNumber(heart.average),
          minimum: finiteNumber(heart.minimum),
          maximum: finiteNumber(heart.maximum),
        };
      })
      .filter(
        (
          value,
        ): value is {
          average: number | null;
          minimum: number | null;
          maximum: number | null;
        } => value !== null,
      );
    const averages = heartRates
      .map((value) => value.average)
      .filter((value): value is number => value !== null);
    const minima = heartRates
      .map((value) => value.minimum)
      .filter((value): value is number => value !== null);
    const maxima = heartRates
      .map((value) => value.maximum)
      .filter((value): value is number => value !== null);
    if (!averages.length && !minima.length && !maxima.length) return "—";
    const average = averages.length
      ? Math.round(
          averages.reduce((sum, value) => sum + value, 0) / averages.length,
        )
      : null;
    const minimum = minima.length ? Math.round(Math.min(...minima)) : null;
    const maximum = maxima.length ? Math.round(Math.max(...maxima)) : null;
    return `${average == null ? "—" : `${average} avg`} · ${minimum == null ? "—" : minimum}–${maximum == null ? "—" : maximum} BPM`;
  }

  const latestHistory = sessions
    .map((session) => session.values?.history)
    .find((value) => Boolean(value) && typeof value === "object") as
    | {
        sessionCount?: unknown;
        totalCount?: unknown;
        totalRepetitions?: unknown;
      }
    | undefined;
  const historyCount = finiteNumber(latestHistory?.sessionCount);
  const historyTotal =
    finiteNumber(latestHistory?.totalCount) ??
    finiteNumber(latestHistory?.totalRepetitions);
  const fallbackReps = sessions
    .map((session) => finiteNumber(session.values?.repetitions))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const count = historyCount ?? sessions.length;
  const reps = historyTotal ?? fallbackReps;
  return count > 0
    ? `${count.toLocaleString()} sessions · ${Math.round(reps).toLocaleString()} total reps`
    : "—";
}

export default function HealthWidget() {
  const [summary, setSummary] = useState<HealthPublicSummary | null>(null);
  const [exerciseData, setExerciseData] = useState<ExercisePublicData | null>(
    null,
  );
  const [exerciseAggregates, setExerciseAggregates] =
    useState<ExerciseAggregateData | null>(null);
  const [sleep, setSleep] = useState<SleepSummary>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exerciseFailed, setExerciseFailed] = useState(false);
  const [sleepFailed, setSleepFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setLoadFailed(false);
    setExerciseFailed(false);
    setExerciseAggregates(null);
    setSleepFailed(false);

    const healthRequest = fetch(`${API_BASE_URL}/api/health/public-summary`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(`Health summary request failed (${response.status})`);
      return response.json() as Promise<HealthPublicSummary>;
    });

    const exerciseRequest = fetch(
      `${API_BASE_URL}/api/health/exercises/public`,
      {
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    ).then(async (response) => {
      if (!response.ok)
        throw new Error(
          `Samsung Health exercise request failed (${response.status})`,
        );
      return response.json() as Promise<ExercisePublicData>;
    });

    // Sleep is a separate backend dataset. The exercise payload intentionally does
    // not contain it, so it must be requested independently for the Feed widget.
    const sleepRequest = fetch(`${API_BASE_URL}/api/health/sleep-summary`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(`Sleep summary request failed (${response.status})`);
      return response.json() as Promise<{ sleep?: SleepSummary }>;
    });

    const [healthResult, exerciseResult, sleepResult] =
      await Promise.allSettled([healthRequest, exerciseRequest, sleepRequest]);

    if (healthResult.status === "fulfilled") setSummary(healthResult.value);
    else {
      reportUiFailure("HealthWidget.loadSummary", healthResult.reason);
      setLoadFailed(true);
    }

    if (exerciseResult.status === "fulfilled") {
      setExerciseData(exerciseResult.value);
      // Fetch all-history sums/averages after the regular endpoint finishes. That
      // first request ensures the exercise/config tables exist before this query.
      try {
        const aggregateResponse = await fetch(
          `${API_BASE_URL}/api/health/exercises/public-aggregate`,
          {
            credentials: "omit",
            cache: "no-store",
            headers: { Accept: "application/json" },
          },
        );
        if (!aggregateResponse.ok)
          throw new Error(
            `Exercise aggregate request failed (${aggregateResponse.status})`,
          );
        setExerciseAggregates(
          (await aggregateResponse.json()) as ExerciseAggregateData,
        );
      } catch (reason) {
        // Keep the widget useful with the recent-session fallback if this newer
        // aggregate endpoint is not deployed yet or is temporarily unavailable.
        reportUiFailure("HealthWidget.loadExerciseAggregates", reason);
        setExerciseAggregates(null);
      }
    } else {
      reportUiFailure(
        "HealthWidget.loadExerciseMetrics",
        exerciseResult.reason,
      );
      setExerciseData(null);
      setExerciseAggregates(null);
      setExerciseFailed(true);
    }

    if (sleepResult.status === "fulfilled")
      setSleep(sleepResult.value.sleep ?? null);
    else {
      reportUiFailure("HealthWidget.loadSleepSummary", sleepResult.reason);
      setSleepFailed(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const onHealthDataUpdated = () => void refresh();
    window.addEventListener("health-data-updated", onHealthDataUpdated);
    return () =>
      window.removeEventListener("health-data-updated", onHealthDataUpdated);
  }, [refresh]);

  const steps = summary?.steps;
  const recentDays = (steps?.recentDays || []).slice().reverse();
  const maxSteps = Math.max(1, ...recentDays.map((day) => day.steps));
  const run = summary?.latestRun;
  const latestBpm = summary?.latestHeartRate?.bpm ?? run?.avgHeartRate ?? null;
  const todayValue = steps?.today;
  const hasHealthRecords =
    todayValue != null || Boolean(run) || Boolean(summary?.latestHeartRate);
  const selectedMetrics = (exerciseData?.selectedMetrics || [])
    .filter((id) => id !== "sets")
    .slice(0, 3);
  const recentSessions = Array.isArray(exerciseData?.recentSessions)
    ? exerciseData.recentSessions
    : [];
  const exerciseMetrics = selectedMetrics.filter(
    (id): id is ExerciseDisplayMetricId => id !== "sleep",
  );
  const allExerciseAggregates = exerciseAggregates?.aggregates;
  const aggregateHasExerciseData = Boolean(
    allExerciseAggregates &&
    Object.values(allExerciseAggregates).some(
      (value) =>
        value &&
        typeof value === "object" &&
        "sessionCount" in value &&
        finiteNumber((value as { sessionCount?: unknown }).sessionCount) !==
          null &&
        finiteNumber((value as { sessionCount?: unknown }).sessionCount)! > 0,
    ),
  );
  const hasExerciseRecords =
    exerciseMetrics.length > 0 &&
    (recentSessions.length > 0 || aggregateHasExerciseData);
  const hasSleepRecords =
    selectedMetrics.includes("sleep") &&
    Boolean(
      sleep && (sleep.observedNights7d || 0) > 0 && sleep.recentDays?.length,
    );
  const hasRecords =
    hasHealthRecords || hasExerciseRecords || selectedMetrics.includes("sleep");
  const totalSessionCount =
    allExerciseAggregates?.history?.sessionCount ??
    finiteNumber(exerciseData?.sessionCount) ??
    recentSessions.length;

  return (
    <aside
      className="blog-feed-health-widget"
      aria-label="Personal metrics, Samsung Health"
    >
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
        <AssetStateBox status="loading" compact />
      ) : !hasRecords &&
        (loadFailed ||
          exerciseFailed ||
          (sleepFailed && selectedMetrics.includes("sleep"))) ? (
        <AssetStateBox status="error" compact onRetry={() => void refresh()} />
      ) : !hasRecords ? (
        <p className="blog-feed-health-empty">No health data imported yet.</p>
      ) : (
        <>
          {loadFailed && (
            <AssetStateBox
              status="error"
              compact
              onRetry={() => void refresh()}
            />
          )}
          {hasHealthRecords && (
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
                  <span className="blog-feed-health-no-bars">
                    No daily history
                  </span>
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

          {exerciseFailed && (
            <AssetStateBox
              status="error"
              compact
              onRetry={() => void refresh()}
            />
          )}
          {hasExerciseRecords && (
            <div className="blog-feed-health-exercises">
              <div className="blog-feed-health-exercise-metrics">
                {exerciseMetrics.map((id) => (
                  <div className="blog-feed-health-exercise-metric" key={id}>
                    <span>{EXERCISE_LABELS[id]}</span>
                    <strong>
                      {metricValues(recentSessions, id, exerciseAggregates)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedMetrics.includes("sleep") && (
            <div className="blog-feed-health-exercises blog-feed-health-sleep">
              {sleepFailed ? (
                <AssetStateBox
                  status="error"
                  compact
                  onRetry={() => void refresh()}
                />
              ) : (
                <div className="blog-feed-health-exercise-metrics">
                  <div className="blog-feed-health-exercise-metric">
                    <span>SLEEP AVG</span>
                    <strong>
                      {hasSleepRecords && sleep
                        ? formatSleep(sleep.average7dMinutes)
                        : "—"}
                    </strong>
                  </div>
                  <div className="blog-feed-health-exercise-metric">
                    <span>SLEEP SCORE</span>
                    <strong>
                      {hasSleepRecords && sleep && sleep.lastNightScore != null
                        ? `${Math.round(sleep.lastNightScore * 10) / 10}/100`
                        : "—"}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
