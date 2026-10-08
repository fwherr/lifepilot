/**
 * Browser-side API client. Stores the JWT pair in localStorage (fine for this
 * skeleton; a production build would move the refresh token into an httpOnly
 * cookie) and transparently refreshes once on a 401.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const ACCESS_KEY = "lifepilot.accessToken";
const REFRESH_KEY = "lifepilot.refreshToken";
const EMAIL_KEY = "lifepilot.email";

export type Channel = "EMAIL" | "WHATSAPP" | "AI_AGENT" | "WEBHOOK" | "RAZORPAY";
export type ReminderStatus = "PENDING" | "DELIVERED" | "FAILED" | "CANCELLED";
export type AttemptStatus = "SUCCESS" | "FAILED";

export interface User {
  id: string;
  email: string;
}
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}
export interface DeliveryAttempt {
  id: string;
  channel: Channel;
  status: AttemptStatus;
  detail: unknown;
  createdAt: string;
}
export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface Reminder {
  id: string;
  title: string;
  body: string | null;
  dueAt: string;
  channel: Channel;
  status: ReminderStatus;
  payload: unknown;
  createdAt: string;
  attempts?: DeliveryAttempt[];
  attachments?: Attachment[];
  _count?: { attempts: number; attachments: number };
}
export interface NewReminderInput {
  title: string;
  body?: string;
  dueAt: string;
  channel: Channel;
  payload?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(EMAIL_KEY);
}

export function setSession(data: AuthResponse): void {
  window.localStorage.setItem(ACCESS_KEY, data.accessToken);
  window.localStorage.setItem(REFRESH_KEY, data.refreshToken);
  window.localStorage.setItem(EMAIL_KEY, data.user.email);
}

export function clearSession(): void {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
}

async function refreshSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const refreshToken = window.localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    setSession(data);
    return true;
  } catch {
    return false;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}, allowRetry = true): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && allowRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch<T>(path, options, false);
    clearSession();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (email: string, password: string) =>
    apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: (refreshToken: string) =>
    apiFetch<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  listReminders: () => apiFetch<{ reminders: Reminder[] }>("/reminders"),

  createReminder: (input: NewReminderInput) =>
    apiFetch<{ reminder: Reminder }>("/reminders", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getReminder: (id: string) => apiFetch<{ reminder: Reminder }>(`/reminders/${id}`),

  deleteReminder: (id: string) =>
    apiFetch<void>(`/reminders/${id}`, { method: "DELETE" }),

  uploadAttachment: (reminderId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ attachment: Attachment }>(`/reminders/${reminderId}/attachments`, {
      method: "POST",
      body: form,
    });
  },

  downloadAttachment: async (attachment: Attachment): Promise<void> => {
    // Authenticated fetch → presigned-URL redirect → blob → save-as.
    const token = getAccessToken();
    const res = await fetch(`${API_URL}/attachments/${attachment.id}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment.filename || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const CHANNELS: Channel[] = ["EMAIL", "WHATSAPP", "AI_AGENT", "WEBHOOK", "RAZORPAY"];
