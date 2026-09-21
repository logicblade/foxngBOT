import { type Context, InlineKeyboard, InputFile } from "grammy";
import QRCode from "qrcode";
import {
  PLANS,
  justImageTxt,
  noSubFoundTxt,
  reciptReceiveTxt,
  searchingTxt,
  startMessage,
  subFoundGetConfTxt,
  subFoundTxt,
  welcomeAdminTxt,
  withSupport,
} from "./messages";
import {
  adminMainMenu,
  adminManagementMenu,
  backToAdminMainMenu,
  backToMainMenu,
  cancelActionMenu,
  discountManagementMenu,
  initialOwnerMenu,
  orderDecisionMenu,
  ownerMainMenu,
  panelsMenu,
  planMenu,
  userMainMenu,
} from "./keyboards";
import type { DB } from "../../util/db";
import type {
  ConfigPrice,
  Obj,
  Order,
  OrderType,
  PanelClient,
  PendingRenewConfig,
  Plan,
  State,
  UUID,
  UserConfig,
} from "../types";
import type { Conversation } from "@grammyjs/conversations";
import { db, WHICH_INBOUND } from "../config";
import { getAllPanels, Panel, PanelLoginError } from "../panel/panel";
import { Util } from "../../util/util";
import { creatingEmail } from "./bot";

export const ADMIN_ID = Number(process.env.ADMIN_ID ?? process.env.OWNER_ID ?? 0);
export const OWNER_ID = Number(process.env.OWNER_ID ?? process.env.ADMIN_ID ?? 0);

/** Owner ids are resolved on every call so late env loading can never lock the owner out. */
export function ownerIds(): Set<number> {
  const ids = new Set<number>();
  for (const raw of [process.env.OWNER_ID, process.env.ADMIN_ID]) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

/** Legacy in-memory maps (kept for compat; new flow uses DB orders). */
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

export const state: State = {
  isRenewActive: true,
  isSellActive: true,
};

/** Per-user purchase flow state (new DB-backed order flow). */
export const pendingOrderFlow = new Map<
  number,
  { type: OrderType; orderId: number | null; targetUUID?: string; targetInboundID?: number }
>();
/** Owner/admin compose states: broadcast / subscribers / add-admin. */
export const awaitingBroadcast = new Set<number>();
export const awaitingSubscribers = new Set<number>();
export const awaitingAddAdmin = new Set<number>();
export const awaitingDiscount = new Set<number>();

/** Owner panel-replacement flow: step machine collecting the new panel credentials. */
export type PanelReplaceState = {
  step: "url" | "name" | "username" | "password";
  panelId: number;
  oldName: string;
  url?: string;
  name?: string;
  username?: string;
};
export const panelReplaceFlow = new Map<number, PanelReplaceState>();

export function planById(id: string): Plan | undefined {
  return (PLANS as Plan[]).find((p) => p.id === id);
}

export function isOwner(tgId: number): boolean {
  return ownerIds().has(tgId);
}

export function isAdminOrOwner(db: DB, tgId: number): boolean {
  return isOwner(tgId) || db.isAdmin(tgId);
}

/**
 * ADMINs are restricted to receipt review only. Used as a server-side guard on
 * user purchase flows so a manually-crafted callback cannot bypass the UI.
 * The OWNER may still test user flows.
 */
export async function restrictAdminToReceipts(ctx: Context, db: DB): Promise<boolean> {
  const tgId = ctx.from?.id!;
  if (isOwner(tgId) || !db.isAdmin(tgId)) return false;
  await ctx.reply("⛔ دسترسی شما فقط به مدیریت رسیدها محدود است.", {
    reply_markup: adminMainMenu(db.getPendingOrderCount()),
  });
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

export function fullName(ctx: Context): string {
  const first = ctx.from?.first_name ?? "";
  const last = (ctx.from as { last_name?: string } | undefined)?.last_name ?? "";
  return Util.displayName(first, last);
}

export async function showUserMain(ctx: Context, text?: string) {
  const msg = text ?? "از منوی زیر انتخاب کن 👇🏼";
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(msg, { reply_markup: userMainMenu() });
      return;
    } catch {
      /* message may not be editable (photo etc.) */
    }
  }
  await ctx.reply(msg, { reply_markup: userMainMenu() });
}

export async function showPrivilegedMain(ctx: Context, db: DB) {
  const tgId = ctx.from?.id!;
  const pending = db.getPendingOrderCount();
  const kb = isOwner(tgId) ? ownerMainMenu(pending) : adminMainMenu(pending);
  const text = isOwner(tgId) ? "👑 منوی مدیریت (مالک)" : "🧾 پنل مدیریت رسیدها";
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
      return;
    } catch {
      /* fallthrough */
    }
  }
  await ctx.reply(text, { reply_markup: kb });
}

