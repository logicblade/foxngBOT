import { bot } from "../..";
import type { DB } from "../../util/db";
import { Util } from "../../util/util";
import { getAllPanels } from "../panel/panel";
import type { Client, ExpiryCheckUser } from "../types";

async function getExpiringClients(db: DB) {
  const panels = getAllPanels(db);

  const clientsDate: ExpiryCheckUser[] = [];
  const clientsTraffic: ExpiryCheckUser[] = [];

  for (const panel of panels) {
    const inbounds = await panel.getInbounds();

    if (inbounds) {
      const usersDate: ExpiryCheckUser[] = [];
      const usersTraffic: ExpiryCheckUser[] = [];

      for (const obj of inbounds.obj) {
        obj.settings.clients.forEach((client: Client) => {
          const stat = obj.clientStats.find(
            (s) => s.uuid === client.id || s.email === client.email,
          );
          const used = (stat?.down ?? 0) + (stat?.up ?? 0);
          const remainingGB = client.totalGB - used;
          const now = Date.now();

          if (
            client.expiryTime - now <= Util.getUnixTimeOf({ days: 2 }) &&
            client.expiryTime !== 0 &&
            client.enable
          ) {
            usersDate.push({
              email: client.email,
              tgID: client.tgId || client.comment,
              remark: obj.remark,
            });
          } else if (
            remainingGB <= Util.gigsToBytes(2) &&
            client.totalGB !== 0 &&
            client.enable
          ) {
            usersTraffic.push({
              email: client.email,
              tgID: client.tgId || client.comment,
              remark: obj.remark,
            });
          }
        });
      }

      if (usersDate.length > 0) clientsDate.push(...usersDate);
      if (usersTraffic.length > 0) clientsTraffic.push(...usersTraffic);
    }
  }

  return { clientsDate, clientsTraffic };
}

export async function informUserExpiry(db: DB) {
  const { clientsDate, clientsTraffic } = await getExpiringClients(db);

  clientsDate.forEach(async (client) => {
    await bot.bot.api.sendMessage(
      client.tgID,
      `
⚠️ کاربر گرامی ⚠️

‼️ از سرویس اشتراک "${client.remark}-${client.email}"
(کمتر از 2 روز) باقی مانده است.

میتوانید از قسمت "🔄 تمدید اشتراک" 
اشتراک خود را تمدید کنید✅
        `,
    );
  });

  clientsTraffic.forEach(async (client) => {
    await bot.bot.api.sendMessage(
      client.tgID,
      `
⚠️ کاربر گرامی ⚠️

‼️ از سرویس اشتراک "${client.remark}-${client.email}"
(کمتر از 2 گیگابایت) باقی مانده است.

میتوانید از قسمت "♻️ تمدید اشتراک"
اشتراک خود را تمدید کنید✅
        `,
    );
  });
}
