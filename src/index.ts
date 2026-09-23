import dotenv from "dotenv";
import { db, WHICH_INBOUND, WHICH_PANEL } from "./lib/config";
import { TelBot } from "./lib/bot/bot";
import { ADMIN_ID, formatBytes, getDiskSpace, ownerIds } from "./lib/bot/helpers";
import { CronJob } from "cron";
import { informUserExpiry } from "./lib/bot/remider";

// Load .env before anything reads process.env (bun also auto-loads it).
dotenv.config({ quiet: true });

// Re-exported for backwards compatibility.
export { db, WHICH_INBOUND, WHICH_PANEL };

export const bot = new TelBot(process.env.BOT_TOKEN!, db);

const remider = new CronJob(
  "00 00 22 * * *",
  async function () {
    await informUserExpiry(db);
    console.log("cron job done");
  },
  null,
  true,
  "Asia/Tehran",
);

remider.start();

const LOW_DISK_THRESHOLD = 200 * 1024 * 1024;
let lowDiskAlertSent = false;

async function checkDiskSpaceAlert() {
  try {
    const disk = await getDiskSpace();
    const isLow = disk.freeBytes < LOW_DISK_THRESHOLD;
    if (!isLow) {
      lowDiskAlertSent = false;
      return;
    }
    if (lowDiskAlertSent) return;

    const ownerId = [...ownerIds()][0];
    if (!ownerId) return;
    await bot.bot.api.sendMessage(
      ownerId,
      `⚠️ هشدار فضای دیسک سرور\n\nفضای باقی‌مانده فقط ${formatBytes(disk.freeBytes)} است و کمتر از ۲۰۰ مگابایت شده است.`,
    );
    lowDiskAlertSent = true;
  } catch (error) {
    console.error("Disk space alert check failed:", error);
  }
}

const diskSpaceReminder = new CronJob(
  "00 00 */8 * * *",
  async function () {
    await checkDiskSpaceAlert();
  },
  null,
  true,
  "Asia/Tehran",
);

diskSpaceReminder.start();

bot.bot.start();

bot.bot.catch(async (error) => {
  console.log(error);
  await bot.bot.api.sendMessage(
    ADMIN_ID,
    `
مشکلی پیش اومده:
${error.message}`,
  );
});

console.log("Running...");