export async function showAdminManagement(ctx: Context, db: DB) {
  for (const admin of db.getAdmins()) {
    const user = db.getAllUsers().find((item) => item.tg_id === admin.tg_id);
    if (user?.first_name || user?.username) continue;
    try {
      const chat = await ctx.api.getChat(admin.tg_id);
      if (chat.type === "private") db.upsertUser(admin.tg_id, chat.first_name, chat.username);
    } catch {}
  }
  const users = new Map(db.getAllUsers().map((user) => [user.tg_id, user]));
  const admins = db.getAdmins();
  const lines = admins.length === 0
    ? ["هنوز ادمینی اضافه نشده است."]
    : admins.map((admin, index) => {
        const user = users.get(admin.tg_id);
        const name = user?.first_name?.trim() || "بدون نام";
        const username = user?.username ? `@${user.username}` : "بدون یوزرنیم";
        return `${index + 1}. ${name} | ${username}\n🆔 ${admin.tg_id}`;
      });
  const text = `👥 مدیریت ادمین‌ها\n\n${lines.join("\n\n")}`;
  const markup = adminManagementMenu(admins.map((admin) => admin.tg_id));
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: markup });
      return;
    } catch {}
  }
  await ctx.reply(text, { reply_markup: markup });
}

export async function showDiscountManagement(ctx: Context, db: DB) {
  const discount = db.getDiscountPercent();
  const text = discount > 0
    ? `🏷 مدیریت تخفیفات\n\nوضعیت تخفیف: فعال ✅\nمقدار تخفیف: ${discount}٪`
    : "🏷 مدیریت تخفیفات\n\nوضعیت تخفیف: غیرفعال ❌";
  const markup = discountManagementMenu();
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: markup });
      return;
    } catch {}
  }
  await ctx.reply(text, { reply_markup: markup });
}

export function orderCaption(o: Order): string {
  const typeTxt = o.type === "buy" ? "خرید جدید" : "تمدید";
  const date = Util.formatDateTime(o.created_at);
  return `🧾 سفارش #${o.id} (${typeTxt}) — ⏳ در انتظار بررسی
👤 کاربر: ${o.tg_name} (${o.tg_id})
${o.tg_username ? `🔗 یوزرنیم: @${o.tg_username}` : ""}
📦 پلن: ${o.volume_gb} گیگ | ⏳ ${o.duration_days} روزه | 💰 ${Util.formatPrice(o.price)} تومان
🧾 رسید: ${o.receipt_file_id ? "دریافت شد ✅" : "—"}
🕓 ${date}
وضعیت: ${o.status}`;
}

async function notifyReviewers(ctx: Context, order: Order, receiptFileId: string) {
  const targets = new Set<number>([OWNER_ID, ADMIN_ID, ...db.getAdmins().map((a) => a.tg_id)].filter((v) => v > 0));
  for (const adminId of targets) {
    try {
      await ctx.api.sendPhoto(adminId, receiptFileId, {
        caption: orderCaption(order),
        reply_markup: orderDecisionMenu(order.id),
      });
    } catch (e) {
      console.error("notify reviewer failed", adminId, e);
    }
  }
}

const replyToAdmin = async (ctx: Context, msg: string) => {
  return await ctx.api.sendMessage(ADMIN_ID, msg);
};

export async function handleStartCommandForUser(ctx: Context, db: DB) {
  const userID = ctx.from?.id!;
  const known = db.hasUser(userID);
  db.upsertUser(userID, ctx.from?.first_name, ctx.from?.username);
  const init = db.getPanels().length !== 0;

  // Users that were on the old reply-keyboard build keep it cached on their device:
  // send one message that removes it, then show the inline menu.
  if (known) {
    await ctx
      .reply("✅ منوی ربات به دکمه‌های شیشه‌ای زیر پیام تغییر کرد.", {
        reply_markup: { remove_keyboard: true },
      })
      .catch(() => {});
  }

  if (!init) {
    await ctx.reply("ربات هنوز توسط ادمین راه اندازی نشده است...", {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }
  const name = fullName(ctx);
  await ctx.reply(startMessage(name), { reply_markup: userMainMenu() });
}

export async function handleImagesIncome(ctx: Context, db: DB) {
  const userID = ctx.from?.id!;

  if (!ctx.message?.photo) {
    // New DB order flow: user must send a receipt photo for the selected plan.
    const flow = pendingOrderFlow.get(userID);
    if (flow?.orderId) {
      await ctx.reply(justImageTxt, { reply_markup: backToMainMenu() });
      return;
    }
    if (flow && !flow.orderId) {
      await ctx.reply("لطفا یکی از پلن‌های زیر را انتخاب کنید 👇", {
        reply_markup: planMenu(flow.type, PLANS, db.getDiscountPercent()),
      });
      return;
    }
    waitingForRenewImage.delete(userID);
    pendingConfig.delete(userID);
    await ctx.reply(justImageTxt, { reply_markup: userMainMenu() });
    return;
  } else {
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;

    const flow = pendingOrderFlow.get(userID);
    if (flow?.orderId) {
      const order = db.getOrderById(flow.orderId);
      if (!order || order.status !== "PENDING" || order.tg_id !== userID) {
        pendingOrderFlow.delete(userID);
        await showUserMain(ctx, "سفارش شما معتبر نیست. از اول تلاش کنید.");
        return;
      }
      db.attachReceipt(order.id, photo.file_id, "photo");
      pendingOrderFlow.delete(userID);
      const updated = db.getOrderById(order.id)!;
      await notifyReviewers(ctx, updated, photo.file_id);
      await ctx.reply(reciptReceiveTxt, { reply_markup: userMainMenu() });
      return;
    }

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
      const configs = renewCache[userID]?.filter(
        (v) =>
          (v.isRenewable && v.uuid === uuid) ||
          (v.status === false && v.uuid === uuid),
      );
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

      await ctx.reply(reciptReceiveTxt, { reply_markup: userMainMenu() });
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

      await ctx.reply(reciptReceiveTxt, { reply_markup: userMainMenu() });
      return;
    }
  }
}

export const handleRenewCallback = async (ctx: Context, db: DB) => {
  const index = Number(ctx.callbackQuery?.data?.replace("renew:", ""));
  const userID = ctx.from?.id!;

  const configs = renewCache[userID];
  if (!configs) return;

  const selected = configs[index];

  await ctx.deleteMessage();

  pendingConfig.set(userID, {
    UUID: selected?.uuid!,
    inboundID: selected?.inboundID!,
  });

  pendingOrderFlow.set(userID, {
    type: "renew",
    orderId: null,
    targetUUID: selected?.uuid!,
    targetInboundID: selected?.inboundID!,
  });

  await ctx.reply(
    `لطفا پلن تمدید را انتخاب کنید: 👇`,
    { reply_markup: planMenu("renew", PLANS, db.getDiscountPercent()) },
  );

  await ctx.answerCallbackQuery();
};

export const handleRenewDeclineCallback = async (ctx: Context, db: DB) => {
  const adminId = ctx.from?.id!;
  if (!isAdminOrOwner(db, adminId))
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
    withSupport(`‼️رسید پرداخت شما توسط ادمین رد شد‼️

با آیدی پشتیبانی در ارتباط باشید👇🏼`),
  );
  await ctx.reply("رد شد ❌");
  await ctx.answerCallbackQuery();
};

