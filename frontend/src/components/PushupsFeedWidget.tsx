import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";
import "./pushupsFeedWidget.css";

type MetricId = "repetitions" | "sets" | "duration" | "heart_rate" | "calories" | "history";
type PushupPublicData = {
  selectedMetrics?: MetricId[];
  latestSession?: { startedAt: string; values: Record<string, unknown> } | null;
  sessionCount?: number;
  totalRepetitions?: number;
};
const LABELS: Record<MetricId, string> = {
  repetitions: "REPS", sets: "SETS", duration: "DURATION", heart_rate: "HEART RATE", calories: "CALORIES", history: "HISTORY",
};
function durationText(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
function valueFor(id: MetricId, values: Record<string, unknown>): string {
  if (id === "repetitions") return typeof values.repetitions === "number" ? `${values.repetitions.toLocaleString()} reps` : "—";
  if (id === "sets") return Array.isArray(values.sets) && values.sets.every((item) => typeof item === "number") ? `${values.sets.join(" + ")} reps` : "—";
  if (id === "duration") return durationText(values.durationSeconds);
  if (id === "calories") return typeof values.calories === "number" ? `${values.calories.toFixed(1)} kcal` : "—";
  if (id === "heart_rate") {
    const hr = values.heartRate as { average?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
    return hr && typeof hr.average === "number" ? `${Math.round(hr.average)} avg · ${typeof hr.minimum === "number" ? Math.round(hr.minimum) : "—"}–${typeof hr.maximum === "number" ? Math.round(hr.maximum) : "—"} BPM` : "—";
  }
  const history = values.history as { sessionCount?: unknown; totalRepetitions?: unknown } | undefined;
  return history && typeof history.sessionCount === "number" ? `${history.sessionCount} sessions · ${typeof history.totalRepetitions === "number" ? history.totalRepetitions.toLocaleString() : 0} reps` : "—";
}
export default function PushupsFeedWidget() {
  const [data, setData] = useState<PushupPublicData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE_URL}/api/health/pushups/public`, { credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Push-up widget request failed (${response.status})`);
        return response.json() as Promise<PushupPublicData>;
      })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => { console.warn("Could not load public push-up widget:", reason); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const selected = (data?.selectedMetrics || []).slice(0, 3);
  if (loaded && !selected.length) return null;
  const values = data?.latestSession?.values || {};
  return (
    <aside className="blog-feed-pushups-widget" aria-label="Push-up summary">
      <div className="blog-feed-pushups-heading">
        <span className="blog-feed-pushups-icon" aria-hidden="true">↗</span>
        <div><span className="blog-feed-pushups-eyebrow">EXERCISE</span><strong>Push-ups</strong></div>
      </div>
      {!loaded ? <p className="blog-feed-pushups-empty">Loading…</p> : !data?.latestSession ? <p className="blog-feed-pushups-empty">No push-up session available.</p> : (
        <>
          <p className="blog-feed-pushups-date">{new Date(data.latestSession.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
          <div className="blog-feed-pushups-metrics">
            {selected.map((id) => <div className="blog-feed-pushups-metric" key={id}><span>{LABELS[id]}</span><strong>{valueFor(id, values)}</strong></div>)}
          </div>
        </>
      )}
    </aside>
  );
}
