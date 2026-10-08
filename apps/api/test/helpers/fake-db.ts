import type { PrismaClient } from "@lifepilot/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyRec = Record<string, any>;

/**
 * In-memory fake covering exactly the Prisma calls the API makes, including
 * the `include` shapes (attempts/attachments/_count). Lets route-level tests
 * run with real behaviour and zero infrastructure.
 */
export function createFakeDb() {
  const users: AnyRec[] = [];
  const tokens: AnyRec[] = [];
  const reminders: AnyRec[] = [];
  const attempts: AnyRec[] = [];
  const attachments: AnyRec[] = [];
  let seq = 0;
  const nextId = () => `id_${String(++seq).padStart(4, "0")}`;

  function withReminderIncludes(r: AnyRec, include?: AnyRec): AnyRec {
    const out: AnyRec = { ...r };
    if (include?.attempts) {
      const list = attempts
        .filter((a) => a.reminderId === r.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      out.attempts = include.attempts.take ? list.slice(0, include.attempts.take) : list;
    }
    if (include?.attachments) {
      out.attachments = attachments
        .filter((a) => a.reminderId === r.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    if (include?._count) {
      out._count = {
        attempts: attempts.filter((a) => a.reminderId === r.id).length,
        attachments: attachments.filter((a) => a.reminderId === r.id).length,
      };
    }
    return out;
  }

  const db: any = {
    user: {
      create: async ({ data }: any) => {
        const user = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...data };
        users.push(user);
        return user;
      },
      findUnique: async ({ where }: any) =>
        users.find((u) => (where.email !== undefined ? u.email === where.email : u.id === where.id)) ?? null,
    },
    refreshToken: {
      create: async ({ data }: any) => {
        const t = { id: nextId(), revokedAt: null, createdAt: new Date(), ...data };
        tokens.push(t);
        return t;
      },
      findUnique: async ({ where }: any) => {
        const t = tokens.find((x) => x.tokenHash === where.tokenHash);
        if (!t) return null;
        return { ...t, user: users.find((u) => u.id === t.userId) ?? null };
      },
      update: async ({ where, data }: any) => {
        const t = tokens.find((x) => x.id === where.id);
        if (!t) throw new Error(`token ${where.id} not found`);
        Object.assign(t, data);
        return t;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const t of tokens) {
          if (
            (where.tokenHash === undefined || t.tokenHash === where.tokenHash) &&
            (where.userId === undefined || t.userId === where.userId)
          ) {
            Object.assign(t, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    reminder: {
      create: async ({ data }: any) => {
        const r = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...data };
        reminders.push(r);
        return r;
      },
      findUnique: async ({ where }: any) =>
        reminders.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where, include }: any) => {
        const r = reminders.find((x) => x.id === where.id && x.userId === where.userId);
        return r ? withReminderIncludes(r, include) : null;
      },
      findMany: async ({ where, orderBy, include }: any) => {
        let list = reminders.filter((r) => (where?.userId ? r.userId === where.userId : true));
        if (orderBy?.createdAt === "desc") list = [...list].reverse();
        return list.map((r) => withReminderIncludes(r, include));
      },
      update: async ({ where, data }: any) => {
        const r = reminders.find((x) => x.id === where.id);
        if (!r) throw new Error(`reminder ${where.id} not found`);
        Object.assign(r, data, { updatedAt: new Date() });
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of reminders) {
          if (
            r.id === where.id &&
            (where.userId === undefined || r.userId === where.userId) &&
            (where.status === undefined || r.status === where.status)
          ) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    deliveryAttempt: {
      create: async ({ data }: any) => {
        const a = { id: nextId(), createdAt: new Date(), ...data };
        attempts.push(a);
        return a;
      },
      findMany: async ({ where, orderBy }: any) => {
        let list = attempts.filter((a) => (where?.reminderId ? a.reminderId === where.reminderId : true));
        if (orderBy?.createdAt === "desc") list = [...list].reverse();
        return list;
      },
    },
    attachment: {
      create: async ({ data }: any) => {
        const a = { id: nextId(), createdAt: new Date(), ...data };
        attachments.push(a);
        return a;
      },
      findFirst: async ({ where }: any) => {
        const a = attachments.find((x) => x.id === where.id);
        if (!a) return null;
        return { ...a, reminder: reminders.find((r) => r.id === a.reminderId) ?? null };
      },
    },
  };

  return {
    db: db as unknown as PrismaClient,
    users,
    tokens,
    reminders,
    attempts,
    attachments,
  };
}