export const handleCreateDeclineCallback = async (ctx: Context, db: DB) => {
  const adminId = ctx.from?.id!;
  if (!isAdminOrOwner(db, adminId))
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
    withSupport(`‼️رسید پرداخت شما توسط ادمین رد شد‼️

با آیدی پشتیبانی در ارتباط باشید👇🏼`),
  );
  await ctx.reply("رد شد ❌");
  await ctx.answerCallbackQuery();
};

export async function approveOrder(
  ctx: Context,
  db: DB,
  orderId: number,
): Promise<void> {
  const reviewer = ctx.from?.id!;
  if (!isAdminOrOwner(db, reviewer)) {
    await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید" });
    return;
  }
  const order = db.getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery({ text: "سفارش پیدا نشد" });
    return;
  }
  if (order.status !== "PENDING") {
    await ctx.answerCallbackQuery({ text: `این سفارش قبلا بررسی شده (${order.status})` });
    try {
      await ctx.editMessageCaption({ caption: `${orderCaption(order)}\n\n⚠️ قبلا بررسی شده` });
    } catch {}
    return;
  }
  // Atomic claim: only one reviewer can move it out of PENDING.
  const claimed = db.claimOrder(orderId, reviewer, "APPROVED");
  if (!claimed) {
    await ctx.answerCallbackQuery({ text: "این سفارش توسط ادمین دیگری بررسی شد" });
    return;
  }

  const fresh = db.getOrderById(orderId)!;
  try {
    if (fresh.type === "buy") await fulfillBuyOrder(ctx, db, fresh);
    else await fulfillRenewOrder(ctx, db, fresh);

    try {
      await ctx.api.sendMessage(
        fresh.tg_id,
        `✅ سفارش #${fresh.id} تایید شد!\n📦 ${fresh.volume_gb} گیگ | ⏳ ${fresh.duration_days} روزه\nکانفیگ/تمدید شما اعمال شد. از بخش «📊 چقدر حجم دارم؟» وضعیت را ببینید.`,
      );
    } catch {}
    try {
      await ctx.editMessageCaption({ caption: `${orderCaption(fresh)}\n\n✅ تایید شد توسط ${reviewer}` });
    } catch {}
    await ctx.answerCallbackQuery({ text: "تایید شد ✅" });
  } catch (e) {
    console.error("fulfill order failed", e);
    if (e instanceof PanelLoginError) {
      // Nothing was applied on the panel: put the order back to PENDING so the
      // reviewer can fix the panel info and approve again.
      const reverted = db.revertOrderToPending(orderId);
      try {
        await ctx.reply(
          `⚠️ ورود به پنل «${e.panelName}» ناموفق بود.\n🔍 علت: ${String(e.message).replace(/\s+/g, " ").slice(0, 180)}\n\nاگه اطلاعات پنل عوض شده، از بخش «🖥 پنل‌ها» با گزینه «🔁 جایگزینی» اصلاحش کن${reverted ? ` و سفارش #${orderId} رو دوباره تایید کن.` : "."}\n(اگه چند بار اشتباه وارد شده، ممکنه پنل آی‌پی رو موقتا بسته باشه — چند دقیقه صبر کن.)`,
        );
      } catch {}
      try {
        await ctx.editMessageCaption({
          caption: `${orderCaption(fresh)}\n\n⚠️ فعال‌سازی ناموفق بود (پنل در دسترس نیست) — سفارش به حالت در انتظار برگشت`,
        });
      } catch {}
      await ctx.answerCallbackQuery({ text: "پنل در دسترس نیست؛ سفارش به انتظار برگشت" });
      return;
    }
    // Keep it APPROVED (claimed) but inform reviewer; do NOT auto re-pend to avoid double charge.
    try {
      await ctx.api.sendMessage(fresh.tg_id, "⚠️ پرداخت شما تایید شد اما فعال‌سازی با خطا مواجه شد. پشتیبانی بررسی می‌کند.");
    } catch {}
    await ctx.answerCallbackQuery({ text: "تایید شد ولی فعال‌سازی خطا داشت" });
  }
}

