import { type Context, InlineKeyboard, InputFile } from "grammy";
import QRCode from "qrcode";
import {
  bigGreet,
  justImageTxt,
  noSubFoundTxt,
  reciptReceiveTxt,
  searchingTxt,
  subFoundGetConfTxt,
  subFoundTxt,
  welcomeAdminTxt,
  resetBtn,
  cancelBtn,
  broadcastBtn,
} from "./messages";
import { adminMenu, broadcastConfirmMenu, mainMenu, renewMenu } from "./keyboards";
import type { DB } from "../../util/db";
import type { Conversation } from "@grammyjs/conversations";
import { db, WHICH_INBOUND } from "../..";
import { getAllPanels, Panel } from "../panel/panel";
import { Util } from "../../util/util";
import { creatingEmail } from "./bot";

export const ADMIN_ID = Number(process.env.ADMIN_ID!);
export const renewCache: Record<number, UserConfig[]> = {};
export const getConfigCache: Record<number, UserConfig[]> = {};

export const waitingForRenewImage = new Set<number>();
export const pendingRenewals = new Map<number, { photoFileID: string }>();
export const pendingConfig = new Map<number, PendingRenewConfig>();
export const pendingConfigType = new Map<number, ConfigPrice>();

export const waitingForCreateImage = new Set<number>();
export const pendingCreates = new Map<number, { photoFileID: string }>();
export const pendingCreateConfig = new Set<number>();
export const pendingCreateConfigType = new Map<number, ConfigPrice>();

export const waitingForBroadcast = new Set<number>();
export const pendingBroadcast = new Map<
  number,
  { text?: string; photoFileID?: string; caption?: string }
>();

export const state: State = {
  isRenewActive: true,
  isSellActive: true,
};

const replyToAdmin = async (ctx: Context, msg: string) => {
  return await ctx.api.sendMessage(ADMIN_ID, msg, { reply_markup: adminMenu });
};

export async function handleStartCommandForUser(ctx: Context, db: DB) {
  const init = db.getPanels().length !== 0;
  if (!init) {
    await ctx.reply("ربات هنوز توسط ادمین راه اندازی نشده است...", {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }
  await ctx.reply(bigGreet, { reply_markup: mainMenu });
}

export async function handleImagesIncome(ctx: Context) {
  const userID = ctx.from?.id!;

  if (!ctx.message?.photo) {
    waitingForRenewImage.delete(userID);
    pendingConfig.delete(userID);
    await ctx.reply(justImageTxt, { reply_markup: mainMenu });
    return;
  } else {
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;

    console.log("Received photo from user", userID);
    console.log(
      "user has a",
      waitingForCreateImage.has(userID)
        ? "pending create request"
        : waitingForRenewImage.has(userID)
          ? "pending renewal request"
          : "no pending requests",
    );

    if (waitingForRenewImage.has(userID)) {
      waitingForRenewImage.delete(userID);

      pendingRenewals.set(userID, { photoFileID: photo.file_id });

      const uuid = pendingConfig.get(userID)?.UUID!;
      const configs = renewCache[userID]?.filter((v) => v.uuid === uuid);
      const email = Util.removeEmoji(configs?.at(0)?.email!);
      const type = pendingConfigType.get(userID)!;

      await ctx.api.sendPhoto(ADMIN_ID, photo.file_id, {
        caption: `درخواست تمدید از طرف کاربر\n${userID}\n\n${email}\n${type}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ قبول", callback_data: `renewAccept:${userID}` },
              { text: "❌ رد", callback_data: `renewDecline:${userID}` },
            ],
          ],
        },
      });

      await ctx.reply(reciptReceiveTxt, { reply_markup: mainMenu });
      return;
    } else if (waitingForCreateImage.has(userID)) {
      console.log("Creating new account for user", userID);
      waitingForCreateImage.delete(userID);

      pendingCreates.set(userID, { photoFileID: photo.file_id });

      const type = pendingCreateConfigType.get(userID)!;
      const randomThreeDigit = Math.floor(Math.random() * 900) + 100;
      const firstThreeDigit = userID.toString().slice(0, 3);
      const email = `${firstThreeDigit}${randomThreeDigit}`;

      creatingEmail.set(userID, email);

      await ctx.api.sendPhoto(ADMIN_ID, photo.file_id, {
        caption: `درخواست ساخت اکانت جدید از طرف کاربر\n${userID}\n\n${email}\n${type}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ قبول", callback_data: `createAccept:${userID}` },
              { text: "❌ رد", callback_data: `createDecline:${userID}` },
            ],
          ],
        },
      });

      await ctx.reply(reciptReceiveTxt, { reply_markup: mainMenu });
      return;
    }
  }
}

