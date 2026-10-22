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
type SleepDay = {
  day: string;
  minutes: number;
  efficiency?: number | null;
  score?: number | null;
};
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
  latestSession?: {
    startedAt: string;
    exerciseType?: number;
    activityName?: string;
    values: Record<string, unknown>;
  } | null;
  recentSessions?: ExerciseSession[];
  sessionCount?: number;
  totalRepetitions?: number;
};

const EXERCISE_TYPE_LABELS: Record<number, string> = {
  1001: "Walking",
  1002: "Running",
  10004: "Push-ups",
  10005: "Pull-ups",
  10006: "Sit-ups",
  10007: "Circuit training",
  10008: "Mountain climbers",
  10009: "Jumping jacks",
  10010: "Burpees",
  10011: "Bench press",
  10012: "Squats",
  10013: "Lunges",
  10014: "Leg presses",
  10015: "Leg extensions",
  10016: "Leg curls",
  10017: "Back extensions",
  10018: "Lat pull-downs",
  10019: "Deadlifts",
  10020: "Shoulder presses",
  10021: "Front raises",
  10022: "Lateral raises",
  10023: "Crunches",
  10024: "Leg raises",
  10025: "Plank",
  10026: "Arm curls",
  10027: "Arm extensions",
};

function displayExerciseActivityName(
  session: Pick<ExerciseSession, "exerciseType" | "activityName">,
): string {
  if (
    session.exerciseType != null &&
    EXERCISE_TYPE_LABELS[session.exerciseType]
  ) {
    return EXERCISE_TYPE_LABELS[session.exerciseType];
  }

  const name = (session.activityName || "").trim();
  const generic =
    name.match(/^exercise type\s+(\d+)$/i) || name.match(/^type\s+(\d+)$/i);
  if (generic) {
    const exerciseType = Number(generic[1]);
    return (
      EXERCISE_TYPE_LABELS[exerciseType] ||
      "Other exercise (" + generic[1] + ")"
    );
  }
  return name || "Exercise";
}

const METRIC_LABELS: Record<string, string> = {
  repetitions: "Repetitions / count",
  sets: "Set breakdown",
  duration: "Workout duration",
  heart_rate: "Heart rate",
  calories: "Calories",
  history: "Workout history",
  sleep: "Sleep",
};

function getSessionHeartRate(session: ExerciseSession): {
  average: number | null;
  minimum: number | null;
  maximum: number | null;
} {
  const numeric = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const raw = session.values?.heartRate as
    | { average?: unknown; minimum?: unknown; maximum?: unknown }
    | undefined;
  return {
    average: numeric(session.avgHeartRate) ?? numeric(raw?.average),
    minimum: numeric(session.minHeartRate) ?? numeric(raw?.minimum),
    maximum: numeric(session.maxHeartRate) ?? numeric(raw?.maximum),
  };
}

function metricTrendNumber(
  metricId: string,
  session: ExerciseSession,
): number | null {
  const values = session.values ?? {};
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  if (metricId === "repetitions")
    return numeric(session.repetitions) ?? numeric(values.repetitions);
  if (metricId === "duration")
    return numeric(session.durationSeconds) ?? numeric(values.durationSeconds);
  if (metricId === "calories")
    return numeric(session.calories) ?? numeric(values.calories);
  if (metricId === "heart_rate") {
    const heartRate = values.heartRate as { average?: unknown } | undefined;
    return numeric(session.avgHeartRate) ?? numeric(heartRate?.average);
  }
  if (metricId === "sets") {
    const sets = session.sets?.length
      ? session.sets.map((set) => set.reps)
      : Array.isArray(values.sets)
        ? values.sets.filter(
            (value): value is number => typeof value === "number",
          )
        : [];
    return sets.length ? sets.reduce((sum, value) => sum + value, 0) : null;
  }
  return 1;
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return (
    payload.message || payload.detail || `Request failed (${response.status})`
  );
}

async function fetchHealthSummary(isAdmin: boolean): Promise<HealthSummary> {
  const endpoint = isAdmin
    ? "/api/health/admin/summary"
    : "/api/health/public-summary";
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
  const payload = (await response.json()) as { sleep?: SleepSummary };
  return payload.sleep ?? null;
}