export async function rejectOrder(
  ctx: Context,
  db: DB,
  orderId: number,
): Promise<void> {
  const reviewer = ctx.from?.id!;
  if (!isAdminOrOwner(db, reviewer)) {
    await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید" });
    return;
  }
  const order = db.getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery({ text: "سفارش پیدا نشد" });
    return;
  }
  if (order.status !== "PENDING") {
    await ctx.answerCallbackQuery({ text: `این سفارش قبلا بررسی شده (${order.status})` });
    return;
  }
  const claimed = db.claimOrder(orderId, reviewer, "REJECTED");
  if (!claimed) {
    await ctx.answerCallbackQuery({ text: "این سفارش توسط ادمین دیگری بررسی شد" });
    return;
  }
  try {
    await ctx.api.sendMessage(
      order.tg_id,
      withSupport(`❌ سفارش #${order.id} رد شد.\nبا آیدی پشتیبانی در ارتباط باشید👇🏼`),
    );
  } catch {}
  try {
    await ctx.editMessageCaption({ caption: `${orderCaption(order)}\n\n❌ رد شد توسط ${reviewer}` });
  } catch {}
  await ctx.answerCallbackQuery({ text: "رد شد ❌" });
}

async function fulfillBuyOrder(ctx: Context, db: DB, order: Order): Promise<void> {
  const userId = order.tg_id;
  const panels = getAllPanels(db);
  if (panels.length === 0) throw new Error("no panels");
  const panel = panels.find((p) => p.name === "users") ?? panels[0]!;
  const created = await addClientWithFallback(panel, userId, order.volume_gb, order.duration_days);
  const { qrFile, configLink } = await genConfig(
    panel,
    created.email,
    created.uuid,
    created.inboundID,
  );
  try {
    await ctx.api.sendPhoto(userId, qrFile, {
      caption: `اشتراک شما با موفقیت فعال شد ✅\nلینک کانفیگ شما به نام ${created.email} 👇\n(برای کپی کردن لینک یک بار روی آن کلیک کنید.)\n\n<code>${configLink}</code>`,
      parse_mode: "HTML",
      reply_markup: backToMainMenu(),
    });
  } catch (e) {
    console.error("send config to user failed", e);
  }
}

async function fulfillRenewOrder(ctx: Context, db: DB, order: Order): Promise<void> {
  const userId = order.tg_id;
  const uuid = order.target_uuid;
  if (!uuid) throw new Error("renew target missing");
  const panel = await getConfigsPanel(uuid, db);
  if (!panel) throw new Error("panel not found");

  // Keep the panel as the source of truth: renew the existing client email for this UUID.
  const clients = await panel.getClients();
  if (!clients) {
    // Login/API failure — nothing has been applied yet, safe to retry later.
    throw new PanelLoginError(panel.name, "could not read clients list");
  }
  const existing = clients.obj?.find((c) => c.uuid === uuid);
  if (!existing) throw new Error("renew client not found");
  const email = existing?.email ?? `${userId}`;
  const requestedBytes = Util.gigsToBytes(order.volume_gb);
  const totalGB = existing.totalGB === 0 ? 0 : existing.totalGB + requestedBytes;
  const expiryTime = Date.now() + Util.getUnixTimeOf({ days: order.duration_days });

  const res = await panel.updateClient(email, {
    email,
    totalGB,
    expiryTime,
    enable: true,
    tgId: userId,
    comment: String(userId),
    flow: existing.flow,
    limitIp: existing.limitIp,
    subId: existing.subId,
  });
  if (res.status !== 200) {
    // The update was rejected (e.g. 403 session expired) — nothing was applied,
    // so surface it as a panel error to allow a clean retry.
    throw new PanelLoginError(panel.name, `client update failed with status ${res.status}`);
  }
  try {
    await ctx.api.sendMessage(userId, "اشتراک شما با موفقیت تمدید شد ✅");
  } catch (e) {
    console.error("notify renew failed", e);
  }
}

