import { bot } from "../..";
import type { DB } from "../../util/db";
import { Util } from "../../util/util";
import { getAllPanels } from "../panel/panel";
import type { Client } from "../types";
import { InlineKeyboard } from "grammy";

type ReminderClient = {
  email: string;
  tgID: string | number;
  remark: string;
  remainingBytes: number | null;
  remainingDays: number | null;
};

async function getExpiringClients(db: DB) {
  const panels = getAllPanels(db);
  const clientsToRemind: ReminderClient[] = [];

  for (const panel of panels) {
    const inbounds = await panel.getInbounds();

    if (inbounds) {
      for (const obj of inbounds.obj) {
        obj.settings.clients.forEach((client: Client) => {
          const stat = obj.clientStats.find(
            (s) => s.uuid === client.id || s.email === client.email,
          );
          const used = (stat?.down ?? 0) + (stat?.up ?? 0);
          const remainingBytes = client.totalGB === 0
            ? null
            : Math.max(0, client.totalGB - used);
          const now = Date.now();
          const remainingDays = client.expiryTime === 0
            ? null
            : Math.max(
                0,
                Math.ceil((client.expiryTime - now) / Util.getUnixTimeOf({ days: 1 })),
              );
          const daysThresholdReached = remainingDays !== null && remainingDays <= 4;
          const volumeThresholdReached = remainingBytes !== null && remainingBytes <= Util.gigsToBytes(4);

          if (client.enable && (daysThresholdReached || volumeThresholdReached)) {
            clientsToRemind.push({
              email: client.email,
              tgID: client.tgId || client.comment,
              remark: obj.remark,
              remainingBytes,
              remainingDays,
            });
          }
        });
      }
    }
  }

  return clientsToRemind;
}

export async function informUserExpiry(db: DB) {
  const clientsToRemind = await getExpiringClients(db);

  for (const client of clientsToRemind) {
    const remainingVolume = client.remainingBytes === null
      ? "نامحدود"
      : `${Util.bytesToGB(client.remainingBytes).toFixed(1)} گیگابایت`;
    const remainingTime = client.remainingDays === null
      ? "بدون تاریخ انقضا"
      : `${client.remainingDays} روز`;

    try {
      await bot.bot.api.sendMessage(
        client.tgID,
        `⚠️ هشدار اشتراک\n\nکانفیگ:\n${client.remark}-${client.email}\n📦 حجم باقی‌مانده: ${remainingVolume}\n⏳ زمان باقی‌مانده: ${remainingTime}\n\nپیشنهاد می‌کنیم قبل از اتمام حجم یا زمان اشتراک، آن را تمدید کنید.`,
        {
          reply_markup: new InlineKeyboard().text("♻️ تمدید اشتراک", "user:renew").primary(),
        },
      );
    } catch (error) {
      console.error(`Failed to send expiry reminder to ${client.tgID}:`, error);
    }
  }
}
