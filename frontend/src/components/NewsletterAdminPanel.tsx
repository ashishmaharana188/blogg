import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";

type AdminSummary = { subscriberCount?: number };
type TopicsResponse = { topics?: string[] };
type SendResult = { sent?: number; failed?: number; message?: string; providerError?: string };

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
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
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
  const [busy, setBusy] = useState<"export" | "send" | "" >("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const refreshSummary = async () => {
    const summary = await readJson<AdminSummary>("/api/newsletter/admin/summary");
    setSubscriberCount(Number(summary.subscriberCount || 0));
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readJson<AdminSummary>("/api/newsletter/admin/summary"),
      readJson<TopicsResponse>("/api/newsletter/topics"),
    ]).then(([summary, topicsResult]) => {
      if (cancelled) return;
      setSubscriberCount(Number(summary.subscriberCount || 0));
      setTopics(Array.isArray(topicsResult.topics) ? topicsResult.topics : []);
    }).catch((error) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Could not load newsletter settings.");
        setMessageError(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const exportCsv = async () => {
    setBusy("export");
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/newsletter/admin/subscribers.csv`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message || `CSV export failed (${response.status})`);
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
      setMessage(error instanceof Error ? error.message : "Could not export the email list.");
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
    if (!window.confirm(`Send the ${topicLabel} newsletter for ${fromDate} to ${toDate} to ${subscriberCount} subscribers?`)) return;

    setBusy("send");
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/newsletter/admin/send`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ topic, fromDate, toDate }),
      });
      const result = await response.json().catch(() => ({})) as SendResult;
      if (!response.ok && typeof result.sent !== "number") {
        throw new Error(result.message || result.providerError || `Newsletter send failed (${response.status})`);
      }
      setMessage(`Sent: ${Number(result.sent || 0)} · Failed: ${Number(result.failed || 0)}`);
      setMessageError(Number(result.failed || 0) > 0);
      await refreshSummary();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the newsletter.");
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="newsletter-admin-panel" aria-labelledby="newsletter-admin-title">
      <div className="newsletter-admin-heading">
        <div>
          <p className="newsletter-admin-eyebrow">ADMIN</p>
          <h2 id="newsletter-admin-title">NEWSLETTER</h2>
        </div>
        <span className="newsletter-admin-count">{subscriberCount.toLocaleString()} subscribers</span>
      </div>
      <button className="newsletter-admin-secondary" type="button" onClick={() => void exportCsv()} disabled={Boolean(busy)}>
        {busy === "export" ? "Preparing CSV…" : "Download emails CSV"}
      </button>
      <div className="newsletter-admin-divider" />
      <label className="newsletter-admin-label" htmlFor="newsletter-admin-topic">Topic</label>
      <select id="newsletter-admin-topic" className="newsletter-admin-input" value={topic} onChange={(event) => setTopic(event.target.value)}>
        <option value="all">All topics</option>
        {topics.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <div className="newsletter-admin-dates">
        <div>
          <label className="newsletter-admin-label" htmlFor="newsletter-admin-from">From</label>
          <input id="newsletter-admin-from" className="newsletter-admin-input" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
        </div>
        <div>
          <label className="newsletter-admin-label" htmlFor="newsletter-admin-to">To</label>
          <input id="newsletter-admin-to" className="newsletter-admin-input" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
        </div>
      </div>
      <button className="newsletter-admin-primary" type="button" onClick={() => void sendToAll()} disabled={Boolean(busy)}>
        {busy === "send" ? "Sending to subscribers…" : "Send to all subscribers"}
      </button>
      {message && <p className={`newsletter-admin-message ${messageError ? "is-error" : ""}`} role="status" aria-live="polite">{message}</p>}
    </section>
  );
}