async function addClientWithFallback(
  panel: Panel,
  userId: number,
  volumeGB: number,
  days: number,
): Promise<{ email: string; uuid: string; inboundID: number }> {
  const maxTries = 5;
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < maxTries) {
    let createdOnPanel = false;
    // Keep the panel email short and non-identifying: first 3 Telegram-ID
    // digits plus 3 random digits, e.g. 260482.
    const prefix = String(Math.abs(userId)).slice(0, 3).padEnd(3, "0");
    const email = `${prefix}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
    try {
      const res = await panel.addClient(Number(WHICH_INBOUND), {
        email,
        totalGB: Util.gigsToBytes(volumeGB),
        expiryTime: Date.now() + Util.getUnixTimeOf({ days }),
        enable: true,
        tgId: userId,
        comment: String(userId),
      });
      if (res?.status === 200 || res?.ok) {
        createdOnPanel = true;
        // Do not use a locally generated UUID. Read the actual panel record
        // (settings.clients[].id) after creation and use its email as-is.
        for (let lookup = 0; lookup < 3; lookup++) {
          const stored = await panel.getStoredClient(email);
          if (stored) return { email, ...stored };
          await Util.sleep(150);
        }
        throw new Error("client was created but could not be read back from the panel");
      }
      lastError = new Error(`addClient status ${(res as Response)?.status}`);
    } catch (e) {
      lastError = e;
      // The client exists already. Retrying with another email would create a
      // duplicate subscription, so leave recovery to the normal link button.
      if (createdOnPanel) break;
    }
    attempt++;
  }
  throw lastError instanceof Error ? lastError : new Error("addClient failed");
}

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

  await ctx.api.deleteMessage(ctx.chat?.id!, looking.message_id).catch(() => {});
  if (configs.length === 0) {
    await ctx.reply(noSubFoundTxt, { reply_markup: backToMainMenu() });
  } else {
    const keyboard = new InlineKeyboard();

    configs.forEach((config, idx) => {
      keyboard.text(Util.removeEmoji(config.email), `getConfig:${idx}`).row();
    });

    getConfigCache[ctx.from?.id!] = configs;

    keyboard.text("🔙 بازگشت به منوی اصلی", "user:main");
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

  await ctx.api.deleteMessage(ctx.chat?.id!, looking.message_id).catch(() => {});
  if (configs.length === 0) {
    await ctx.reply(noSubFoundTxt, { reply_markup: backToMainMenu() });
  } else {
    const keyboard = new InlineKeyboard();

    configs.forEach((config, idx) => {
      keyboard.text(config.email, `renew:${idx}`).row();
    });
    keyboard.text("🔙 بازگشت به منوی اصلی", "user:main");

    renewCache[ctx.from?.id!] = configs;

    await ctx.reply(subFoundTxt, {
      reply_markup: keyboard,
    });
  }
}

export async function handleCreateAccount(ctx: Context, db: DB) {
  pendingCreateConfig.add(ctx.from?.id!);
  pendingOrderFlow.set(ctx.from?.id!, { type: "buy", orderId: null });
  await ctx.reply("پلن خرید را انتخاب کن 👇", {
    reply_markup: planMenu("buy", PLANS, db.getDiscountPercent()),
  });
}

export async function handleCheckAccount(ctx: Context, db: DB) {
  const looking = await ctx.reply(searchingTxt);

  const panels = getAllPanels(db);
  let configs: UserConfig[] = [];
  let panelUnavailable = false;

  for (const panel of panels) {
    try {
      const config = await panel.getUserConfigs(ctx.from?.id!);
      if (config) {
        config.forEach((conf) => configs.push(conf));
      } else if (panel.loginIssue !== null) {
        panelUnavailable = true;
      }
    } catch (error) {
      panelUnavailable = true;
      console.error(`Failed to query usage from panel "${panel.name}":`, error);
    }
  }

  await ctx.api.deleteMessage(ctx.chat?.id!, looking.message_id).catch(() => {});
  if (panelUnavailable) {
    await ctx.reply(
      "⚠️ استعلام حجم از پنل موقتاً در دسترس نیست. لطفاً چند دقیقه دیگر دوباره تلاش کنید.",
      { reply_markup: backToMainMenu() },
    );
    return;
  }
  if (configs.length === 0) {
    const kb = new InlineKeyboard()
      .text("🛒 خرید اشتراک", "user:buy")
      .row()
      .text("🔙 بازگشت به منوی اصلی", "user:main");
    await ctx.reply(noSubFoundTxt, { reply_markup: kb });
  } else {
    let statusTxt = "📊 وضعیت حجم شما\n\n";
    configs.forEach((conf, i) => {
      const email = Util.removeEmoji(conf.email).split("-").slice(1).join("-") || Util.removeEmoji(conf.email);
      const label = email || `کاربر ${i + 1}`;
      const active = conf.status && !conf.isOff;
      const remaining = Util.formatGB(conf.remainingBytes ?? 0);
      const exp = conf.expiryTime && conf.expiryTime > 0 ? Util.formatDate(conf.expiryTime) : "—";
      // Bonus volume from the existing `client_bonus` table (if this deployment has one).
      const bonus = conf.uuid ? db.getBonusGB(conf.uuid) : 0;
      statusTxt += `👤 ${label}\n💾 حجم باقی‌مانده: ${remaining} GB\n${active ? "🟢 فعال" : "🔴 غیرفعال"} | 📅 اعتبار تا: ${exp}`;
      if (bonus > 0) statusTxt += `\n🎁 حجم هدیه: ${bonus} GB`;
      if (i < configs.length - 1) statusTxt += `\n\n────────────\n\n`;
    });

    await ctx.reply(statusTxt, { reply_markup: backToMainMenu() });
  }
}

export async function handleStartCommandForAdmin(ctx: Context, db: DB) {
  const tgId = ctx.from?.id!;
  const known = db.hasUser(tgId);
  db.upsertUser(tgId, ctx.from?.first_name, ctx.from?.username);
  if (known) {
    await ctx
      .reply("✅ منوی مدیریت به دکمه‌های شیشه‌ای زیر پیام تغییر کرد.", {
        reply_markup: { remove_keyboard: true },
      })
      .catch(() => {});
  }
  const init = db.getPanels().length !== 0;
  if (!init) {
    await ctx.reply(welcomeAdminTxt, { reply_markup: initialOwnerMenu() });
  } else {
    await showPrivilegedMain(ctx, db);
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

  await ctx.api.sendMessage(ADMIN_ID, msg, {
    reply_markup: panelsMenu(credentials),
  });
}

/** Kicks off the panel-replacement flow for the given panel id. */
export async function startPanelReplace(ctx: Context, db: DB, panelId: number) {
  const adminId = ctx.from?.id!;
  if (!isOwner(adminId)) {
    await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
    return;
  }
  const panel = db.getPanels().find((p) => p.id === panelId);
  if (!panel) {
    await ctx.answerCallbackQuery({ text: "پنل پیدا نشد" });
    return;
  }
  panelReplaceFlow.set(adminId, {
    step: "url",
    panelId: panel.id,
    oldName: panel.name,
  });
  await ctx.reply(
    `🔁 جایگزینی پنل «${panel.name}»\n\nآدرس پنل جدید رو بده (مثل https://example.com:2053):\n\nهر موقع که خواستی بیخیال بشی هم میتونی بنویسی بیخیال`,
    { reply_markup: cancelActionMenu() },
  );
  await ctx.answerCallbackQuery().catch(() => {});
}