export const handleRenewCallback = async (ctx: Context) => {
  const index = Number(ctx.callbackQuery?.data?.replace("renew:", ""));
  const userID = ctx.from?.id!;

  const configs = renewCache[userID];
  if (!configs) return;

  const selected = configs[index];
  if (!selected) {
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.deleteMessage();

  // Renewals are always allowed: quota is added to the remaining quota.
  pendingConfig.set(userID, {
    UUID: selected?.uuid!,
    inboundID: selected?.inboundID!,
  });

  await ctx.reply(
    `لطفا نوع اشتراک خود را انتخاب کنید:

چنانچه نیاز به اشتراک با حجم بیشتر دارید، با پشتیبانی تماس بگیرید 👇

🆔: @foxngsup`,
    {
      reply_markup: renewMenu,
    },
  );

  await ctx.answerCallbackQuery();
};

export const handleRenewDeclineCallback = async (ctx: Context) => {
  const adminId = ctx.from?.id!;
  if (adminId !== ADMIN_ID)
    return await ctx.answerCallbackQuery({ text: "Not allowed" });

  const userId = Number(ctx.callbackQuery?.data!.replace("renewDecline:", ""));
  const pending = pendingRenewals.get(userId);
  if (!pending)
    return await ctx.answerCallbackQuery({ text: "No pending request" });

  pendingRenewals.delete(userId);
  pendingConfig.delete(userId);
  pendingConfigType.delete(userId);

  await ctx.api.sendMessage(
    userId,
    `‼️رسید پرداخت شما توسط ادمین رد شد‼️

با آیدی پشتیبانی در ارتباط باشید👇🏼

🆔: @foxngsup`,
  );
  await ctx.reply("رد شد ❌");
  await ctx.answerCallbackQuery();
};

export const handleCreateDeclineCallback = async (ctx: Context) => {
  const adminId = ctx.from?.id!;
  if (adminId !== ADMIN_ID)
    return await ctx.answerCallbackQuery({ text: "Not allowed" });

  const userId = Number(ctx.callbackQuery?.data!.replace("createDecline:", ""));
  const pending = pendingCreates.get(userId);
  if (!pending)
    return await ctx.answerCallbackQuery({ text: "No pending request" });

  pendingCreates.delete(userId);
  pendingCreateConfig.delete(userId);
  pendingCreateConfigType.delete(userId);

  await ctx.api.sendMessage(
    userId,
    `‼️رسید پرداخت شما توسط ادمین رد شد‼️

با آیدی پشتیبانی در ارتباط باشید👇🏼

🆔: @foxngsup`,
  );
  await ctx.reply("رد شد ❌");
  await ctx.answerCallbackQuery();
};

export async function handleGetConfig(ctx: Context, db: DB) {
  const looking = await ctx.reply(searchingTxt);

  const panels = getAllPanels(db);
  let configs: UserConfig[] = [];

  for (const panel of panels) {
    const config = await panel.getUserConfigs(ctx.from?.id!);
    if (config) {
      config.forEach((conf) => configs.push(conf));
    }
  }

  await ctx.api.deleteMessage(ctx.from?.id!, looking.message_id);
  if (configs.length === 0) {
    await ctx.reply(noSubFoundTxt);
  } else {
    const keyboard = new InlineKeyboard();

    configs.forEach((config, idx) => {
      keyboard.text(Util.removeEmoji(config.email), `getConfig:${idx}`).row();
    });

    getConfigCache[ctx.from?.id!] = configs;

    await ctx.reply(subFoundGetConfTxt, {
      reply_markup: keyboard,
    });
  }
}

export async function handleRenewAccount(ctx: Context, db: DB) {
  const looking = await ctx.reply(searchingTxt);

  const panels = getAllPanels(db);
  let configs: UserConfig[] = [];

  for (const panel of panels) {
    const config = await panel.getUserConfigs(ctx.from?.id!);
    if (config) {
      config.forEach((conf) => configs.push(conf));
    }
  }

  await ctx.api.deleteMessage(ctx.from?.id!, looking.message_id);
  if (configs.length === 0) {
    await ctx.reply(noSubFoundTxt);
  } else {
    const keyboard = new InlineKeyboard();

    configs.forEach((config, idx) => {
      keyboard.text(config.email, `renew:${idx}`).row();
    });

    renewCache[ctx.from?.id!] = configs;

    await ctx.reply(subFoundTxt, {
      reply_markup: keyboard,
    });
  }
}

export async function handleCreateAccount(ctx: Context) {
  pendingCreateConfig.add(ctx.from?.id!);
  await ctx.reply(
    "اشتراک مورد نظرتو انتخاب کن 👇\n\nاگه نیاز به حجم بیشتر داری با پشتیبانی تماس بگیر 👇\n\n🆔: @foxngsup",
    {
      reply_markup: renewMenu,
    },
  );
}

export async function handleCheckAccount(ctx: Context, db: DB) {
  const looking = await ctx.reply(searchingTxt);

  const panels = getAllPanels(db);
  let configs: UserConfig[] = [];

  for (const panel of panels) {
    const config = await panel.getUserConfigs(ctx.from?.id!);
    if (config) {
      config.forEach((conf) => configs.push(conf));
    }
  }

  await ctx.api.deleteMessage(ctx.from?.id!, looking.message_id);
  if (configs.length === 0) {
    await ctx.reply(noSubFoundTxt, { reply_markup: mainMenu });
  } else {
    let statusTxt = "🔋وضعیت حساب شما:\n\n";

    for (const conf of configs) {
      const email = Util.removeEmoji(conf.email);
      const displayGB = Util.formatGB(
        Util.displayRemainingGB(conf.totalGB, conf.remainingGB),
      );
      const statusWord = conf.status
        ? conf.isRenewable
          ? "رو به اتمام"
          : "فعال"
        : "به اتمام رسیده";
      statusTxt += `${conf.status ? (conf.isRenewable ? "🟡" : "🟢") : "🔴"} ${email} - ${statusWord}\nمانده: ${displayGB} گیگابایت\n\n`;
    }

    await ctx.reply(statusTxt, { reply_markup: mainMenu });
  }
}

export async function handleStartCommandForAdmin(ctx: Context, db: DB) {
  const init = db.getPanels().length !== 0;
  if (!init) {
    await replyToAdmin(ctx, welcomeAdminTxt);
  } else {
    await replyToAdmin(ctx, "سلام گل!");
  }
}

export async function showPanelsListToAdmin(ctx: Context, db: DB) {
  const looking = (await replyToAdmin(ctx, searchingTxt)).message_id;

  const credentials = db.getPanels();
  await ctx.api.deleteMessage(ADMIN_ID, looking);
  let msg = "پنل های شما:\n";

  if (credentials.length === 0) {
    msg = "هیچی نداریم که!";
    await replyToAdmin(ctx, msg);
    return;
  }

  credentials.forEach(
    (cert) =>
      (msg += `
Name: ${cert.name}
URL: ${cert.url}

    `),
  );

  await replyToAdmin(ctx, msg);
}

export async function showUserCountToAdmin(ctx: Context, db: DB) {
  const ids = db.getUserIds().filter((id) => id !== ADMIN_ID);
  await replyToAdmin(ctx, `👥 تعداد کاربرانی که ربات را شروع کرده‌اند: ${ids.length}`);
}

export async function addPanelConv(conversation: Conversation, ctx: Context) {
  await ctx.reply(`
خب آدرس پنل رو بده بهم:

هر موقع که خواستی بیخیال بشی هم میتونی بنویسی بیخیال
`);
  const { message: url } = await conversation.waitFor("message:text");
  if (url.text === "بیخیال") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }
  await ctx.reply("یه اسم خاص به این پنل بده:");
  const { message: name } = await conversation.waitFor("message:text");
  if (name.text === "بیخیال") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }
  await ctx.reply("حالا یوزرنیم:");
  const { message: username } = await conversation.waitFor("message:text");
  if (username.text === "بیخیال") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }
  await ctx.reply("حالام پسورد:");
  const { message: password } = await conversation.waitFor("message:text");
  if (password.text === "بیخیال") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }

  db.addPanel(url.text.toLowerCase(), name.text, username.text, password.text);

  await ctx.reply("تمام است!");
}