function formatDate(value?: string | null): string {
  if (!value) return "No records yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "No records yet";
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  return hours
    ? `${hours}h ${minutes}m`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDistance(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

function formatSleep(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return `${hours}h ${String(remaining).padStart(2, "0")}m`;
}

export default function HealthAdminPanel({
  isAdmin,
  section,
}: {
  isAdmin: boolean;
  section: HealthPanelSection;
}) {
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
  const [metricsLoading, setMetricsLoading] = useState(
    section === "overview" || section === "running",
  );
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [metricsSaved, setMetricsSaved] = useState(false);
  const [selectedHeartRateSampleKey, setSelectedHeartRateSampleKey] = useState<
    string | null
  >(null);
  const [selectedSleepDayKey, setSelectedSleepDayKey] = useState<string | null>(
    null,
  );
  const [selectedExerciseSessionKey, setSelectedExerciseSessionKey] = useState<
    string | null
  >(null);

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
        const endpoint = isAdmin
          ? "/api/health/exercises/admin/config"
          : "/api/health/exercises/public";
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          credentials: isAdmin ? "include" : "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(
            `Samsung Health metrics request failed (${response.status})`,
          );
        const next = (await response.json()) as SamsungMetricData;
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
      const detail = (
        event as CustomEvent<{ source?: HealthPanelSection | "metrics" }>
      ).detail;
      if (detail?.source !== section) void refresh();
    };
    window.addEventListener("health-data-updated", onHealthDataUpdated);
    return () =>
      window.removeEventListener("health-data-updated", onHealthDataUpdated);
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
      const payload = (await response.json().catch(() => ({}))) as {
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
      } else if (
        /No supported records found|No CSV or JSON files were found/i.test(
          payload.message || "",
        )
      ) {
        // A sleep-only file is valid, but the existing general-purpose importer
        // correctly has no step/run/heart/exercise record to save from it.
        standardImportError =
          payload.message || "No standard activity records were found.";
      } else {
        throw new Error(
          payload.message || `Health import failed (${response.status})`,
        );
      }

      const sleepFiles = selectedFiles.filter(
        (file) => /\.zip$/i.test(file.name) || /sleep/i.test(file.name),
      );
      if (sleepFiles.length) {
        sleepImportAttempted = true;
        const sleepBody = new FormData();
        sleepFiles.forEach((file) =>
          sleepBody.append("files", file, file.name),
        );
        const sleepResponse = await fetch(
          `${API_BASE_URL}/api/health/admin/sleep/import`,
          {
            method: "POST",
            credentials: "include",
            body: sleepBody,
            headers: { Accept: "application/json" },
          },
        );
        const sleepPayload = (await sleepResponse.json().catch(() => ({}))) as {
          message?: string;
          sessionsProcessed?: number;
        };
        if (!sleepResponse.ok)
          sleepImportError =
            sleepPayload.message ||
            `Sleep import failed (${sleepResponse.status})`;
        else
          sleepSessionsProcessed = Number(sleepPayload.sessionsProcessed || 0);
      }

      if (!standardPayload && sleepSessionsProcessed === 0) {
        throw new Error(
          sleepImportError
            ? `${standardImportError || "No standard activity records were imported."} Sleep import: ${sleepImportError}`
            : standardImportError ||
                "No supported Samsung Health records were found in the selected files.",
        );
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
      if (sleepImportAttempted)
        counts.push(`${sleepSessionsProcessed} sleep session(s)`);
      setMessage(`Samsung Health import complete: ${counts.join(", ")}.`);
      if (sleepImportError)
        setError(
          `Other activity data was imported, but sleep import failed: ${sleepImportError}`,
        );
      setFiles([]);
      const input = document.getElementById(
        "health-samsung-files",
      ) as HTMLInputElement | null;
      if (input) input.value = "";
      window.dispatchEvent(
        new CustomEvent("health-data-updated", {
          detail: { source: "metrics" },
        }),
      );
    } catch (reason) {
      const failure =
        reason instanceof Error
          ? reason
          : new Error("Samsung Health import failed.");
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
      const response = await fetch(
        `${API_BASE_URL}/api/health/exercises/admin/config`,
        {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ selectedMetrics: metricSelection }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        selectedMetrics?: string[];
        availableMetrics?: SamsungMetric[];
      };
      if (!response.ok)
        throw new Error(
          payload.message || `Request failed (${response.status})`,
        );
      setMetricSelection(payload.selectedMetrics || []);
      setMetricData((previous) =>
        previous
          ? {
              ...previous,
              selectedMetrics: payload.selectedMetrics || [],
              availableMetrics:
                payload.availableMetrics || previous.availableMetrics,
            }
          : previous,
      );
      setMetricsFailed(false);
      setMetricsSaved(true);
      window.dispatchEvent(
        new CustomEvent("health-data-updated", {
          detail: { source: "metrics" },
        }),
      );
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
  const selectedHeartRateSample =
    recentBpm.find(
      (sample) =>
        `${sample.measuredAt}|${sample.bpm}` === selectedHeartRateSampleKey,
    ) ??
    recentBpm[recentBpm.length - 1] ??
    null;
  const bpmMinimum = bpmValues.length ? Math.min(...bpmValues) : 0;
  const bpmRange = Math.max(
    1,
    (bpmValues.length ? Math.max(...bpmValues) : 1) - bpmMinimum,
  );
  const recentRuns = (summary?.recentRuns || []).slice(0, 5);
  const latestDay =
    recentDays.find((day) => day.day === summary?.steps.date) || null;
  const sleep = summary?.sleep || null;
  const sleepDaysForChart = (sleep?.recentDays || []).slice().reverse();
  const sleepBarsMaximum = Math.max(
    1,
    ...sleepDaysForChart.map((day) => day.minutes),
  );
  const selectedSleepDay =
    sleepDaysForChart.find((day) => day.day === selectedSleepDayKey) ??
    sleepDaysForChart[sleepDaysForChart.length - 1] ??
    null;
  const allExerciseSessions = metricData?.sessions?.length
    ? metricData.sessions
    : metricData?.recentSessions || [];
  const exerciseMetricIds = (metricData?.selectedMetrics || []).filter(
    (id) => id !== "heart_rate",
  );
  const hasExerciseData = Boolean(
    (metricData?.selectedMetrics?.includes("sleep") &&
      (summary?.sleep?.observedNights7d || 0) > 0) ||
    (isAdmin && (metricData?.sessions?.length || metricData?.latestSession)) ||
    (allExerciseSessions.length &&
      exerciseMetricIds.some((id) => id !== "sleep")),
  );
  // Running sessions are stored separately from other exercises by the backend.
  // Merge them here so the heart-rate panel reports every activity with HR data.
  const runningHeartRateSessions: ExerciseSession[] = (
    summary?.recentRuns || []
  ).map((run) => ({
    sessionId: run.sessionId,
    exerciseType: 1002,
    activityName: "Running",
    startedAt: run.startedAt,
    durationSeconds: run.durationSeconds,
    calories: run.calories,
    avgHeartRate: run.avgHeartRate,
    minHeartRate: run.minHeartRate,
    maxHeartRate: run.maxHeartRate,
    values: {
      heartRate: {
        average: run.avgHeartRate,
        minimum: run.minHeartRate,
        maximum: run.maxHeartRate,
      },
    },
  }));
  // The running and general-exercise stores can contain the same workout under
  // different IDs. Collapse matching activity/start times and retain all available BPM fields.
  const heartRateByWorkout: ExerciseSession[] = [];
  const activityKeyFor = (session: ExerciseSession): string => {
    if (
      session.exerciseType === 1002 ||
      /\brun(?:ning)?\b/i.test(session.activityName || "")
    )
      return "running";
    if (session.exerciseType != null) return `type:${session.exerciseType}`;
    return (session.activityName || "exercise")
      .trim()
      .toLocaleLowerCase()
      .replace(/\s+/g, " ");
  };
  for (const session of [...allExerciseSessions, ...runningHeartRateSessions]) {
    const heart = getSessionHeartRate(session);
    if (heart.average == null && heart.minimum == null && heart.maximum == null)
      continue;
    const incomingTime = new Date(session.startedAt).getTime();
    const incomingActivity = activityKeyFor(session);
    const duplicateIndex = heartRateByWorkout.findIndex((existing) => {
      if (
        existing.sessionId &&
        session.sessionId &&
        existing.sessionId === session.sessionId
      )
        return true;
      if (activityKeyFor(existing) !== incomingActivity) return false;
      const existingTime = new Date(existing.startedAt).getTime();
      return (
        Number.isFinite(existingTime) &&
        Number.isFinite(incomingTime) &&
        Math.abs(existingTime - incomingTime) <= 120_000
      );
    });
    if (duplicateIndex < 0) {
      heartRateByWorkout.push(session);
      continue;
    }
    const previous = heartRateByWorkout[duplicateIndex];
    const previousHeart = getSessionHeartRate(previous);
    const mergedHeart = {
      average: previousHeart.average ?? heart.average,
      minimum: previousHeart.minimum ?? heart.minimum,
      maximum: previousHeart.maximum ?? heart.maximum,
    };
    heartRateByWorkout[duplicateIndex] = {
      ...session,
      ...previous,
      sessionId: previous.sessionId || session.sessionId,
      activityName:
        incomingActivity === "running"
          ? "Running"
          : previous.activityName || session.activityName,
      avgHeartRate: mergedHeart.average,
      minHeartRate: mergedHeart.minimum,
      maxHeartRate: mergedHeart.maximum,
      values: {
        ...(session.values || {}),
        ...(previous.values || {}),
        heartRate: mergedHeart,
      },
    };
  }
  const heartMetricSessions = heartRateByWorkout
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 1);

  const hasHeartData = Boolean(
    summary?.latestHeartRate ||
    (summary?.recentHeartRates?.length || 0) > 0 ||
    (metricSelection.includes("heart_rate") && heartMetricSessions.length > 0),
  );

  return (
    <>
      {section === "overview" && (
        <section
          className="account-showcase-section account-health-card health-admin-overview"
          aria-labelledby="health-panel-title"
        >
          <div className="health-panel-heading">
            <div>
              <p className="account-eyebrow">PERSONAL METRICS</p>
            </div>
            <button
              type="button"
              className="showcase-outline-button"
              onClick={() => void refresh()}
              disabled={loading || uploading}
            >
              Refresh
            </button>
          </div>

          {loading && !summary && <AssetStateBox status="loading" compact />}
          {loadFailed && (
            <AssetStateBox
              status="error"
              compact
              onRetry={() => void refresh()}
            />
          )}

          {isAdmin && (
            <form className="health-import-form" onSubmit={importFiles}>
              <input
                id="health-samsung-files"
                type="file"
                multiple
                accept=".zip,.csv,.json,application/zip,application/x-zip-compressed,application/json,text/csv"
                onChange={(event) =>
                  setFiles(Array.from(event.currentTarget.files || []))
                }
                disabled={uploading}
              />
              {files.length > 0 && (
                <p className="health-selected-files">
                  {files.length} file(s) selected:{" "}
                  {files.map((file) => file.name).join(", ")}
                </p>
              )}
              <div className="health-import-actions">
                <button
                  className="showcase-outline-button health-import-button"
                  type="submit"
                  disabled={uploading || files.length === 0}
                >
                  Import selected files
                </button>
                <button
                  className="showcase-outline-button"
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    const input = document.getElementById(
                      "health-samsung-files",
                    ) as HTMLInputElement | null;
                    if (input) input.value = "";
                  }}
                  disabled={uploading || files.length === 0}
                >
                  Clear selection
                </button>
              </div>
              {message && (
                <p className="health-feedback is-success" role="status">
                  {message}
                </p>
              )}
              {error && (
                <p className="health-feedback is-error" role="alert">
                  {error}
                </p>
              )}
              {uploading && <AssetStateBox status="loading" compact />}
              {importFailed && (
                <AssetStateBox
                  status="error"
                  compact
                  onRetry={() => {
                    document
                      .querySelector<HTMLFormElement>(".health-import-form")
                      ?.requestSubmit();
                  }}
                />
              )}
            </form>
          )}

          {isAdmin && (
            <details className="health-metric-settings">
              <summary>Customize metrics</summary>
              <div className="health-metric-settings-body">
                {metricsLoading ? (
                  <AssetStateBox status="loading" compact />
                ) : metricsFailed ? (
                  <AssetStateBox
                    status="error"
                    compact
                    onRetry={() => void refresh()}
                  />
                ) : !metricData?.availableMetrics?.length ? (
                  <p className="health-muted">
                    Import a Samsung Health export first. Available metric
                    options will appear here automatically.
                  </p>
                ) : (
                  <>
                    <div className="health-metric-settings-options">
                      {metricData.availableMetrics.map((metric) => {
                        const checked = metricSelection.includes(metric.id);
                        const disabled =
                          !checked && metricSelection.length >= 3;
                        return (
                          <label
                            className={`health-metric-option ${checked ? "is-selected" : ""}`}
                            key={metric.id}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled || savingMetrics}
                              onChange={(event) => {
                                const isChecked = event.currentTarget.checked;
                                setMetricsSaved(false);
                                setMetricSelection((current) =>
                                  isChecked
                                    ? [
                                        ...current.filter(
                                          (id) => id !== metric.id,
                                        ),
                                        metric.id,
                                      ]
                                    : current.filter((id) => id !== metric.id),
                                );
                              }}
                            />
                            <span>
                              <strong>{metric.label}</strong>
                              <small>{metric.description}</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="health-metric-settings-footer">
                      <span>{metricSelection.length}/3 selected</span>
                      <button
                        type="button"
                        className="showcase-outline-button"
                        onClick={() => void saveMetricSelection()}
                        disabled={savingMetrics || metricSelection.length > 3}
                      >
                        {savingMetrics ? "Saving…" : "Save display"}
                      </button>
                    </div>
                    {metricsSaved && (
                      <p className="health-feedback is-success" role="status">
                        Display preferences saved.
                      </p>
                    )}
                    {metricsFailed && (
                      <AssetStateBox
                        status="error"
                        compact
                        onRetry={() => void saveMetricSelection()}
                      />
                    )}
                  </>
                )}
              </div>
            </details>
          )}

          {isAdmin && (
            <div className="health-last-import">
              {summary?.latestImport ? (
                <>
                  <strong>Last import</strong>
                  <span>
                    {formatDate(summary.latestImport.createdAt)} ·{" "}
                    {summary.latestImport.filenames.length} source file(s)
                  </span>
                </>
              ) : (
                <span>No import history yet.</span>
              )}
            </div>
          )}
        </section>
      )}

      {section === "steps" && (
        <section
          className="account-showcase-section account-health-card health-admin-steps"
          aria-labelledby="health-steps-title"
        >
          <div className="health-column-heading">
            <p className="account-eyebrow">DAILY ACTIVITY</p>
            <h3 id="health-steps-title">Steps and daily activity</h3>
          </div>
          {loading && !summary ? (
            <AssetStateBox status="loading" compact />
          ) : loadFailed && !summary ? (
            <AssetStateBox
              status="error"
              compact
              onRetry={() => void refresh()}
            />
          ) : (
            <>
              <div className="health-metric-grid">
                <article className="health-metric-card">
                  <span>Steps today</span>
                  <strong>
                    {summary?.steps.today == null
                      ? "—"
                      : summary.steps.today.toLocaleString()}
                  </strong>
                  <small>{summary?.steps.date || "Awaiting data"}</small>
                </article>
                <article className="health-metric-card">
                  <span>Average daily steps</span>
                  <strong>
                    {summary?.steps.average7d == null
                      ? "—"
                      : summary.steps.average7d.toLocaleString()}
                  </strong>
                  <small>
                    {summary?.steps.observedDays7d || 0} recorded day(s) in the
                    last 7 days
                  </small>
                </article>
                {(isAdmin || latestDay?.runSteps != null) && (
                  <article className="health-metric-card">
                    <span>Running steps today</span>
                    <strong>
                      {latestDay?.runSteps == null
                        ? "—"
                        : latestDay.runSteps.toLocaleString()}
                    </strong>
                    <small>Recorded running activity</small>
                  </article>
                )}
                {(isAdmin || latestDay?.walkSteps != null) && (
                  <article className="health-metric-card">
                    <span>Walking steps today</span>
                    <strong>
                      {latestDay?.walkSteps == null
                        ? "—"
                        : latestDay.walkSteps.toLocaleString()}
                    </strong>
                    <small>Recorded walking activity</small>
                  </article>
                )}
              </div>

              <div className="health-admin-subsection">
                <div className="health-admin-subheading">
                  <h3>Recent daily steps</h3>
                  <span>Recorded days only</span>
                </div>
                {recentDays.length ? (
                  <div className="health-step-history">
                    {recentDays
                      .slice()
                      .reverse()
                      .map((day) => (
                        <div className="health-step-day" key={day.day}>
                          <span className="health-step-day-date">
                            {new Date(`${day.day}T12:00:00`).toLocaleDateString(
                              undefined,
                              { day: "numeric", month: "short" },
                            )}
                          </span>
                          <span
                            className="health-step-bar"
                            title={`${day.steps.toLocaleString()} steps · ${day.distanceM == null ? "distance unavailable" : formatDistance(day.distanceM)}`}
                          >
                            <span
                              style={{
                                width: `${Math.max(0, Math.min(100, (day.steps / chartMaximum) * 100))}%`,
                              }}
                            />
                          </span>
                          <strong>{day.steps.toLocaleString()}</strong>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="health-muted">No step records imported yet.</p>
                )}
              </div>

              {sleep && (
                <div className="health-admin-subsection health-sleep-section">
                  <div className="health-admin-subheading">
                    <h3>Sleep overview</h3>
                    <span>{sleep.observedNights7d || 0} recorded night(s)</span>
                  </div>
                  <div className="health-sleep-summary-card">
                    <div className="health-sleep-summary-detail">
                      <span>Most recent night</span>
                      <strong>{formatSleep(sleep.lastNightMinutes)}</strong>
                    </div>
                    <div className="health-sleep-summary-detail">
                      <span>7-night average</span>
                      <strong>{formatSleep(sleep.average7dMinutes)}</strong>
                    </div>
                    <div className="health-sleep-summary-detail">
                      <span>Sleep efficiency</span>
                      <strong>
                        {sleep.lastNightEfficiency == null
                          ? "—"
                          : String(
                              Math.round(sleep.lastNightEfficiency * 10) / 10,
                            ) + "%"}
                      </strong>
                    </div>
                    <div className="health-sleep-summary-detail">
                      <span>Sleep score</span>
                      <strong>
                        {sleep.lastNightScore == null
                          ? "—"
                          : String(Math.round(sleep.lastNightScore * 10) / 10) +
                            "/100"}
                      </strong>
                    </div>
                  </div>
                  {sleepDaysForChart.length ? (
                    <>
                      <div
                        className="health-chart-selected-value"
                        aria-live="polite"
                      >
                        {selectedSleepDay ? (
                          <>
                            <strong>
                              {new Date(
                                `${selectedSleepDay.day}T12:00:00`,
                              ).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                              })}
                            </strong>
                            <span>
                              {formatSleep(selectedSleepDay.minutes)}
                              {selectedSleepDay.efficiency == null
                                ? ""
                                : ` · ${Math.round(selectedSleepDay.efficiency * 10) / 10}% efficiency`}
                              {selectedSleepDay.score == null
                                ? ""
                                : ` · score ${Math.round(selectedSleepDay.score * 10) / 10}/100`}
                            </span>
                          </>
                        ) : (
                          <span>Click a bar to inspect a recorded night.</span>
                        )}
                      </div>
                      <div
                        className="health-selectable-bar-chart health-sleep-bar-chart"
                        role="group"
                        aria-label="Recent sleep duration by day"
                      >
                        {sleepDaysForChart.map((day) => {
                          const dateLabel = new Date(
                            `${day.day}T12:00:00`,
                          ).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          });
                          const details = `${dateLabel} · ${formatSleep(day.minutes)}${day.efficiency == null ? "" : ` · ${Math.round(day.efficiency * 10) / 10}% efficiency`}${day.score == null ? "" : ` · score ${Math.round(day.score * 10) / 10}/100`}`;
                          return (
                            <button
                              type="button"
                              key={day.day}
                              className={`health-chart-bar ${selectedSleepDay?.day === day.day ? "is-selected" : ""}`}
                              style={{
                                height: `${Math.max(4, (day.minutes / sleepBarsMaximum) * 100)}%`,
                              }}
                              title={details}
                              aria-label={details}
                              aria-pressed={selectedSleepDay?.day === day.day}
                              onClick={() => setSelectedSleepDayKey(day.day)}
                            />
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              <div className="health-admin-subsection">
                <div className="health-admin-subheading">
                  <h3>Recent running sessions</h3>
                  <span>{recentRuns.length} shown</span>
                </div>
                {recentRuns.length ? (
                  <div className="health-run-list">
                    {recentRuns.map((run) => (
                      <article className="health-run-row" key={run.sessionId}>
                        <div className="health-run-title">
                          <strong>{formatDistance(run.distanceM)} run</strong>
                          <span>{formatDate(run.startedAt)}</span>
                        </div>
                        <div className="health-run-metrics">
                          <span>{formatDuration(run.durationSeconds)}</span>
                          <span>
                            {run.calories == null
                              ? "—"
                              : `${Math.round(run.calories)} kcal`}
                          </span>
                          <span>
                            {run.avgSpeedMps == null
                              ? "—"
                              : `${(run.avgSpeedMps * 3.6).toFixed(1)} km/h avg`}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="health-muted">
                    No running sessions imported yet. Import a Samsung Health
                    export containing running sessions to populate this section.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {section === "running" && (
        <>
          {(isAdmin || hasHeartData) && (
            <section
              className="account-showcase-section account-health-card health-admin-running"
              aria-labelledby="health-running-title"
            >
              <div className="health-column-heading">
                <p className="account-eyebrow">Beats Per minute</p>
              </div>
              {loading && !summary ? (
                <AssetStateBox status="loading" compact />
              ) : loadFailed && !summary ? (
                <AssetStateBox
                  status="error"
                  compact
                  onRetry={() => void refresh()}
                />
              ) : (
                <>
                  <div className="health-admin-subsection health-admin-subsection-first">
                    <div className="health-admin-subheading">
                      <span>{recentBpm.length} samples</span>
                    </div>
                    {recentBpm.length ? (
                      <>
                        {selectedHeartRateSample && (
                          <div
                            className="health-chart-selected-value"
                            aria-live="polite"
                          >
                            <strong>
                              {Math.round(selectedHeartRateSample.bpm)} bpm
                            </strong>
                            <span>
                              {formatDate(selectedHeartRateSample.measuredAt)}
                            </span>
                          </div>
                        )}
                        <div
                          className="health-hr-history-chart"
                          role="group"
                          aria-label={`Recent heart-rate samples, ${Math.min(...bpmValues)} to ${Math.max(...bpmValues)} beats per minute`}
                        >
                          {recentBpm.map((sample, index) => {
                            const key = `${sample.measuredAt}|${sample.bpm}`;
                            return (
                              <button
                                type="button"
                                key={key + ":" + index}
                                className={`health-heart-rate-bar ${selectedHeartRateSampleKey === key || (!selectedHeartRateSampleKey && index === recentBpm.length - 1) ? "is-selected" : ""}`}
                                title={`${Math.round(sample.bpm)} bpm · ${formatDate(sample.measuredAt)}`}
                                aria-label={`${Math.round(sample.bpm)} beats per minute at ${formatDate(sample.measuredAt)}`}
                                aria-pressed={
                                  selectedHeartRateSampleKey === key ||
                                  (!selectedHeartRateSampleKey &&
                                    index === recentBpm.length - 1)
                                }
                                onClick={() =>
                                  setSelectedHeartRateSampleKey(key)
                                }
                                style={{
                                  height: `${15 + ((sample.bpm - bpmMinimum) / bpmRange) * 35}px`,
                                }}
                              />
                            );
                          })}
                        </div>
                        <p className="health-muted">
                          Range: {Math.min(...bpmValues)}–
                          {Math.max(...bpmValues)} bpm. Includes standalone
                          heart-rate records and samples captured during running
                          sessions.
                        </p>
                      </>
                    ) : (
                      <p className="health-muted">
                        No heart-rate samples imported yet.
                      </p>
                    )}
                  </div>
                  {metricSelection.includes("heart_rate") && (
                    <div className="health-admin-subsection">
                      <div className="health-admin-subheading">
                        <h3>Latest exercise-session heart rate</h3>
                      </div>
                      {heartMetricSessions.length ? (
                        <div className="health-run-list">
                          {heartMetricSessions.map((session, index) => (
                            <article
                              className="health-run-row"
                              key={`${session.sessionId || session.startedAt}-${index}`}
                            >
                              <div className="health-run-title">
                                <strong>
                                  {session.activityName || "Exercise"}
                                </strong>
                                <span>{formatDate(session.startedAt)}</span>
                              </div>
                              {(() => {
                                const heart = getSessionHeartRate(session);
                                return (
                                  <div className="health-run-metrics">
                                    <span>
                                      {heart.average == null
                                        ? "—"
                                        : `${Math.round(heart.average)} avg bpm`}
                                    </span>
                                    <span>
                                      {heart.minimum == null
                                        ? "—"
                                        : `${Math.round(heart.minimum)} min`}
                                    </span>
                                    <span>
                                      {heart.maximum == null
                                        ? "—"
                                        : `${Math.round(heart.maximum)} max`}
                                    </span>
                                  </div>
                                );
                              })()}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="health-muted">
                          The selected heart-rate metric has no exercise-session
                          values in the current import.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {(isAdmin || hasExerciseData) && (
            <section
              className="account-showcase-section account-health-card health-admin-exercise"
              aria-labelledby="health-exercise-title"
            >
              <div className="health-column-heading">
                <p className="account-eyebrow">
                  EXERCISE &amp; OTHER ACTIVITIES
                </p>
              </div>
              {metricsLoading ? (
                <AssetStateBox status="loading" compact />
              ) : metricsFailed ? (
                <AssetStateBox
                  status="error"
                  compact
                  onRetry={() => void refresh()}
                />
              ) : !metricData ||
                (!metricData.sessions?.length &&
                  !metricData.recentSessions?.length &&
                  !metricData.latestSession &&
                  !metricData.selectedMetrics?.includes("sleep")) ? (
                <p className="health-muted">
                  Exercise records will appear here after importing a Samsung
                  Health export containing supported exercise activities.
                </p>
              ) : (
                (() => {
                  const rawSessions = (
                    metricData.sessions?.length
                      ? metricData.sessions
                      : metricData.recentSessions || []
                  ).slice(0, 30);
                  const sessionKey = (session: ExerciseSession) =>
                    session.sessionId ||
                    String(session.exerciseType || "") +
                      "|" +
                      session.startedAt +
                      "|" +
                      (session.activityName || "");
                  const uniqueSessions: ExerciseSession[] = [];
                  for (const session of rawSessions) {
                    const duplicateIndex = uniqueSessions.findIndex(
                      (existing) => {
                        if (
                          session.sessionId &&
                          existing.sessionId &&
                          session.sessionId === existing.sessionId
                        )
                          return true;
                        if (
                          displayExerciseActivityName(session) !==
                          displayExerciseActivityName(existing)
                        )
                          return false;
                        const a = new Date(session.startedAt).getTime();
                        const b = new Date(existing.startedAt).getTime();
                        return (
                          Number.isFinite(a) &&
                          Number.isFinite(b) &&
                          Math.abs(a - b) <= 30000
                        );
                      },
                    );
                    if (duplicateIndex < 0) uniqueSessions.push(session);
                    else {
                      const previous = uniqueSessions[duplicateIndex];
                      const previousHeart = getSessionHeartRate(previous);
                      const currentHeart = getSessionHeartRate(session);
                      uniqueSessions[duplicateIndex] = {
                        ...session,
                        ...previous,
                        avgHeartRate:
                          previousHeart.average ?? currentHeart.average,
                        minHeartRate:
                          previousHeart.minimum ?? currentHeart.minimum,
                        maxHeartRate:
                          previousHeart.maximum ?? currentHeart.maximum,
                        values: {
                          ...(session.values || {}),
                          ...(previous.values || {}),
                        },
                      };
                    }
                  }
                  const sessions = uniqueSessions;
                  const selectedMetrics = metricData.selectedMetrics || [];
                  const activityMetricIds = selectedMetrics.filter((id) =>
                    [
                      "repetitions",
                      "sets",
                      "duration",
                      "heart_rate",
                      "calories",
                    ].includes(id),
                  );
                  const trendMetric = activityMetricIds[0] || "repetitions";
                  const valueFor = (
                    session: ExerciseSession,
                    metricId: string,
                  ): string => {
                    const values = session.values || {};
                    const numberValue = (value: unknown): number | null =>
                      typeof value === "number" && Number.isFinite(value)
                        ? value
                        : null;
                    if (metricId === "repetitions") {
                      const value =
                        numberValue(session.repetitions) ??
                        numberValue(values.repetitions);
                      return value == null
                        ? "—"
                        : String(Math.round(value).toLocaleString()) +
                            " reps / count";
                    }
                    if (metricId === "sets") {
                      const ownSets =
                        session.sets?.map((set) => set.reps) || [];
                      const rawSets = Array.isArray(values.sets)
                        ? values.sets.filter(
                            (item): item is number => typeof item === "number",
                          )
                        : [];
                      const sets = ownSets.length ? ownSets : rawSets;
                      return sets.length ? sets.join(" + ") + " reps" : "—";
                    }
                    if (metricId === "duration") {
                      const value =
                        numberValue(session.durationSeconds) ??
                        numberValue(values.durationSeconds);
                      return value == null ? "—" : formatDuration(value);
                    }
                    if (metricId === "calories") {
                      const value =
                        numberValue(session.calories) ??
                        numberValue(values.calories);
                      return value == null ? "—" : value.toFixed(1) + " kcal";
                    }
                    if (metricId === "heart_rate") {
                      const heart = getSessionHeartRate(session);
                      if (
                        heart.average == null &&
                        heart.minimum == null &&
                        heart.maximum == null
                      )
                        return "—";
                      const parts = [];
                      if (heart.average != null)
                        parts.push(String(Math.round(heart.average)) + " avg");
                      if (heart.minimum != null)
                        parts.push(String(Math.round(heart.minimum)) + " min");
                      if (heart.maximum != null)
                        parts.push(String(Math.round(heart.maximum)) + " max");
                      return parts.join(" · ") + " bpm";
                    }
                    return "—";
                  };
                  const metricNumber = (
                    session: ExerciseSession,
                    metricId: string,
                  ): number | null => {
                    if (metricId === "heart_rate")
                      return getSessionHeartRate(session).average;
                    return metricTrendNumber(metricId, session);
                  };
                  const formatBarValue = (value: number | null): string => {
                    if (value == null) return "—";
                    if (trendMetric === "duration")
                      return formatDuration(value);
                    if (trendMetric === "calories")
                      return value.toFixed(1) + " kcal";
                    if (trendMetric === "heart_rate")
                      return String(Math.round(value)) + " bpm";
                    if (trendMetric === "sets")
                      return String(Math.round(value)) + " reps";
                    if (trendMetric === "history") return "1 session";
                    return (
                      String(Math.round(value).toLocaleString()) +
                      " reps / count"
                    );
                  };
                  const groupsByActivity = new Map<string, ExerciseSession[]>();
                  for (const session of sessions) {
                    const label = displayExerciseActivityName(session);
                    const existing = groupsByActivity.get(label) || [];
                    existing.push(session);
                    groupsByActivity.set(label, existing);
                  }
                  const activityGroups = Array.from(groupsByActivity.entries())
                    .map(([name, groupSessions]) => ({
                      name,
                      sessions: groupSessions.sort(
                        (a, b) =>
                          new Date(b.startedAt).getTime() -
                          new Date(a.startedAt).getTime(),
                      ),
                    }))
                    .sort(
                      (a, b) =>
                        new Date(b.sessions[0]?.startedAt || 0).getTime() -
                        new Date(a.sessions[0]?.startedAt || 0).getTime(),
                    );
                  const chartMetric =
                    activityMetricIds[0] ||
                    (sessions.some(
                      (session) => metricNumber(session, "repetitions") != null,
                    )
                      ? "repetitions"
                      : "duration");
                  const showSleep =
                    selectedMetrics.includes("sleep") && Boolean(sleep);
                  return (
                    <>
                      {showSleep && sleep && (
                        <section className="health-activity-group health-sleep-metric-group">
                          <div className="health-activity-group-header">
                            <h3>Sleep</h3>
                            <span>
                              {sleep.observedNights7d || 0} recorded night(s)
                            </span>
                          </div>
                          <div className="health-sleep-summary-card">
                            <div className="health-sleep-summary-detail">
                              <span>Most recent night</span>
                              <strong>
                                {formatSleep(sleep.lastNightMinutes)}
                              </strong>
                            </div>
                            <div className="health-sleep-summary-detail">
                              <span>7-night average</span>
                              <strong>
                                {formatSleep(sleep.average7dMinutes)}
                              </strong>
                            </div>
                            <div className="health-sleep-summary-detail">
                              <span>Sleep efficiency</span>
                              <strong>
                                {sleep.lastNightEfficiency == null
                                  ? "—"
                                  : String(
                                      Math.round(
                                        sleep.lastNightEfficiency * 10,
                                      ) / 10,
                                    ) + "%"}
                              </strong>
                            </div>
                            <div className="health-sleep-summary-detail">
                              <span>Sleep score</span>
                              <strong>
                                {sleep.lastNightScore == null
                                  ? "—"
                                  : String(
                                      Math.round(sleep.lastNightScore * 10) /
                                        10,
                                    ) + "/100"}
                              </strong>
                            </div>
                          </div>
                        </section>
                      )}
                      {activityGroups.length > 0 && (
                        <div className="health-activity-groups">
                          {activityGroups.map((group) => {
                            const groupSessions = group.sessions;
                            const selectedExists =
                              selectedExerciseSessionKey &&
                              groupSessions.some(
                                (session) =>
                                  sessionKey(session) ===
                                  selectedExerciseSessionKey,
                              );
                            const currentSession =
                              groupSessions.find(
                                (session) =>
                                  sessionKey(session) ===
                                  (selectedExists
                                    ? selectedExerciseSessionKey
                                    : sessionKey(groupSessions[0])),
                              ) || groupSessions[0];
                            const selectedSessionKey = currentSession
                              ? sessionKey(currentSession)
                              : "";
                            const chartValues = groupSessions.map((session) =>
                              metricNumber(session, chartMetric),
                            );
                            const chartMaximum = Math.max(
                              1,
                              ...chartValues.filter(
                                (value): value is number => value != null,
                              ),
                            );
                            const selectedDate = currentSession
                              ? formatDate(currentSession.startedAt)
                              : "";
                            const trendValue = currentSession
                              ? metricNumber(currentSession, chartMetric)
                              : null;
                            return (
                              <section
                                className="health-activity-group"
                                key={group.name}
                              >
                                <div className="health-activity-group-header">
                                  <span>{groupSessions.length} session(s)</span>
                                </div>
                                {currentSession && (
                                  <>
                                    <div
                                      className="health-chart-selected-value"
                                      aria-live="polite"
                                    >
                                      <strong>{group.name}</strong>
                                      <span>{selectedDate}</span>
                                    </div>
                                    {activityMetricIds.length > 0 && (
                                      <div className="health-activity-detail-grid">
                                        {activityMetricIds.map((id) => (
                                          <div
                                            className="health-activity-detail"
                                            key={id}
                                          >
                                            <span>
                                              {METRIC_LABELS[id] || id}
                                            </span>
                                            <strong>
                                              {valueFor(currentSession, id)}
                                            </strong>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="health-chart-selected-value">
                                      <span>
                                        Selected bar:{" "}
                                        {formatBarValue(trendValue)}
                                      </span>
                                    </div>
                                    <div
                                      className="health-selectable-bar-chart health-exercise-bar-chart"
                                      role="group"
                                      aria-label={
                                        group.name + " exercise sessions"
                                      }
                                    >
                                      {groupSessions
                                        .slice()
                                        .reverse()
                                        .map((session, index) => {
                                          const key = sessionKey(session);
                                          const value = metricNumber(
                                            session,
                                            chartMetric,
                                          );
                                          const height =
                                            value == null
                                              ? 4
                                              : Math.max(
                                                  4,
                                                  Math.min(
                                                    100,
                                                    (value / chartMaximum) *
                                                      100,
                                                  ),
                                                );
                                          const date = new Date(
                                            session.startedAt,
                                          );
                                          const dateLabel = Number.isFinite(
                                            date.getTime(),
                                          )
                                            ? date.toLocaleDateString(
                                                undefined,
                                                {
                                                  day: "numeric",
                                                  month: "short",
                                                },
                                              )
                                            : "Unknown date";
                                          const details =
                                            group.name +
                                            " · " +
                                            dateLabel +
                                            " · " +
                                            formatBarValue(value);
                                          return (
                                            <button
                                              type="button"
                                              key={key + ":" + index}
                                              className={
                                                "health-chart-bar " +
                                                (selectedSessionKey === key
                                                  ? "is-selected"
                                                  : "")
                                              }
                                              style={{ height: height + "%" }}
                                              title={details}
                                              aria-label={details}
                                              aria-pressed={
                                                selectedSessionKey === key
                                              }
                                              onClick={() =>
                                                setSelectedExerciseSessionKey(
                                                  key,
                                                )
                                              }
                                            />
                                          );
                                        })}
                                    </div>
                                  </>
                                )}
                              </section>
                            );
                          })}
                        </div>
                      )}
                      {!activityGroups.length && !showSleep && (
                        <p className="health-muted">
                          No exercise history is available.
                        </p>
                      )}
                    </>
                  );
                })()
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
