import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";

type TopicsResponse = { topics?: string[] };
type ApiMessage = { message?: string; success?: boolean; articleCount?: number };

function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function postNewsletter(path: string, body: Record<string, unknown>): Promise<ApiMessage> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as ApiMessage;
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

export default function NewsletterWidget() {
  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("all");
  const [toDate, setToDate] = useState(() => localDateInput(new Date()));
  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return localDateInput(date);
  });
  const [subscribeWithSend, setSubscribeWithSend] = useState(false);
  const [busy, setBusy] = useState<"send" | "subscribe" | "">("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE_URL}/api/newsletter/topics`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load newsletter topics");
      return await response.json() as TopicsResponse;
    }).then((data) => {
      if (!cancelled) setTopics(Array.isArray(data.topics) ? data.topics : []);
    }).catch(() => {
      if (!cancelled) setTopics([]);
    });
    return () => { cancelled = true; };
  }, []);

  const resetMessage = () => {
    setMessage("");
    setMessageError(false);
  };

  const subscribe = async () => {
    resetMessage();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Enter a valid email address.");
      setMessageError(true);
      return;
    }
    setBusy("subscribe");
    try {
      const result = await postNewsletter("/api/newsletter/subscribe", { email, website: "" });
      setMessage(result.message || "Subscribed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not subscribe.");
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  const sendNewsletter = async () => {
    resetMessage();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Enter a valid email address.");
      setMessageError(true);
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      setMessage("Choose a valid date range.");
      setMessageError(true);
      return;
    }
    setBusy("send");
    try {
      const result = await postNewsletter("/api/newsletter/send", {
        email,
        topic,
        fromDate,
        toDate,
        subscribe: subscribeWithSend,
        website: "",
      });
      setMessage(result.message || "Newsletter sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send newsletter.");
      setMessageError(true);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="blog-feed-newsletter-card" aria-labelledby="blog-feed-newsletter-title">
      <div className="blog-feed-newsletter-heading">
        <span className="blog-feed-newsletter-kicker">BLOGG</span>
        <h2 id="blog-feed-newsletter-title">NEWSLETTER</h2>
      </div>
      <div className="blog-feed-newsletter-fields">
        <div className="blog-feed-newsletter-email-row">
          <div className="blog-feed-newsletter-email-field">
            <label className="blog-feed-newsletter-label" htmlFor="newsletter-email">Email</label>
            <input
              id="newsletter-email"
              className="blog-feed-newsletter-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(event) => { setEmail(event.target.value); resetMessage(); }}
              placeholder="you@example.com"
            />
          </div>
          <button
            className="blog-feed-newsletter-secondary"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void subscribe()}
          >
            {busy === "subscribe" ? "Subscribing…" : "Subscribe"}
          </button>
        </div>

        <div className="blog-feed-newsletter-topic-field">
          <label className="blog-feed-newsletter-label" htmlFor="newsletter-topic">Topic</label>
          <select
            id="newsletter-topic"
            className="blog-feed-newsletter-input"
            value={topic}
            onChange={(event) => { setTopic(event.target.value); resetMessage(); }}
          >
            <option value="all">All topics</option>
            {topics.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="blog-feed-newsletter-dates">
          <div>
            <label className="blog-feed-newsletter-label" htmlFor="newsletter-from-date">From</label>
            <input
              id="newsletter-from-date"
              className="blog-feed-newsletter-input"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => { setFromDate(event.target.value); resetMessage(); }}
            />
          </div>
          <div>
            <label className="blog-feed-newsletter-label" htmlFor="newsletter-to-date">To</label>
            <input
              id="newsletter-to-date"
              className="blog-feed-newsletter-input"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => { setToDate(event.target.value); resetMessage(); }}
            />
          </div>
        </div>

        <label className="blog-feed-newsletter-optin">
          <input
            type="checkbox"
            checked={subscribeWithSend}
            onChange={(event) => setSubscribeWithSend(event.target.checked)}
          />
          <span>Also subscribe this email</span>
        </label>
        <button
          className="blog-feed-newsletter-primary"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void sendNewsletter()}
        >
          {busy === "send" ? "Sending…" : "Send newsletter"}
        </button>
        {message && <p className={`blog-feed-newsletter-message ${messageError ? "is-error" : ""}`} role="status" aria-live="polite">{message}</p>}
        <input className="blog-feed-newsletter-honeypot" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      </div>
    </section>
  );
}
