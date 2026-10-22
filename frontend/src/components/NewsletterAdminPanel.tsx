import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";

type AdminSummary = { subscriberCount?: number };
type TopicsResponse = { topics?: string[] };
type SendResult = {
  sent?: number;
  failed?: number;
  message?: string;
  providerError?: string;
};
type HealthConfig = {
  enabled: boolean;
  steps: { poor: number; target: number };
  reps: { poor: number; target: number };
  sleep: {
    poorLow: number;
    goodLow: number;
    goodHigh: number;
    poorHigh: number;
  };
  bpm: { poorLow: number; goodLow: number; goodHigh: number; poorHigh: number };
};
type HealthRangeMetric = Exclude<keyof HealthConfig, "enabled">;
type HealthConfigResponse = {
  config?: HealthConfig;
  moodImageCounts?: { low?: number; medium?: number; high?: number };
};
const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  enabled: true,
  steps: { poor: 0, target: 10000 },
  reps: { poor: 0, target: 40 },
  sleep: { poorLow: 180, goodLow: 420, goodHigh: 540, poorHigh: 720 },
  bpm: { poorLow: 40, goodLow: 55, goodHigh: 85, poorHigh: 130 },
};

function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

export default function NewsletterAdminPanel() {
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("all");
  const [toDate, setToDate] = useState(() => localDateInput(new Date()));
  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return localDateInput(date);
  });
  const [busy, setBusy] = useState<"export" | "send" | "save-health" | "">("");
  const [healthConfig, setHealthConfig] = useState<HealthConfig>(
    DEFAULT_HEALTH_CONFIG,
  );
  const [moodImageCounts, setMoodImageCounts] = useState({
    low: 0,
    medium: 0,
    high: 0,
  });
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const refreshSummary = async () => {
    const summary = await readJson<AdminSummary>(
      "/api/newsletter/admin/summary",
    );
    setSubscriberCount(Number(summary.subscriberCount || 0));
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readJson<AdminSummary>("/api/newsletter/admin/summary"),
      readJson<TopicsResponse>("/api/newsletter/topics"),
      readJson<HealthConfigResponse>("/api/newsletter/admin/health-config"),
    ])
      .then(([summary, topicsResult, healthResult]) => {
        if (cancelled) return;
        setSubscriberCount(Number(summary.subscriberCount || 0));
        setTopics(
          Array.isArray(topicsResult.topics) ? topicsResult.topics : [],
        );
        setHealthConfig(healthResult.config || DEFAULT_HEALTH_CONFIG);
        setMoodImageCounts({
          low: Number(healthResult.moodImageCounts?.low || 0),
          medium: Number(healthResult.moodImageCounts?.medium || 0),
          high: Number(healthResult.moodImageCounts?.high || 0),
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load newsletter settings.",
          );
          setMessageError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateHealthRange = (
    metric: HealthRangeMetric,
    field: string,
    rawValue: string,
  ) => {
    const value = Number(rawValue);
    setHealthConfig(
      (current) =>
        ({
          ...current,
          [metric]: {
            ...current[metric],
            [field]: Number.isFinite(value) ? value : 0,
          },
        }) as HealthConfig,
    );
  };

  const saveHealthRanges = async () => {
    setBusy("save-health");
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/newsletter/admin/health-config`,
        {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ config: healthConfig }),
        },
      );
      const result = (await response
        .json()
        .catch(() => ({}))) as HealthConfigResponse & {
        message?: string;
        success?: boolean;
      };
      if (!response.ok)
        throw new Error(
          result.message || `Could not save health ranges (${response.status})`,
        );
      if (result.config) setHealthConfig(result.config);
      setMessage(
        "Health score ranges saved. The next newsletter will use them.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save health score ranges.",
      );
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  const rangeField = (
    metric: HealthRangeMetric,
    field: string,
    label: string,
    suffix = "",
  ) => {
    const value = (healthConfig[metric] as unknown as Record<string, number>)[
      field
    ];
    const id = `newsletter-health-${metric}-${field}`;
    return (
      <label className="newsletter-admin-health-field" htmlFor={id} key={id}>
        <span>
          {label}
          {suffix ? ` (${suffix})` : ""}
        </span>
        <input
          id={id}
          className="newsletter-admin-input"
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) =>
            updateHealthRange(metric, field, event.target.value)
          }
        />
      </label>
    );
  };

  const exportCsv = async () => {
    setBusy("export");
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/newsletter/admin/subscribers.csv`,
        {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "text/csv" },
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(
          body.message || `CSV export failed (${response.status})`,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `blogg-newsletter-emails-${localDateInput(new Date())}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("CSV downloaded.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not export the email list.",
      );
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  const sendToAll = async () => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setMessage("Choose a valid date range.");
      setMessageError(true);
      return;
    }
    if (subscriberCount === 0) {
      setMessage("There are no subscribed email addresses yet.");
      setMessageError(true);
      return;
    }
    const topicLabel = topic === "all" ? "all topics" : `topic “${topic}”`;
    if (
      !window.confirm(
        `Send the ${topicLabel} newsletter for ${fromDate} to ${toDate} to ${subscriberCount} subscribers?`,
      )
    )
      return;

    setBusy("send");
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/newsletter/admin/send`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ topic, fromDate, toDate }),
        },
      );
      const result = (await response.json().catch(() => ({}))) as SendResult;
      if (!response.ok && typeof result.sent !== "number") {
        throw new Error(
          result.message ||
            result.providerError ||
            `Newsletter send failed (${response.status})`,
        );
      }
      setMessage(
        `Sent: ${Number(result.sent || 0)} · Failed: ${Number(result.failed || 0)}`,
      );
      setMessageError(Number(result.failed || 0) > 0);
      await refreshSummary();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not send the newsletter.",
      );
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="newsletter-admin-panel"
      aria-labelledby="newsletter-admin-title"
    >
      <div className="newsletter-admin-heading">
        <div>
          <p className="newsletter-admin-eyebrow">ADMIN</p>
          <h2 id="newsletter-admin-title">NEWSLETTER</h2>
        </div>
        <span className="newsletter-admin-count">
          {subscriberCount.toLocaleString()} subscribers
        </span>
      </div>
      <button
        className="newsletter-admin-secondary"
        type="button"
        onClick={() => void exportCsv()}
        disabled={Boolean(busy)}
      >
        {busy === "export" ? "Preparing CSV…" : "Download emails CSV"}
      </button>
      <div className="newsletter-admin-divider" />
      <label
        className="newsletter-admin-label"
        htmlFor="newsletter-admin-topic"
      >
        Topic
      </label>
      <select
        id="newsletter-admin-topic"
        className="newsletter-admin-input"
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
      >
        <option value="all">All topics</option>
        {topics.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <div className="newsletter-admin-dates">
        <div>
          <label
            className="newsletter-admin-label"
            htmlFor="newsletter-admin-from"
          >
            From
          </label>
          <input
            id="newsletter-admin-from"
            className="newsletter-admin-input"
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div>
          <label
            className="newsletter-admin-label"
            htmlFor="newsletter-admin-to"
          >
            To
          </label>
          <input
            id="newsletter-admin-to"
            className="newsletter-admin-input"
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
      </div>
      <button
        className="newsletter-admin-primary"
        type="button"
        onClick={() => void sendToAll()}
        disabled={Boolean(busy)}
      >
        {busy === "send"
          ? "Sending to subscribers…"
          : "Send to all subscribers"}
      </button>
      <div className="newsletter-admin-divider" />
      <section
        className="newsletter-admin-health-config"
        aria-labelledby="newsletter-health-config-title"
      >
        <div className="newsletter-admin-health-heading">
          <div>
            <p className="newsletter-admin-eyebrow">SENDER WIDGET</p>
            <h3 id="newsletter-health-config-title">WELLNESS INDEX RANGES</h3>
          </div>
          <span className="newsletter-admin-health-badge">7-day average</span>
        </div>
        <label className="newsletter-admin-health-enable">
          <input
            type="checkbox"
            checked={healthConfig.enabled}
            onChange={(event) =>
              setHealthConfig((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          <span>
            Include the sender’s health metrics and wellness image in every
            newsletter
          </span>
        </label>
        <div className="newsletter-admin-health-grid">
          <div className="newsletter-admin-health-metric">
            <h4>Average daily steps</h4>

            <div className="newsletter-admin-health-fields">
              {rangeField("steps", "poor", "0-point threshold", "steps/day")}
              {rangeField("steps", "target", "100-point target", "steps/day")}
            </div>
          </div>
          <div className="newsletter-admin-health-metric">
            <h4>Average daily repetitions</h4>

            <div className="newsletter-admin-health-fields">
              {rangeField("reps", "poor", "0-point threshold", "reps/day")}
              {rangeField("reps", "target", "100-point target", "reps/day")}
            </div>
          </div>
          <div className="newsletter-admin-health-metric">
            <h4>Average sleep</h4>

            <div className="newsletter-admin-health-fields">
              {rangeField("sleep", "poorLow", "Poor at/below", "minutes")}
              {rangeField("sleep", "goodLow", "Good from", "minutes")}
              {rangeField("sleep", "goodHigh", "Good through", "minutes")}
              {rangeField("sleep", "poorHigh", "Poor at/above", "minutes")}
            </div>
          </div>
          <div className="newsletter-admin-health-metric">
            <h4>Average recorded BPM</h4>

            <div className="newsletter-admin-health-fields">
              {rangeField("bpm", "poorLow", "Poor at/below", "BPM")}
              {rangeField("bpm", "goodLow", "Good from", "BPM")}
              {rangeField("bpm", "goodHigh", "Good through", "BPM")}
              {rangeField("bpm", "poorHigh", "Poor at/above", "BPM")}
            </div>
          </div>
        </div>
        <div className="newsletter-admin-health-assets">
          <span>LOW images: {moodImageCounts.low}</span>
          <span>MEDIUM images: {moodImageCounts.medium}</span>
          <span>HIGH images: {moodImageCounts.high}</span>
        </div>
        <button
          className="newsletter-admin-secondary"
          type="button"
          onClick={() => void saveHealthRanges()}
          disabled={Boolean(busy)}
        >
          {busy === "save-health" ? "Saving ranges…" : "Save health ranges"}
        </button>
      </section>
      {message && (
        <p
          className={`newsletter-admin-message ${messageError ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </section>
  );
}