export async function removePanelConv(
  conversation: Conversation,
  ctx: Context,
) {
  await ctx.reply("خب صد درصد میخوای شروع کنیم؟ اگه آره که بگو آره");
  const { message: confirm1 } = await conversation.waitFor("message:text");
  if (confirm1.text !== "آره") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }
  await ctx.reply(`
بسیارخب
اسم پنلی که میخوای پاک کنی رو دقیق بهم بگو:

البته اگه بگی بیخیال منم بیخیال میشم.
    `);
  const { message: name } = await conversation.waitFor("message:text");
  if (name.text === "بیخیال") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }
  await ctx.reply("صد درصد؟ پاک کنم دیگه برنمیگرده");
  const { message: confirm2 } = await conversation.waitFor("message:text");
  if (confirm2.text !== "آره") {
    await ctx.reply("اوکی کار کنسله");
    return;
  }

  const deleted = db.deletePanelByName(name.text);

  if (deleted) {
    ctx.reply(`تمومه
پنل ${name.text} از لیست پاک شد`);
    return;
  } else {
    ctx.reply("مشکلی پیش اومده پنل پاک نشد");
    return;
  }
}
export async function getConfigsPanel(uuid: string, db: DB) {
  const panels = getAllPanels(db);

  // uuid here may be a client UUID (vless/vmess id) or the raw email key.
  // Prefer the client-centric lookup, fall back to scanning inbounds.
  for (const panel of panels) {
    const clients = await panel.getClients();
    if (clients?.success && Array.isArray(clients.obj)) {
      const found = clients.obj.find(
        (c) => c.uuid === uuid || c.email === uuid,
      );
      if (found) return panel;
    }
    const inbounds = await panel.getInbounds();
    if (inbounds) {
      for (const bound of inbounds.obj) {
        for (const client of bound.clientStats) {
          if (client.uuid === uuid) {
            return panel;
          }
        }
        for (const client of bound.settings.clients) {
          if (client.id === uuid || client.email === uuid) {
            return panel;
          }
        }
      }
    }
  }
}