/** One step of the panel-replacement flow. */
async function handlePanelReplaceStep(
  ctx: Context,
  db: DB,
  adminId: number,
  flow: PanelReplaceState,
): Promise<void> {
  const text = ctx.message?.text?.trim() ?? "";

  if (text === "بیخیال" || text === "لغو") {
    panelReplaceFlow.delete(adminId);
    await ctx.reply("اوکی کار کنسله");
    await showPrivilegedMain(ctx, db);
    return;
  }

  switch (flow.step) {
    case "url": {
      // Keep the original casing: 3x-ui web base paths are case-sensitive
      // (e.g. /Tunnels/), lowercasing here would break login with 403.
      const url = text.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/.+\..+/.test(url)) {
        await ctx.reply(
          "❌ آدرس نامعتبره. آدرس باید با http:// یا https:// شروع بشه. دوباره بفرست:",
          { reply_markup: cancelActionMenu() },
        );
        return;
      }
      flow.url = url;
      flow.step = "name";
      await ctx.reply("حالا یه اسم برای پنل جدید بگذار:", {
        reply_markup: cancelActionMenu(),
      });
      return;
    }
    case "name": {
      const duplicate = db
        .getPanels()
        .some((p) => p.id !== flow.panelId && p.name === text);
      if (duplicate) {
        await ctx.reply("❌ این اسم قبلا برای پنل دیگه‌ای استفاده شده. یه اسم دیگه بده:", {
          reply_markup: cancelActionMenu(),
        });
        return;
      }
      flow.name = text;
      flow.step = "username";
      await ctx.reply("یوزرنیم پنل جدید:", {
        reply_markup: cancelActionMenu(),
      });
      return;
    }
    case "username": {
      flow.username = text;
      flow.step = "password";
      await ctx.reply("و آخرین قدم، پسورد:", {
        reply_markup: cancelActionMenu(),
      });
      return;
    }
    case "password": {
      panelReplaceFlow.delete(adminId);
      const result = db.replacePanel(
        flow.oldName,
        flow.url!,
        flow.name!,
        flow.username!,
        text,
      );
      if (result === "ok") {
        await ctx.reply(
          `✅ تمام! پنل «${flow.oldName}» با پنل «${flow.name!}» جایگزین شد.`,
          { reply_markup: backToAdminMainMenu() },
        );
      } else if (result === "duplicate") {
        await ctx.reply(
          "⚠️ آدرس یا اسم جدید با یه پنل دیگه تداخل داره. جایگزینی انجام نشد، دوباره امتحان کن.",
          { reply_markup: backToAdminMainMenu() },
        );
      } else {
        await ctx.reply("⚠️ پنل قبلی پیدا نشد. جایگزینی انجام نشد.", {
          reply_markup: backToAdminMainMenu(),
        });
      }
      await showPrivilegedMain(ctx, db);
      return;
    }
  }
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

  for (const panel of panels) {
    const inbounds = await panel.getInbounds();
    if (inbounds) {
      for (const bound of inbounds.obj) {
        for (const client of bound.clientStats) {
          if (client.uuid === uuid) {
            return panel;
          }
        }
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

/**
 * Public connect address for the config link.
 * Prefers the inbound's externalProxy (dest / dest:port / port), otherwise the panel host.
 */
function externalAddress(inbound: Obj, panelUrl: string): { address: string; port: number } {
  const proxy = inbound.streamSettings.externalProxy?.at(0);
  let host = proxy?.dest?.trim() ?? "";
  let port = proxy?.port ?? 0;

  if (host) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
      try {
        const parsed = new URL(host);
        host = parsed.hostname;
        if (!port) port = Number(parsed.port) || 0;
      } catch {
        /* keep raw host */
      }
    } else if (host.includes(":")) {
      const [h, p] = host.split(":");
      if (h) host = h;
      if (!port) port = Number(p) || 0;
    }
    if (port > 0) return { address: host, port };
    return { address: host, port: inbound.port };
  }

  try {
    return { address: new URL(panelUrl).hostname, port: inbound.port };
  } catch {
    return { address: panelUrl, port: inbound.port };
  }
}

/**
 * Builds a vless share link strictly from panel data:
 * - uuid: the client id issued by the panel (never generated here)
 * - host/path query params: from the inbound's streamSettings (tcp header request)
 * Format: vless://{uuid}@{address}:{port}?encryption=..&host=..&path=..&security=..&type=..#{remark}-{email}
 */
export function buildVlessLink(data: {
  uuid: string;
  address: string;
  port: number;
  encryption?: string;
  hostHeader?: string;
  path?: string;
  security?: string;
  network: string;
  label: string;
}) {
  const params = new URLSearchParams();
  params.set("encryption", data.encryption || "none");
  if (data.hostHeader) params.set("host", data.hostHeader);
  if (data.path) params.set("path", data.path);
  params.set("security", data.security || "none");
  params.set("type", data.network);
  return `vless://${data.uuid}@${data.address}:${data.port}?${params.toString()}#${encodeURIComponent(data.label)}`;
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

  const { address, port } = externalAddress(inbound.obj, panel.url);
  const stream = inbound.obj.streamSettings;
  const request = stream.tcpSettings?.header?.request;
  const hostHeader = stream.wsSettings?.host ?? request?.headers?.Host?.at(0) ?? undefined;
  const path = stream.wsSettings?.path ?? request?.path?.at(0) ?? undefined;

  let configLink = "";
  if (inbound.obj.protocol === "vless") {
    configLink = buildVlessLink({
      // The UUID always comes from the panel client (never generated here).
      uuid: String(uuid),
      address,
      port,
      encryption: inbound.obj.settings?.encryption || "none",
      hostHeader,
      path,
      security: stream.security,
      network: stream.network,
      label: `${inbound.obj.remark}-${email}`,
    });
  } else if (inbound.obj.protocol === "vmess") {
    configLink = generateVmessLink({
      name: `${inbound.obj.remark}-${email}`,
      server: address,
      port,
      uuid: uuid,
      network: stream.network,
      host: hostHeader,
      path,
      tls: stream.security,
      header: stream.tcpSettings.header.type,
    });
  }

  const qrBuffer = await QRCode.toBuffer(configLink, {
    type: "png",
    width: 400,
    margin: 2,
  });

  const qrFile = new InputFile(qrBuffer, "config.png");
  return { qrFile, configLink };
}

export async function showUserStats(ctx: Context, db: DB): Promise<void> {
  const requester = ctx.from?.id!;
  if (!isOwner(requester)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
    else await ctx.reply("⛔ فقط مالک به این بخش دسترسی دارد.");
    return;
  }
  const total = db.getUserCount();
  const active = await countActiveSubscribers(db);
  const inactive = Math.max(0, total - active);
  const text = `👥 آمار کاربران\n\n👤 کل کاربران: ${total}\n💎 کاربران دارای اشتراک فعال: ${active}\n📭 بدون اشتراک فعال: ${inactive}`;
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: backToAdminMainMenu() });
      await ctx.answerCallbackQuery();
      return;
    } catch {}
  }
  await ctx.reply(text, { reply_markup: backToAdminMainMenu() });
}

