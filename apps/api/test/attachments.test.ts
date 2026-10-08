import type { FastifyInstance } from "fastify";
import FormData from "form-data";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createFakeDb } from "./helpers/fake-db";
import { createFakeQueue, createFakeS3 } from "./helpers/fakes";

const fakeDb = createFakeDb();
const { queue } = createFakeQueue();
const { s3, puts } = createFakeS3();
let app: FastifyInstance;
let token = "";
let otherToken = "";
let reminderId = "";
let attachmentId = "";

beforeAll(async () => {
  app = await buildApp({ db: fakeDb.db, queue, s3, logger: false });
  token = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "uploader@example.com", password: "password-123" },
    })
  ).json().accessToken;
  otherToken = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "someoneelse@example.com", password: "password-123" },
    })
  ).json().accessToken;
  reminderId = (
    await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "With attachment", dueAt: new Date(Date.now() + 600_000).toISOString(), channel: "EMAIL" },
    })
  ).json().reminder.id;
});

function multipartFor(filename: string, content: string): { payload: Buffer; headers: Record<string, string> } {
  const form = new FormData();
  form.append("file", Buffer.from(content, "utf8"), { filename, contentType: "text/plain" });
  return { payload: form.getBuffer(), headers: form.getHeaders() };
}

describe("attachment routes", () => {
  it("uploads a file to object storage and links it to the reminder", async () => {
    const { payload, headers } = multipartFor("invoice-notes.txt", "hello");
    const res = await app.inject({
      method: "POST",
      url: `/reminders/${reminderId}/attachments`,
      headers: { authorization: `Bearer ${token}`, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const attachment = res.json().attachment;
    expect(attachment.reminderId).toBe(reminderId);
    expect(attachment.filename).toBe("invoice-notes.txt");
    expect(attachment.contentType).toBe("text/plain");
    expect(attachment.sizeBytes).toBe(5);
    attachmentId = attachment.id;

    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toContain(`reminders/${reminderId}/`);
    expect(puts[0]!.body.toString("utf8")).toBe("hello");
  });

  it("serves a short-lived presigned download URL to the owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/attachments/${attachmentId}/download`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("http://fake-s3.local/signed/reminders/");
  });

  it("hides other users' attachments behind 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/attachments/${attachmentId}/download`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s when uploading to someone else's reminder", async () => {
    const { payload, headers } = multipartFor("evil.txt", "nope");
    const res = await app.inject({
      method: "POST",
      url: `/reminders/${reminderId}/attachments`,
      headers: { authorization: `Bearer ${otherToken}`, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it("422s when no file is present in the multipart body", async () => {
    const form = new FormData(); // empty multipart body
    const res = await app.inject({
      method: "POST",
      url: `/reminders/${reminderId}/attachments`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(422);
  });

  it("does not store the raw upload in the database", () => {
    const stored = fakeDb.attachments.find((a) => a.id === attachmentId);
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain("hello");
    expect(stored!.objectKey).toMatch(/^reminders\//);
  });
});
