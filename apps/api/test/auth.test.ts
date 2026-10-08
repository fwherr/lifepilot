import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createFakeDb } from "./helpers/fake-db";
import { createFakeQueue } from "./helpers/fakes";

const { db, users } = createFakeDb();
const { queue } = createFakeQueue();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ db, queue, logger: false });
});

describe("auth routes", () => {
  it("registers a user, stores a bcrypt hash and returns both tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "alice@example.com", password: "sup3rsecret!" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toMatch(/^[0-9a-f]{96}$/);
  });

  it("hashes passwords — the plaintext is never stored", async () => {
    const stored = users.find((u) => u.email === "alice@example.com");
    expect(stored).toBeDefined();
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored!.passwordHash).not.toContain("sup3rsecret!");
  });

  it("rejects duplicate emails with 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "alice@example.com", password: "another-pass-1" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid payloads with 422", async () => {
    const short = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "bob@example.com", password: "short" },
    });
    expect(short.statusCode).toBe(422);

    const badEmail = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "long-enough-pass" },
    });
    expect(badEmail.statusCode).toBe(422);
  });

  it("logs in with correct credentials and fails with wrong ones", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "alice@example.com", password: "sup3rsecret!" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTypeOf("string");

    const bad = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "alice@example.com", password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);

    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ghost@example.com", password: "whatever-pass" },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it("rotates refresh tokens: old token becomes unusable after refresh", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "alice@example.com", password: "sup3rsecret!" },
    });
    const first = login.json();

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).toBeTypeOf("string");

    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("rejects unknown refresh tokens with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "f".repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the presented refresh token", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "alice@example.com", password: "sup3rsecret!" },
    });
    const { accessToken, refreshToken } = login.json();

    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("protected routes require a valid bearer token", async () => {
    const noToken = await app.inject({ method: "GET", url: "/reminders" });
    expect(noToken.statusCode).toBe(401);

    const badToken = await app.inject({
      method: "GET",
      url: "/reminders",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(badToken.statusCode).toBe(401);
  });
});
