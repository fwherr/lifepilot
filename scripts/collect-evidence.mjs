// Evidence collector for LifePilot criterion 1/3/5 (runtime proof).
// Usage: node collect-evidence.mjs
// Assumes: api on :3001 already running (pnpm dev), compose stack up.
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const API = "http://localhost:3001";
const OUT = "../evidence";
mkdirSync(OUT, { recursive: true });

const stamp = new Date().toISOString();
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

async function j(method, path, body, token, isForm) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

// 1. register
const email = `e2e-${Date.now()}@lifepilot.local`;
const password = "E2e-Passw0rd!2026";
const reg = await j("POST", "/auth/register", { email, password });
log(`[1] POST /auth/register -> ${reg.status} (email=${email})`);
if (reg.status !== 201) { writeFileSync(`${OUT}/api-evidence.log`, lines.join("\n")); throw new Error("register failed: " + JSON.stringify(reg.data)); }
log(`    user.id=${reg.data.user.id} accessToken.len=${reg.data.accessToken.length}`);
writeFileSync(`${OUT}/10-register.json`, JSON.stringify(reg.data, null, 2));
const token = reg.data.accessToken;

// 2. health
const health = await j("GET", "/health");
log(`[2] GET /health -> ${health.status} ${JSON.stringify(health.data)}`);

// 3. create EMAIL reminder due in ~6 seconds
const dueAt = new Date(Date.now() + 6000).toISOString();
const created = await j("POST", "/reminders", {
  title: "E2E email proof (round-2 evidence)",
  body: "Runtime evidence for rework round 2: this reminder must move PENDING to DELIVERED via the BullMQ worker console transport.",
  dueAt,
  channel: "EMAIL",
  payload: { to: email, subject: "[LifePilot] E2E email proof (round-2 evidence)" },
}, token);
log(`[3] POST /reminders -> ${created.status} id=${created.data?.reminder?.id} status=${created.data?.reminder?.status} dueAt=${dueAt}`);
log(`    queued job scheduled (BullMQ delayed job at dueAt)`);
writeFileSync(`${OUT}/11-reminder-created.json`, JSON.stringify(created.data, null, 2));
const rid = created.data.reminder.id;

// 4. capture PENDING immediately
const pend = await j("GET", `/reminders/${rid}`, null, token);
log(`[4] GET /reminders/${rid} -> ${pend.status} status=${pend.data?.reminder?.status} (PENDING captured)`);
writeFileSync(`${OUT}/12-reminder-pending.json`, JSON.stringify(pend.data, null, 2));

// 5. poll until DELIVERED
let final = null;
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await j("GET", `/reminders/${rid}`, null, token);
  log(`    poll#${i + 1} status=${s.data?.reminder?.status}`);
  if (s.data?.reminder?.status === "DELIVERED") { final = s.data; break; }
  if (s.data?.reminder?.status === "FAILED") { final = s.data; break; }
}
if (!final) throw new Error("reminder did not reach terminal state in 50s");
log(`[5] FINAL status=${final.reminder?.status} attempts=${JSON.stringify(final.reminder?.attempts?.length ?? 0)}`);
writeFileSync(`${OUT}/13-reminder-final.json`, JSON.stringify(final, null, 2));

// 5b. create a long-due reminder that stays PENDING (for the UI screenshot)
const dueLater = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const created2 = await j("POST", "/reminders", {
  title: "E2E pending demo (stays PENDING until due)",
  body: "Scheduled 30 minutes ahead so the UI can be screenshot in PENDING state.",
  dueAt: dueLater,
  channel: "EMAIL",
  payload: { to: email, subject: "[LifePilot] E2E pending demo" },
}, token);
log(`[5b] POST /reminders (long-due) -> ${created2.status} id=${created2.data?.reminder?.id} status=${created2.data?.reminder?.status}`);
writeFileSync(`${OUT}/19-reminder-pending-ui.json`, JSON.stringify(created2.data, null, 2));

// 6. upload attachment
const boundary = "----e2eboundary" + Date.now();
const fileContent = `LifePilot E2E attachment proof ${stamp}\nreminder: ${rid}\n`;
const form = [
  `--${boundary}`,
  `Content-Disposition: form-data; name="file"; filename="e2e-proof.txt"`,
  `Content-Type: text/plain`,
  ``,
  fileContent,
  `--${boundary}--`,
  ``,
].join("\r\n");
const up = await fetch(`${API}/reminders/${rid}/attachments`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
  body: form,
});
const upData = await up.json().catch(() => null);
log(`[6] POST /reminders/${rid}/attachments -> ${up.status} attachment.id=${upData?.id}`);
log(`    objectKey=${upData?.objectKey ?? JSON.stringify(upData)}`);
writeFileSync(`${OUT}/14-attachment-upload.json`, JSON.stringify(upData, null, 2));

// 7. presigned download (proves object retrievable from MinIO)
if (upData?.id) {
  const dl = await j("GET", `/attachments/${upData.id}/download`, null, token);
  log(`[7] GET /attachments/${upData.id}/download -> ${dl.status} (302 presigned expected)`);
  const loc = typeof dl.data === "string" ? dl.data : (dl.headers.get?.("location") || JSON.stringify(dl.data));
  log(`    location head: ${String(loc).slice(0, 120)}`);
  writeFileSync(`${OUT}/15-download-redirect.txt`, String(loc));
}

// 8. MinIO object listing via docker exec (mc inside minio container)
try {
  const mcList = execSync(
    `docker exec $(docker compose -f ../lifepilot/docker-compose.yml ps -q minio 2>/dev/null || docker ps -qf name=minio | head -1) sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin >/dev/null 2>&1 && mc ls local/lifepilot-attachments --recursive"`,
    { encoding: "utf8", shell: "bash", timeout: 60000 }
  );
  log(`[8] mc ls local/lifepilot-attachments --recursive:\n${mcList}`);
  writeFileSync(`${OUT}/16-minio-ls.txt`, mcList);
} catch (e) {
  log(`[8] mc listing failed: ${String(e.message).slice(0, 300)}`);
}

writeFileSync(`${OUT}/api-evidence.log`, lines.join("\n"));
log("DONE api-evidence");
