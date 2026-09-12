import dotenv from "dotenv";
import { DB } from "./util/db";
import { TelBot } from "./lib/bot/bot";
import { ADMIN_ID } from "./lib/bot/helpers";
import { CronJob } from "cron";
import { informUserExpiry } from "./lib/bot/remider";

export const WHICH_PANEL = "Tunnel";
export const WHICH_INBOUND = "8";

dotenv.config({ quiet: true });

export const db = new DB();

export const bot = new TelBot(process.env.BOT_TOKEN!, db);

const remider = new CronJob(
  "00 00 15 * * *",
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