export async function countActiveSubscribers(db: DB): Promise<number> {
  const users = db.getAllUsers();
  const panels = getAllPanels(db);
  if (users.length === 0 || panels.length === 0) return 0;
  const activeIds = new Set<number>();
  const now = Date.now();
  for (const panel of panels) {
    try {
      const res = await panel.getClients();
      const clients = res?.obj ?? [];
      const nowMs = now;
      for (const u of users) {
        const mine = clients.filter(
          (c: PanelClient) => String(c.tgId ?? c.comment ?? "") === String(u.tg_id),
        );
        for (const c of mine) {
          const used = (c.up ?? 0) + (c.down ?? 0) + ((c.traffic?.up ?? 0) + (c.traffic?.down ?? 0));
          const remaining = (c.totalGB ?? 0) - used;
          const timeOk = !c.expiryTime || c.expiryTime === 0 || c.expiryTime > nowMs;
          const volOk = !c.totalGB || c.totalGB === 0 || remaining > 0;
          if (c.enable && timeOk && volOk) {
            activeIds.add(u.tg_id);
            break;
          }
        }
      }
    } catch (e) {
      console.error("stats panel failed", e);
    }
  }
  return activeIds.size;
}

export async function activeSubscriberIds(db: DB): Promise<number[]> {
  const users = db.getAllUsers();
  const panels = getAllPanels(db);
  const active = new Set<number>();
  if (users.length === 0 || panels.length === 0) return [];
  const now = Date.now();
  for (const panel of panels) {
    try {
      const res = await panel.getClients();
      const clients = res?.obj ?? [];
      for (const u of users) {
        if (active.has(u.tg_id)) continue;
        const mine = clients.filter((c: PanelClient) => String(c.tgId ?? c.comment ?? "") === String(u.tg_id));
        for (const c of mine) {
          const used = (c.up ?? 0) + (c.down ?? 0) + ((c.traffic?.up ?? 0) + (c.traffic?.down ?? 0));
          const remaining = (c.totalGB ?? 0) - used;
          const timeOk = !c.expiryTime || c.expiryTime === 0 || c.expiryTime > now;
          const volOk = !c.totalGB || c.totalGB === 0 || remaining > 0;
          if (c.enable && timeOk && volOk) {
            active.add(u.tg_id);
            break;
          }
        }
      }
    } catch (e) {
      console.error("subscribers panel failed", e);
    }
  }
  return [...active];
}

