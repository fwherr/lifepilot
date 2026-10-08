"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  CHANNELS,
  Channel,
  getAccessToken,
  Reminder,
} from "@/lib/api";

function formatDue(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge badge-pending",
  DELIVERED: "badge badge-ok",
  FAILED: "badge badge-fail",
  CANCELLED: "badge badge-muted",
};

export default function RemindersPage() {
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listReminders();
      setReminders(data.reminders);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load reminders");
    }
  }, [router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [getAccessToken, load, router]);

  return (
    <div>
      <div className="page-head">
        <h2>Your reminders</h2>
        <div>
          <button className="btn btn-ghost" onClick={() => void load()}>
            Refresh
          </button>{" "}
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "New reminder"}
          </button>
        </div>
      </div>

      {showForm && (
        <ReminderForm
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}

      {error && <p className="form-error">{error}</p>}
      {reminders === null && !error && <p className="muted">Loading…</p>}

      {reminders && reminders.length === 0 && (
        <p className="muted">
          Nothing here yet — create your first reminder with the button above.
        </p>
      )}

      {reminders && reminders.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Channel</th>
              <th>Due</th>
              <th>Status</th>
              <th>Attempts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reminders.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/reminders/${r.id}`} className="row-title">
                    {r.title}
                  </Link>
                </td>
                <td>
                  <span className="chip">{r.channel}</span>
                </td>
                <td>{formatDue(r.dueAt)}</td>
                <td>
                  <span className={STATUS_CLASS[r.status] ?? "badge"}>{r.status}</span>
                </td>
                <td>{r._count?.attempts ?? 0}</td>
                <td>
                  <Link href={`/reminders/${r.id}`} className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReminderForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [url, setUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (channel === "EMAIL") {
        if (to.trim()) payload.to = to.trim();
        if (subject.trim()) payload.subject = subject.trim();
      } else if (channel === "WEBHOOK") {
        if (!url.trim()) throw new ApiError(0, "A webhook URL is required for the WEBHOOK channel");
        payload.url = url.trim();
      } else if (channel === "WHATSAPP") {
        if (to.trim()) payload.to = to.trim();
      } else if (channel === "AI_AGENT") {
        // prompt optional — leave to adapter default
      } else if (channel === "RAZORPAY") {
        if (amount.trim()) payload.amount = Number(amount);
        if (currency.trim()) payload.currency = currency.trim().toUpperCase();
      }

      await api.createReminder({
        title: title.trim(),
        body: body.trim() || undefined,
        dueAt: new Date(dueAt).toISOString(),
        channel,
        payload,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-card" onSubmit={onSubmit}>
      <h3>New reminder</h3>
      <div className="form-grid">
        <label className="field">
          <span>Title</span>
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renew passport" />
        </label>
        <label className="field">
          <span>Due at</span>
          <input required type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="field">
          <span>Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-wide">
          <span>Notes (optional)</span>
          <input maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything the future-you should know" />
        </label>

        {channel === "EMAIL" && (
          <>
            <label className="field">
              <span>To (optional — defaults to your email)</span>
              <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="someone@example.com" />
            </label>
            <label className="field">
              <span>Subject (optional)</span>
              <input maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
          </>
        )}
        {channel === "WEBHOOK" && (
          <label className="field field-wide">
            <span>Webhook URL (required)</span>
            <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-endpoint/hook" />
          </label>
        )}
        {channel === "WHATSAPP" && (
          <label className="field">
            <span>To (optional)</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+86…" />
          </label>
        )}
        {channel === "RAZORPAY" && (
          <>
            <label className="field">
              <span>Amount (paise, optional)</span>
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="49900" />
            </label>
            <label className="field">
              <span>Currency</span>
              <input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" />
            </label>
          </>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Scheduling…" : "Schedule reminder"}
      </button>
      <p className="muted form-note">
        Tip: a due time in the past fires immediately — handy for testing delivery.
      </p>
    </form>
  );
}
