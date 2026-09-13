import { bot } from "../..";
import type { DB } from "../../util/db";
import { Util } from "../../util/util";
import { getAllPanels } from "../panel/panel";

async function getLowQuotaClients(db: DB) {
  const panels = getAllPanels(db);

  const clientsTraffic: ExpiryCheckUser[] = [];

  for (const panel of panels) {
    const inbounds = await panel.getInbounds();
    const clientsRes = await panel.getClients();
    const trafficByEmail = new Map(
      (clientsRes?.obj ?? []).map((c) => [
        c.email,
        {
          up: c.traffic ? c.traffic.up : (c.up ?? 0),
          down: c.traffic ? c.traffic.down : (c.down ?? 0),
          enable: c.traffic ? c.traffic.enable : c.enable,
        },
      ]),
    );

    if (inbounds) {
      const usersTraffic: ExpiryCheckUser[] = [];

      for (const obj of inbounds.obj) {
        obj.settings.clients.forEach((client) => {
          const stat = obj.clientStats.find(
            (s) => s.uuid === client.id || s.email === client.email,
          );
          const counters = trafficByEmail.get(client.email) ?? {
            up: stat?.up ?? 0,
            down: stat?.down ?? 0,
            enable: stat?.enable ?? client.enable,
          };
          const used = counters.down + counters.up;
          const remainingGB = client.totalGB - used;

          // Subscriptions are time-unlimited: only quota matters.
          if (
            remainingGB <= Util.gigsToBytes(5) &&
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

      if (usersTraffic.length > 0) clientsTraffic.push(...usersTraffic);
    }
  }

  return { clientsTraffic };
}

export async function informUserExpiry(db: DB) {
  const { clientsTraffic } = await getLowQuotaClients(db);

  clientsTraffic.forEach(async (client) => {
    await bot.bot.api.sendMessage(
      client.tgID,
      `
⚠️ کاربر گرامی ⚠️

‼️ از سرویس اشتراک "${client.remark}-${client.email}"
(کمتر از 5 گیگابایت) باقی مانده است.

میتوانید از قسمت "♻️ تمدید اشتراک"
اشتراک خود را تمدید کنید✅
        `,
    );
  });
}
