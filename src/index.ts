import dotenv from "dotenv";
import { db, WHICH_INBOUND, WHICH_PANEL } from "./lib/config";
import { TelBot } from "./lib/bot/bot";
import { ADMIN_ID } from "./lib/bot/helpers";
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
