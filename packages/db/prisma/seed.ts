/**
 * Seed: one demo user and two sample reminders.
 * Run with: pnpm db:seed   (idempotent — skips if the demo user exists)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@lifepilot.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: demo user ${email} already exists, nothing to do.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("Demo1234!", 10),
    },
  });

  const inOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  await prisma.reminder.createMany({
    data: [
      {
        userId: user.id,
        title: "Water the plants",
        body: "Monstera and the two ferns on the balcony.",
        dueAt: inOneDay,
        channel: "EMAIL",
        status: "PENDING",
        payload: { subject: "[LifePilot] Water the plants" },
      },
      {
        userId: user.id,
        title: "Renew domain license",
        body: "lifepilot.example expires soon — pay before the grace period.",
        dueAt: inTwoDays,
        channel: "RAZORPAY",
        status: "PENDING",
        payload: { amount: 49900, currency: "INR" },
      },
    ],
  });

  console.log(`Seed: created demo user ${email} (password: Demo1234!) with 2 sample reminders.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