export async function generateConfigURL(
  tgID: number,
  inbounds: GetInboundsResponse,
  url: string,
) {
  for (let obj of inbounds.obj) {
    for (let client of obj.settings.clients) {
      if (tgID === client.tgId) {
        return `${obj.protocol}://${client.id}@${new URL(url).hostname}:${obj.port}?type=${obj.streamSettings.network}&encryption=${obj.settings.encryption || "none"}&security=${obj.streamSettings.security}#${obj.remark}-${client.email}`;
      }
    }
  }
}

export function generateVmessLink(data: {
  name: string;
  server: string;
  port: number;
  uuid: UUID;
  network: string;
  path?: string;
  host?: string;
  tls?: string;
  header: string;
}) {
  const vmessConfig = {
    v: "2",
    ps: data.name,
    add: data.server,
    port: data.port.toString(),
    id: data.uuid,
    aid: "0",
    net: data.network,
    type: data.header,
    host: data.host || "",
    path: data.path || "",
    tls: data.tls || "",
  };

  const base64 = Buffer.from(JSON.stringify(vmessConfig)).toString("base64");
  return `vmess://${base64}`;
}

export async function genConfig(
  panel: Panel,
  email: string,
  uuid: UUID,
  inboundID?: number,
) {
  const inbound = await panel.getInboundByID(
    inboundID ? inboundID : Number(WHICH_INBOUND),
  );

  const streamSettings = inbound.obj.streamSettings as StreamSettings & {
    externalProxy?: ExternalProxy[];
    realitySettings?: {
      dest?: string;
      serverNames?: string[];
      shortIds?: string[];
      publicKey?: string;
      fingerprint?: string;
      spiderX?: string;
    };
    xhttpSettings?: { path?: string; host?: string; mode?: string };
  };
  const proxies = streamSettings.externalProxy ?? [];
  const useExternalProxy =
    proxies.length !== 0 ? proxies.at(0)?.dest !== "" : false;
  const externalProxy = useExternalProxy
    ? proxies.at(0)?.dest
    : undefined;

  // TCP-only settings are absent on reality/grpc/xhttp inbounds — guard them.
  const tcpHeader = streamSettings.tcpSettings?.header;
  const tcpRequest = tcpHeader?.request;

  // WebSocket transport keeps host/path in wsSettings (host field or
  // headers.Host on older panels). Client apps need both to connect.
  const ws = streamSettings.wsSettings;
  const wsHost = ws?.host || ws?.headers?.Host || ws?.headers?.host || undefined;
  const wsPath = ws?.path || undefined;

  let configLink = "";
  if (inbound.obj.protocol === "vmess") {
    configLink = generateVmessLink({
      name: `${inbound.obj.remark}-${email}`,
      server: useExternalProxy ? externalProxy! : new URL(panel.url).hostname,
      port: inbound.obj.port,
      uuid: uuid,
      network: streamSettings.network,
      host:
        streamSettings.network === "ws"
          ? wsHost
          : tcpRequest
            ? tcpRequest.headers.Host.at(0)
            : undefined,
      path:
        streamSettings.network === "ws"
          ? wsPath
          : tcpRequest
            ? tcpRequest.path.at(0)
            : undefined,
      header: tcpHeader?.type ?? "none",
    });
  } else if (inbound.obj.protocol === "vless") {
    const url = useExternalProxy ? externalProxy! : new URL(panel.url).hostname;

    const params = new URLSearchParams();
    params.set("type", streamSettings.network);
    params.set("encryption", inbound.obj.settings.encryption || "none");
    if (streamSettings.network === "ws") {
      if (wsHost) params.set("host", wsHost);
      if (wsPath) params.set("path", wsPath);
    } else if (tcpRequest) {
      const p = tcpRequest.path.at(0);
      const h = tcpRequest.headers.Host.at(0);
      if (p) params.set("path", p);
      if (h) params.set("host", h);
      if (tcpHeader?.type) params.set("headerType", tcpHeader.type);
    }
    params.set("security", streamSettings.security);
    // Reality inbounds need pbk/fp/sni/sid/spx to connect.
    const reality = streamSettings.realitySettings;
    if (streamSettings.security === "reality" && reality) {
      if (reality.publicKey) params.set("pbk", reality.publicKey);
      if (reality.fingerprint) params.set("fp", reality.fingerprint);
      const sni = reality.serverNames?.at(0) ?? reality.dest;
      if (sni) params.set("sni", sni);
      const sid = reality.shortIds?.at(0);
      if (sid) params.set("sid", sid);
      if (reality.spiderX) params.set("spx", reality.spiderX);
    }
    if (streamSettings.network === "xhttp" && streamSettings.xhttpSettings) {
      const { path, host, mode } = streamSettings.xhttpSettings;
      if (path) params.set("path", path);
      if (host) params.set("host", host);
      if (mode) params.set("mode", mode);
    }

    configLink = `vless://${uuid}@${url}:${inbound.obj.port}?${params.toString()}#${encodeURIComponent(`${inbound.obj.remark}-${email}`)}`;
  }

  const qrBuffer = await QRCode.toBuffer(configLink, {
    type: "png",
    width: 400,
    margin: 2,
  });

  const qrFile = new InputFile(qrBuffer, "config.png");
  return { qrFile, configLink };
}

