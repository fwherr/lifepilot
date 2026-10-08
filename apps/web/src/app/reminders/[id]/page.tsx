"use client";

import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  getAccessToken,
  Reminder,
} from "@/lib/api";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge badge-pending",
  DELIVERED: "badge badge-ok",
  FAILED: "badge badge-fail",
  CANCELLED: "badge badge-muted",
  SUCCESS: "badge badge-ok",
};

export default function ReminderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getReminder(id);
      setReminder(data.reminder);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load reminder");
    }
  }, [id, router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [getAccessToken, load, router]);

  const onDelete = async () => {
    if (!id || !reminder) return;
    if (!window.confirm(`Delete reminder “${reminder.title}”? Only pending reminders can be deleted.`)) return;
    try {
      await api.deleteReminder(id);
      router.push("/reminders");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadAttachment(id, file);
      setNotice(`Uploaded “${file.name}”`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (error && !reminder) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <button className="btn btn-secondary" onClick={() => router.push("/reminders")}>
          Back to reminders
        </button>
      </div>
    );
  }
  if (!reminder) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <h2>{reminder.title}</h2>
        <div>
          <button className="btn btn-danger" onClick={() => void onDelete()} disabled={reminder.status !== "PENDING"}>
            Delete
          </button>
        </div>
      </div>

      {notice && <p className="form-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      <section className="card">
        <div className="kv">
          <span className="kv-key">Status</span>
          <span className={STATUS_CLASS[reminder.status] ?? "badge"}>{reminder.status}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Channel</span>
          <span className="chip">{reminder.channel}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Due</span>
          <span>{formatWhen(reminder.dueAt)}</span>
        </div>
        {reminder.body && (
          <div className="kv">
            <span className="kv-key">Notes</span>
            <span>{reminder.body}</span>
          </div>
        )}
        <div className="kv">
          <span className="kv-key">Payload</span>
          <pre className="code">{JSON.stringify(reminder.payload, null, 2)}</pre>
        </div>
      </section>

      <h3>Delivery attempts</h3>
      {(!reminder.attempts || reminder.attempts.length === 0) && (
        <p className="muted">
          No attempts yet. The worker delivers at the due time (or immediately if the due time already passed).
        </p>
      )}
      {reminder.attempts && reminder.attempts.length > 0 && (
        <ul className="timeline">
          {reminder.attempts.map((a) => (
            <li key={a.id} className="timeline-item">
              <div className="timeline-head">
                <span className={STATUS_CLASS[a.status] ?? "badge"}>{a.status}</span>
                <span className="chip">{a.channel}</span>
                <span className="muted">{formatWhen(a.createdAt)}</span>
              </div>
              <pre className="code">{JSON.stringify(a.detail, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}

      <h3>Attachments</h3>
      <div className="card">
        <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
          {uploading ? "Uploading…" : "Upload file"}
          <input
            ref={fileInput}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => void onUpload(e)}
            disabled={uploading}
          />
        </label>
        {(!reminder.attachments || reminder.attachments.length === 0) && (
          <p className="muted" style={{ marginTop: 12 }}>
            No attachments yet — upload an invoice, ticket or any reference file (max 10 MB).
          </p>
        )}
        {reminder.attachments && reminder.attachments.length > 0 && (
          <ul className="attachment-list">
            {reminder.attachments.map((att) => (
              <li key={att.id}>
                <span>
                  {att.filename} <span className="muted">({Math.max(1, Math.round(att.sizeBytes / 1024))} KB · {att.contentType})</span>
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void api.downloadAttachment(att).catch((err) => setError(err.message))}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
