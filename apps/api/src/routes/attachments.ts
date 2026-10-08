import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "upload.bin";
}

export function registerAttachmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, s3 } = deps;

  app.post("/reminders/:id/attachments", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reminder = await db.reminder.findFirst({ where: { id, userId: req.user.sub } });
    if (!reminder) return reply.code(404).send({ error: "reminder_not_found" });

    const file = await req.file();
    if (!file) return reply.code(422).send({ error: "no_file_provided" });

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_FILE_BYTES) {
      return reply.code(413).send({ error: "file_too_large", maxBytes: MAX_FILE_BYTES });
    }

    const contentType = file.mimetype || "application/octet-stream";
    const objectKey = `reminders/${reminder.id}/${crypto.randomUUID()}-${sanitizeFilename(file.filename)}`;
    await s3.ensureBucket();
    await s3.putObject(objectKey, buffer, contentType);

    const attachment = await db.attachment.create({
      data: {
        reminderId: reminder.id,
        objectKey,
        filename: file.filename,
        contentType,
        sizeBytes: buffer.length,
      },
    });
    return reply.code(201).send({ attachment });
  });

  app.get("/attachments/:id/download", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const attachment = await db.attachment.findFirst({
      where: { id },
      include: { reminder: { select: { userId: true } } },
    });
    if (!attachment || attachment.reminder.userId !== req.user.sub) {
      return reply.code(404).send({ error: "attachment_not_found" });
    }
    const url = await s3.presignDownload(attachment.objectKey, 300);
    return reply.redirect(url, 302);
  });
}