export async function handleBroadcastMessage(
  ctx: Context,
  db: DB,
): Promise<boolean> {
  const adminID = ctx.from?.id;
  if (adminID === undefined) return false;
  if (!waitingForBroadcast.has(adminID)) return false;

  const photo = ctx.message?.photo?.at(-1);
  const text = ctx.message?.text;

  // Let menu navigation fall through to the normal switch.
  if (
    !photo &&
    (text === resetBtn || text === cancelBtn || text === broadcastBtn)
  ) {
    waitingForBroadcast.delete(adminID);
    return false;
  }

  if (!photo && !text) {
    await ctx.reply("متن یا عکس بفرست تا همونو برای همه بفرستم. برای انصراف «لغو سفارش» یا بازگشت رو بزن.", {
      reply_markup: adminMenu,
    });
    return true;
  }

  if (text === "بیخیال") {
    waitingForBroadcast.delete(adminID);
    pendingBroadcast.delete(adminID);
    await ctx.reply("اوکی، پیام همگانی کنسل شد.", { reply_markup: adminMenu });
    return true;
  }

  if (photo) {
    pendingBroadcast.set(adminID, {
      photoFileID: photo.file_id,
      caption: ctx.message?.caption,
    });
  } else {
    pendingBroadcast.set(adminID, { text: text! });
  }

  waitingForBroadcast.delete(adminID);

  const recipients = collectBroadcastRecipients(db);
  await ctx.reply(
    `این پیام قراره برای ${recipients.length} کاربر ارسال بشه. تایید میکنی؟`,
    { reply_markup: broadcastConfirmMenu(recipients.length) },
  );
  const draft = pendingBroadcast.get(adminID);
  if (draft?.photoFileID) {
    await ctx.api.sendPhoto(adminID, draft.photoFileID, {
      caption: draft.caption ?? "👆 پیش‌نمایش پیام همگانی",
    });
  } else if (draft?.text) {
    await ctx.reply(`👆 پیش‌نمایش پیام همگانی:\n\n${draft.text}`);
  }
  return true;
}

