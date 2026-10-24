// UI screenshot evidence for LifePilot rework round 2.
// Usage: NODE_PATH=<global node_modules> node ui-screenshot.mjs <reminderIdPENDING> <reminderIdDELIVERED> <email> <password>
import { chromium } from "playwright";

const [pendingId, deliveredId, email, password] = process.argv.slice(2);
const exe = "C:/Users/Lenovo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();

// login through the real form so tokens are stored by the app itself
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click("button.btn-primary");
await page.waitForTimeout(2500);
console.log("logged in, url:", page.url());

async function shot(path, out) {
  await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
  console.log("saved", out);
}

if (pendingId) await shot(`/reminders/${pendingId}`, "../evidence/20-ui-reminder-PENDING.png");
if (deliveredId) await shot(`/reminders/${deliveredId}`, "../evidence/21-ui-reminder-DELIVERED.png");
await shot(`/reminders`, "../evidence/22-ui-reminders-list.png");

await browser.close();
console.log("DONE ui-screenshots");