async function copyMessageToUser(ctx: Context, targetId: number): Promise<boolean> {
  const msg = ctx.message!;
  try {
    await ctx.api.copyMessage(targetId, msg.chat.id, msg.message_id);
    return true;
  } catch (e) {
    console.error("broadcast copy failed", targetId, e);
    return false;
  }
}

export async function handleOwnerComposedMessage(ctx: Context, db: DB): Promise<boolean> {
  const adminId = ctx.from?.id!;
  if (!isOwner(adminId)) return false;
  if (awaitingBroadcast.has(adminId)) {
    awaitingBroadcast.delete(adminId);
    const users = db.getAllUsers();
    let ok = 0;
    let fail = 0;
    const status = await ctx.reply(`📢 شروع ارسال همگانی به ${users.length} کاربر...`);
    for (const u of users) {
      const sent = await copyMessageToUser(ctx, u.tg_id);
      if (sent) ok++;
      else fail++;
      await Util.sleep(60);
    }
    await ctx.api.editMessageText(status.chat.id, status.message_id, `📢 گزارش پیام همگانی\n\n👥 کل: ${users.length}\n✅ موفق: ${ok}\n❌ ناموفق: ${fail}`, { reply_markup: backToAdminMainMenu() }).catch(() => {});
    await showPrivilegedMain(ctx, db);
    return true;
  }
  if (awaitingSubscribers.has(adminId)) {
    awaitingSubscribers.delete(adminId);
    const ids = await activeSubscriberIds(db);
    let ok = 0;
    let fail = 0;
    const status = await ctx.reply(`💎 شروع ارسال به ${ids.length} مشترک فعال...`);
    for (const id of ids) {
      const sent = await copyMessageToUser(ctx, id);
      if (sent) ok++;
      else fail++;
      await Util.sleep(60);
    }
    await ctx.api.editMessageText(status.chat.id, status.message_id, `💎 گزارش پیام مشترکین\n\n👥 کل مشترکین فعال: ${ids.length}\n✅ موفق: ${ok}\n❌ ناموفق: ${fail}`, { reply_markup: backToAdminMainMenu() }).catch(() => {});
    await showPrivilegedMain(ctx, db);
    return true;
  }
  if (awaitingAddAdmin.has(adminId)) {
    const text = ctx.message?.text?.trim() ?? "";
    const parsed = Number(text);
    if (!text || !Number.isInteger(parsed) || parsed <= 0) {
      await ctx.reply("❌ آیدی نامعتبر است. یک عدد مثل 123456789 بفرستید یا لغو کنید.", {
        reply_markup: cancelActionMenu(),
      });
      return true;
    }
    awaitingAddAdmin.delete(adminId);
    try {
      const chat = await ctx.api.getChat(parsed);
      if (chat.type === "private") {
        db.upsertUser(parsed, chat.first_name, chat.username);
      }
    } catch {}
    const added = db.addAdmin(parsed, adminId);
    await ctx.reply(added ? `✅ ادمین ${parsed} اضافه شد.` : `⚠️ این کاربر قبلا ادمین بوده: ${parsed}`, {
      reply_markup: backToAdminMainMenu(),
    });
    try {
      await ctx.api.sendMessage(parsed, "✅ شما به عنوان ادمین FOXNG اضافه شدید. /start را بزنید.");
    } catch {}
    await showAdminManagement(ctx, db);
    return true;
  }
  if (awaitingDiscount.has(adminId)) {
    const text = ctx.message?.text?.trim() ?? "";
    const percent = Number(text);
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(percent) || percent < 1 || percent > 100) {
      await ctx.reply("❌ درصد نامعتبر است. عددی بین 1 تا 100 وارد کنید:");
      return true;
    }
    awaitingDiscount.delete(adminId);
    db.setDiscountPercent(percent);
    await showDiscountManagement(ctx, db);
    return true;
  }
  const panelReplace = panelReplaceFlow.get(adminId);
  if (panelReplace) {
    await handlePanelReplaceStep(ctx, db, adminId, panelReplace);
    return true;
  }
  return false;
}

/** Legacy admin panel-state handler (kept for compat, now inline). */
export async function handleAdminMessage(ctx: Context, db: DB): Promise<boolean> {
  void db;
  void ctx;
  return false;
}

export async function handleBackup(ctx: Context, db: DB) {
  try {
    const requester = ctx.from?.id!;
    if (!isOwner(requester)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
      else await ctx.reply("⛔ فقط مالک به این بخش دسترسی دارد.");
      return;
    }

    const fs = await import("node:fs/promises");
    const stamp = Util.timestampName("foxng_backup", "db");
    const tmpPath = `./${stamp}`;

    // VACUUM INTO produces a consistent snapshot while the live DB stays in use.
    db.backupTo(tmpPath);
    const bytes = new Uint8Array(await Bun.file(tmpPath).arrayBuffer());
    const file = new InputFile(bytes, stamp);
    const target = ctx.callbackQuery ? requester : ADMIN_ID;
    await ctx.api.sendDocument(target, file, {
      caption: `💾 بکاپ دیتابیس\n${stamp}`,
      reply_markup: backToAdminMainMenu(),
    });
    await fs.unlink(tmpPath).catch(() => {});
  } catch (error) {
    console.error("Backup failed:", error);
    await ctx.reply("❌ بکاپ ناموفق بود. لطفا دوباره تلاش کنید.", {
      reply_markup: backToAdminMainMenu(),
    });
  }
}