function collectBroadcastRecipients(db: DB): number[] {
  const ids = new Set<number>(db.getUserIds());
  ids.delete(ADMIN_ID);
  return [...ids];
}

export async function handleBroadcastConfirm(
  ctx: Context,
  db: DB,
): Promise<boolean> {
  const adminID = ctx.from?.id!;
  const draft = pendingBroadcast.get(adminID);
  if (!draft) return false;

  const text = ctx.message?.text ?? "";
  if (text === resetBtn || text === cancelBtn) {
    pendingBroadcast.delete(adminID);
    return false;
  }

  const confirmMatch = text.match(/^تایید ارسال به (\d+) کاربر ✅$/);
  if (!confirmMatch) return true;

  pendingBroadcast.delete(adminID);

  const recipients = collectBroadcastRecipients(db);
  if (recipients.length === 0) {
    await ctx.reply("کاربری برای ارسال پیدا نکردم.", { reply_markup: adminMenu });
    return true;
  }

  await ctx.reply(`باشه، دارم برای ${recipients.length} کاربر میفرستم...`, {
    reply_markup: adminMenu,
  });

  let sent = 0;
  let failed = 0;
  for (const tgID of recipients) {
    try {
      if (draft.photoFileID) {
        await ctx.api.sendPhoto(tgID, draft.photoFileID, {
          caption: draft.caption,
        });
      } else if (draft.text) {
        await ctx.api.sendMessage(tgID, draft.text);
      }
      sent++;
    } catch (error) {
      failed++;
      console.error(`Broadcast to ${tgID} failed:`, error);
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  await ctx.reply(`تموم شد ✅\n\nارسال موفق: ${sent}\nناموفق: ${failed}`, {
    reply_markup: adminMenu,
  });
  return true;
}

export async function handleBackup(ctx: Context) {
  try {
    const file = new InputFile("./panels.sqlite");
    await ctx.api.sendDocument(ADMIN_ID, file, {
      caption: "تقدیم به شما",
    });
  } catch (error) {
    console.error("Backup failed:", error);
    await ctx.reply("❌ Backup failed");
  }
}
