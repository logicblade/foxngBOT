import { Bot, type Context } from "grammy";
import { DB } from "../../util/db";
import {
  addPanelConv,
  approveOrder,
  awaitingAddAdmin,
  awaitingDiscount,
  awaitingBroadcast,
  awaitingSubscribers,
  genConfig,
  getConfigCache,
  getConfigsPanel,
  handleAdminIdMessage,
  handleAdminMenuCallback,
  handleAdminsMenuCallback,
  handleBroadcastMessage,
  handleCreateDeclineCallback,
  handleImagesIncome,
  handleOwnerComposedMessage,
  handleRenewAccount,
  handleRenewCallback,
  handleRenewDeclineCallback,
  handleStartCommandForAdmin,
  handleStartCommandForUser,
  isAdminOrOwner,
  isOwner,
  orderCaption,
  pendingConfig,
  pendingConfigType,
  pendingCreateConfig,
  pendingCreateConfigType,
  pendingCreates,
  pendingOrderFlow,
  pendingRenewals,
  panelReplaceFlow,
  planById,
  fullName,
  rejectOrder,
  removePanelConv,
  renewCache,
  restrictAdminToReceipts,
  showPanelsListToAdmin,
  showAdminManagement,
  showDiscountManagement,
  showPrivilegedMain,
  showUserMain,
  showUserStats,
  startPanelReplace,
  state,
  waitingForCreateImage,
  waitingForRenewImage,
} from "./helpers";
import {
  SUPPORT_ID,
  discountedPlan,
  disableRenewTxt,
  disableSellTxt,
  paymentText,
  supportMessage,
} from "./messages";
import {
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import {
  appStateMenu,
  backToAdminMainMenu,
  backToMainMenu,
  cancelActionMenu,
  orderDecisionMenu,
  pendingOrdersMenu,
  planMenu,
} from "./keyboards";
import { Util } from "../../util/util";
import { getAllPanels } from "../panel/panel";
import { WHICH_INBOUND, WHICH_PANEL } from "../config";

export const creatingEmail = new Map<number, string>();

export class TelBot {
  bot: Bot<ConversationFlavor<Context>>;

  constructor(token: string, db: DB) {
    this.bot = new Bot<ConversationFlavor<Context>>(token);

    this.bot.api.config.use(async (prev, method, payload, signal) => {
      if (
        method === "sendMessage" ||
        method === "sendPhoto" ||
        method === "sendDocument" ||
        method === "editMessageText"
      ) {
        const messagePayload = payload as {
          reply_markup?: Parameters<typeof withBackHomeButton>[0];
        };
        messagePayload.reply_markup = withBackHomeButton(
          messagePayload.reply_markup,
        );
      }

      return await prev(method, payload, signal);
    });

    this.bot.use(conversations());
    this.bot.use(createConversation(addPanelConv));
    this.bot.use(createConversation(removePanelConv));

    this.bot.command("start", async (ctx) => {
      const tgId = ctx.from?.id!;
      db.upsertUser(tgId, ctx.from?.first_name, ctx.from?.username);
      if (isAdminOrOwner(db, tgId)) {
        await handleStartCommandForAdmin(ctx, db);
      } else {
        await handleStartCommandForUser(ctx, db);
      }
    });

    this.bot.on("message", async (ctx) => {
      const userID = ctx.from.id;
      db.upsertUser(userID, ctx.from?.first_name, ctx.from?.username);

      // Owner compose states take precedence (broadcast / subscribers / add-admin).
      if (await handleOwnerComposedMessage(ctx, db)) return;

      // New PENDING order receipt flow.
      const flow = pendingOrderFlow.get(userID);
      if (flow) {
        if (ctx.message?.photo) {
          await handleImagesIncome(ctx, db);
          return;
        }
        if (flow.orderId) {
          // A plan was selected: we are waiting for the payment receipt photo.
          await ctx.reply("🧾 لطفا عکس رسید تراکنش را همین‌جا بفرستید 👇", {
            reply_markup: cancelActionMenu(),
          });
          return;
        }
        // Subscription selected but no plan yet.
        await ctx.reply("لطفا پلن مورد نظر را انتخاب کنید 👇", {
          reply_markup: planMenu(flow.type, undefined, db.getDiscountPercent()),
        });
        return;
      }
      if (waitingForRenewImage.has(userID) || waitingForCreateImage.has(userID)) {
        await handleImagesIncome(ctx, db);
        return;
      }
      if (!ctx.message?.text) return;

      // Reply keyboards were removed: any free text returns the right main menu.
      if (isAdminOrOwner(db, userID)) {
        await showPrivilegedMain(ctx, db);
      } else {
        await showUserMain(ctx);
      }
    });
    // Inline menus (primary UX): menu:* / admin:* / plan:* / order:* / broadcast:*.
    this.bot.callbackQuery(/^menu:/, async (ctx) => {
      db.upsertUser(ctx.from.id);
      await handleUserMenuCallback(ctx, db);
    });
    this.bot.callbackQuery(/^admin:/, async (ctx) => {
      if (!isPrivileged(db, ctx.from?.id)) {
        return await ctx.answerCallbackQuery({ text: "Not allowed" });
      }
      await handleAdminMenuCallback(ctx, db);
    });
    this.bot.callbackQuery(/^plan:/, async (ctx) => {
      db.upsertUser(ctx.from.id);
      const planId = ctx.callbackQuery?.data?.replace("plan:", "");
      const plan = getPlan(planId);
      if (!plan) return await ctx.answerCallbackQuery();
      await ctx.answerCallbackQuery().catch(() => {});
      await handlePlanSelection(ctx, { planId: plan.id });
    });
    this.bot.callbackQuery("order:cancel", handleOrderCancel);
    this.bot.callbackQuery(/^admins:/, async (ctx) => {
      if (!isOwner(ctx.from?.id)) {
        return await ctx.answerCallbackQuery({ text: "Owner only" });
      }
      await handleAdminsMenuCallback(ctx, db);
    });
    this.bot.callbackQuery("broadcast:confirm", async (ctx) => {
      if (!isOwner(ctx.from?.id)) {
        return await ctx.answerCallbackQuery({ text: "Not allowed" });
      }
      await executeBroadcast(ctx, db);
    });
    this.bot.callbackQuery("broadcast:cancel", cancelBroadcast);

    this.bot.callbackQuery("user:main", async (ctx) => {
      if (isAdminOrOwner(db, ctx.from?.id!)) {
        await showPrivilegedMain(ctx, db);
      } else {
        await showUserMain(ctx);
      }
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("admin:main", async (ctx) => {
      if (!isAdminOrOwner(db, ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید" });
        return;
      }
      await showPrivilegedMain(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("user:buy", async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      if (!state.isSellActive) {
        await ctx.reply(disableSellTxt, { reply_markup: backToMainMenu() });
        return;
      }
      await handleCreateAccount(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("user:renew", async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      if (!state.isRenewActive) {
        await ctx.reply(disableRenewTxt, { reply_markup: backToMainMenu() });
        return;
      }
      await handleRenewAccount(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("user:volume", async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      await handleCheckAccount(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("user:getconfig", async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      await handleGetConfig(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("user:support", async (ctx) => {
      await ctx.reply(supportMessage(), { reply_markup: backToMainMenu() });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("buy:cancel", async (ctx) => {
      const userId = ctx.from?.id!;
      db.cancelPendingOrdersForUser(userId);
      pendingOrderFlow.delete(userId);
      await showUserMain(ctx, "سفارش لغو شد. ❌");
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("renew:cancel", async (ctx) => {
      const userId = ctx.from?.id!;
      db.cancelPendingOrdersForUser(userId);
      pendingOrderFlow.delete(userId);
      await showUserMain(ctx, "سفارش لغو شد. ❌");
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("buy:support", async (ctx) => {
      await ctx.reply(`برای حجم بیشتر با پشتیبانی در ارتباط باشید 👇\n\n🆔: ${SUPPORT_ID}`, {
        reply_markup: backToMainMenu(),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("renew:support", async (ctx) => {
      await ctx.reply(`برای حجم بیشتر با پشتیبانی در ارتباط باشید 👇\n\n🆔: ${SUPPORT_ID}`, {
        reply_markup: backToMainMenu(),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^buy:plan:/, async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      const planId = (ctx.callbackQuery?.data ?? "").replace("buy:plan:", "");
      const plan = planById(planId);
      if (!plan) {
        await ctx.answerCallbackQuery({ text: "پلن نامعتبر است" });
        return;
      }
      const userId = ctx.from?.id!;
      db.cancelPendingOrdersForUser(userId);
      const pricedPlan = discountedPlan(plan, db.getDiscountPercent());
      const orderId = db.createOrder({
        tgId: userId,
        tgName: fullName(ctx),
        tgUsername: ctx.from?.username,
        type: "buy",
        planId: plan.id,
        volumeGB: plan.volumeGB,
        durationDays: plan.days,
        price: pricedPlan.price,
      });
      pendingOrderFlow.set(userId, { type: "buy", orderId });
      const text = `${paymentText("buy", pricedPlan, plan.price)}\n\n🧾 سفارش #${orderId} ثبت شد (در انتظار رسید).`;
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMainMenu() });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^renew:plan:/, async (ctx) => {
      if (await restrictAdminToReceipts(ctx, db)) return;
      const planId = (ctx.callbackQuery?.data ?? "").replace("renew:plan:", "");
      const plan = planById(planId);
      if (!plan) {
        await ctx.answerCallbackQuery({ text: "پلن نامعتبر است" });
        return;
      }
      const userId = ctx.from?.id!;
      const flow = pendingOrderFlow.get(userId);
      if (!flow?.targetUUID) {
        await ctx.answerCallbackQuery({ text: "اول اشتراک را انتخاب کنید" });
        await handleRenewAccount(ctx, db);
        return;
      }
      db.cancelPendingOrdersForUser(userId);
      const pricedPlan = discountedPlan(plan, db.getDiscountPercent());
      const orderId = db.createOrder({
        tgId: userId,
        tgName: fullName(ctx),
        tgUsername: ctx.from?.username,
        type: "renew",
        planId: plan.id,
        volumeGB: plan.volumeGB,
        durationDays: plan.days,
        price: pricedPlan.price,
        targetUUID: flow.targetUUID,
        targetInboundId: flow.targetInboundID ?? null,
      });
      pendingOrderFlow.set(userId, {
        type: "renew",
        orderId,
        targetUUID: flow.targetUUID,
        targetInboundID: flow.targetInboundID,
      });
      const text = `${paymentText("renew", pricedPlan, plan.price)}\n\n🧾 سفارش #${orderId} ثبت شد (در انتظار رسید).`;
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMainMenu() });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("admin:orders", async (ctx) => {
      if (!isAdminOrOwner(db, ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید" });
        return;
      }
      const orders = db.getPendingOrders(10);
      if (orders.length === 0) {
        await ctx.reply("🧾 سفارش در انتظاری وجود ندارد. ✅", {
          reply_markup: backToAdminMainMenu(),
        });
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }
      await ctx.reply("🧾 سفارش‌های در انتظار 👇", {
        reply_markup: pendingOrdersMenu(orders),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^admin:order:/, async (ctx) => {
      if (!isAdminOrOwner(db, ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید" });
        return;
      }
      const id = Number((ctx.callbackQuery?.data ?? "").replace("admin:order:", ""));
      const order = db.getOrderById(id);
      if (!order) {
        await ctx.answerCallbackQuery({ text: "سفارش پیدا نشد" });
        return;
      }
      if (order.receipt_file_id) {
        try {
          await ctx.replyWithPhoto(order.receipt_file_id, {
            caption: orderCaption(order),
            reply_markup: orderDecisionMenu(order.id),
          });
        } catch {
          await ctx.reply(orderCaption(order), { reply_markup: orderDecisionMenu(order.id) });
        }
      } else {
        await ctx.reply(orderCaption(order), { reply_markup: orderDecisionMenu(order.id) });
      }
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^admin:approve:/, async (ctx) => {
      const id = Number((ctx.callbackQuery?.data ?? "").replace("admin:approve:", ""));
      await approveOrder(ctx, db, id);
    });

    this.bot.callbackQuery(/^admin:reject:/, async (ctx) => {
      const id = Number((ctx.callbackQuery?.data ?? "").replace("admin:reject:", ""));
      await rejectOrder(ctx, db, id);
    });

    this.bot.callbackQuery("owner:stats", async (ctx) => {
      await showUserStats(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:broadcast", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      awaitingBroadcast.add(ctx.from?.id!);
      await ctx.reply("پیام خود را ارسال کنید:", { reply_markup: cancelActionMenu() });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:subscribers", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      awaitingSubscribers.add(ctx.from?.id!);
      await ctx.reply("پیام مشترکین را ارسال کنید:", { reply_markup: cancelActionMenu() });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:backup", async (ctx) => {
      await handleBackup(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:admins", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      await showAdminManagement(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:admin:add", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      awaitingAddAdmin.add(ctx.from?.id!);
      await ctx.reply("آیدی عددی ادمین جدید را بفرستید (مثال: 123456789):", {
        reply_markup: cancelActionMenu(),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^owner:admin:remove:/, async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      const adminId = Number((ctx.callbackQuery?.data ?? "").replace("owner:admin:remove:", ""));
      if (!Number.isInteger(adminId) || adminId <= 0) {
        await ctx.answerCallbackQuery({ text: "آیدی نامعتبر" });
        return;
      }
      const removed = db.removeAdmin(adminId);
      await showAdminManagement(ctx, db);
      await ctx.answerCallbackQuery({ text: removed ? "ادمین حذف شد ✅" : "ادمین پیدا نشد" });
    });

    this.bot.callbackQuery("owner:discounts", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      await showDiscountManagement(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:discount:apply", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      awaitingDiscount.add(ctx.from?.id!);
      await ctx.reply("درصد تخفیف را وارد کنید (عدد بین 1 تا 100):", {
        reply_markup: cancelActionMenu(),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:discount:cancel", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      db.setDiscountPercent(null);
      await showDiscountManagement(ctx, db);
      await ctx.answerCallbackQuery({ text: "تخفیف لغو شد ✅" });
    });

    this.bot.callbackQuery("owner:panels", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      await showPanelsListToAdmin(ctx, db);
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:panel:add", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      await ctx.conversation.enter("addPanelConv");
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^panel:replace:/, async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      const id = Number(
        (ctx.callbackQuery?.data ?? "").replace("panel:replace:", ""),
      );
      if (!Number.isInteger(id) || id <= 0) {
        await ctx.answerCallbackQuery({ text: "پنل نامعتبر" });
        return;
      }
      await startPanelReplace(ctx, db, id);
    });

    this.bot.callbackQuery("owner:appstate", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      try {
        await ctx.editMessageText("⚙️ وضعیت خرید و تمدید", {
          reply_markup: appStateMenu(state.isSellActive, state.isRenewActive),
        });
      } catch {
        await ctx.reply("⚙️ وضعیت خرید و تمدید", {
          reply_markup: appStateMenu(state.isSellActive, state.isRenewActive),
        });
      }
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery("owner:toggle_sell", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      state.isSellActive = !state.isSellActive;
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: appStateMenu(state.isSellActive, state.isRenewActive),
        });
      } catch {}
      await ctx.answerCallbackQuery({
        text: `خرید ${state.isSellActive ? "فعال" : "غیرفعال"} شد`,
      });
    });

    this.bot.callbackQuery("owner:toggle_renew", async (ctx) => {
      if (!isOwner(ctx.from?.id!)) {
        await ctx.answerCallbackQuery({ text: "⛔ فقط مالک" });
        return;
      }
      state.isRenewActive = !state.isRenewActive;
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: appStateMenu(state.isSellActive, state.isRenewActive),
        });
      } catch {}
      await ctx.answerCallbackQuery({
        text: `تمدید ${state.isRenewActive ? "فعال" : "غیرفعال"} شد`,
      });
    });

    this.bot.callbackQuery("action:cancel", async (ctx) => {
      const id = ctx.from?.id!;
      awaitingBroadcast.delete(id);
      awaitingSubscribers.delete(id);
      awaitingAddAdmin.delete(id);
      awaitingDiscount.delete(id);
      panelReplaceFlow.delete(id);
      pendingOrderFlow.delete(id);
      if (isAdminOrOwner(db, id)) await showPrivilegedMain(ctx, db);
      else await showUserMain(ctx, "لغو شد. ❌");
      await ctx.answerCallbackQuery().catch(() => {});
    });

    this.bot.callbackQuery(/^renew:/, async (ctx) => handleRenewCallback(ctx, db));

    this.bot.callbackQuery(/^renewDecline:/, async (ctx) => handleRenewDeclineCallback(ctx, db));
    this.bot.callbackQuery(/^createDecline:/, async (ctx) => handleCreateDeclineCallback(ctx, db));
    // Legacy in-memory approvals (kept; new DB flow uses admin:approve:/reject:).
    this.bot.callbackQuery(/^createAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (!isAdminOrOwner(db, adminID))
        return await ctx.answerCallbackQuery({ text: "Not allowed" });

      try {
        const userId = Number(
          ctx.callbackQuery?.data!.replace("createAccept:", ""),
        );
        const pending = pendingCreates.get(userId);
        if (!pending)
          return await ctx.answerCallbackQuery({ text: "No pending request" });

        const panels = getAllPanels(db);
        if (panels.length === 0)
          return await ctx.answerCallbackQuery({ text: "No panels available" });

        const panel = panels.find((p) => p.name === WHICH_PANEL);
        if (!panel)
          return await ctx.answerCallbackQuery({ text: "Panel not found!" });

        await ctx.answerCallbackQuery({ text: "در حال ساخت..." });

          pendingCreates.delete(userId);
          pendingCreateConfig.delete(userId);
          pendingCreateConfigType.delete(userId);

          let settings = "";
          if (type === "250") {
            settings = JSON.stringify({
              clients: [
                {
                  id: uuid,
                  flow: "",
                  email,
                  limitIp: 0,
                  totalGB: Util.gigsToBytes(30),
                  expiryTime: Date.now() + Util.getUnixTimeOf({ days: 30 }),
                  enable: true,
                  tgId: userId,
                  subId: "",
                  comment: String(userId),
                  reset: 0,
                },
              ],
            });
          } else if (type === "450") {
            settings = JSON.stringify({
              clients: [
                {
                  id: uuid,
                  flow: "",
                  email,
                  limitIp: 0,
                  totalGB: Util.gigsToBytes(65),
                  expiryTime: Date.now() + Util.getUnixTimeOf({ days: 30 }),
                  enable: true,
                  tgId: userId,
                  subId: "",
                  comment: String(userId),
                  reset: 0,
                },
              ],
            });
          }

          creatingEmail.delete(userId);

          const body = JSON.stringify({
            id: Number(WHICH_INBOUND),
            settings: settings,
          });

          const url = panel.getAddClientPath(panel.url);

          const req = Util.newPostRequest(url, panel.headers, body);

          const res = await fetch(req);

          const responseBody = await res.body?.text();

          if (res.status === 200 && responseBody?.includes("true")) {
            // The panel record is authoritative. Some panel versions replace
            // the offered UUID, so read it back before composing the link.
            const created = await panel.getClientByEmail(email);
            const panelUuid = created?.obj?.uuid ?? uuid;
            if (!panelUuid) {
              await ctx.answerCallbackQuery({ text: "کاربر ساخته شد اما UUID پنل پیدا نشد" });
              return;
            }
            const { qrFile, configLink } = await genConfig(
              panel,
              email,
              panelUuid,
              Number(WHICH_INBOUND),
            );
            await ctx.api.sendPhoto(userId, qrFile, {
              caption: `اشتراک شما با موفقیت فعال شد ✅\n\nلینک کانفیگ شما 👇\n(برای کپی کردن لینک یک بار روی آن کلیک کنید.)\n\n<code>${configLink}</code>`,
              parse_mode: "HTML",
              reply_markup: backToMainMenu(),
            });
            await ctx.reply("تایید شد ✅");
            await ctx.answerCallbackQuery();
          } else {
            console.log(res.status, responseBody);
            await ctx.answerCallbackQuery({ text: "خطا در ساخت اشتراک!" });
          }
          break;
        }
        const email = creatingEmail.get(userId);
        if (!email) {
          console.error(`createAccept: no email for user=${userId}`);
          return await ctx.reply("خطا: ایمیل کاربر پیدا نشد!");
        }

        const uuid = await panel.getNewUUID();
        if (!uuid) {
          return await ctx.reply("خطا در گرفتن UUID از پنل!");
        }

        pendingCreates.delete(userId);
        pendingCreateConfig.delete(userId);
        pendingCreateConfigType.delete(userId);

        // Granted quota comes from the plan table (title GB vs granted GB).
        // expiryTime 0 = never expires (time-unlimited, quota-only).
        const newClient: NewPanelClient = {
          email,
          uuid,
          flow: "",
          limitIp: 0,
          totalGB: Util.gigsToBytes(plan.grantGB),
          expiryTime: 0,
          enable: true,
          tgId: userId,
          comment: String(userId),
          subId: "",
        };

        creatingEmail.delete(userId);

        let added: AddClientResult;
        try {
          added = await panel.addClient(Number(WHICH_INBOUND), newClient);
        } catch (error) {
          console.error("createAccept: addClient threw:", error);
          return await ctx.reply("خطا در ارتباط با پنل!");
        }

        if (!added.ok || !added.uuid) {
          console.error(
            `createAccept: addClient failed status=${added.status} body=${added.body}`,
          );
          return await ctx.reply(
            "خطا: UUID از پنل تأیید نشد! اشتراک ممکنه ساخته شده باشه، پنل رو چک کن ❌",
          );
        }

        // The panel's stored uuid is the source of truth for the config link.
        // Seed the display bonus (title GB minus granted GB) for the status view.
        db.setClientBonus(added.uuid, plan.titleGB - plan.grantGB);

        let qrFile: InputFile;
        let configLink: string;
        try {
          ({ qrFile, configLink } = await genConfig(panel, email, added.uuid));
        } catch (error) {
          console.error("createAccept: genConfig threw:", error);
          await ctx.api.sendMessage(
            userId,
            "اشتراک شما ساخته شد ولی ساخت لینک کانفیگ خطا خورد. به پشتیبانی پیام بده 👇\n\n🆔: @foxngsup",
          );
          return await ctx.reply("ساخته شد ولی لینک خطا خورد ❌");
        }
        await ctx.api.sendPhoto(userId, qrFile, {
          caption: `اشتراک شما با موفقیت فعال شد ✅\n\nلینک کانفیگ شما 👇\n(برای کپی کردن لینک یک بار روی آن کلیک کنید.)\n\n<code>${configLink}</code>\n\nاگه بلد نیستی از لینک استفاده کنی از دکمه\n"⚙️ آموزش اتصال به کانفیگ" استفاده کن`,
          parse_mode: "HTML",
          reply_markup: mainMenu,
        });
        await notifyOtherReviewers(
          ctx,
          db,
          `✅ درخواست خرید کاربر ${userId} توسط ${formatAdminTag(ctx)} تایید شد.`,
        );
        const menu = isOwner(ctx.from?.id) ? adminMenu(true) : subAdminMenu;
        await ctx.reply("تایید شد ✅", { reply_markup: menu });
      } catch (error) {
        console.error("createAccept handler threw:", error);
        try {
          await ctx.answerCallbackQuery({ text: "خطای داخلی!" });
        } catch {}
      }
    });
    this.bot.callbackQuery(/^renewAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (!isAdminOrOwner(db, adminID))
        return await ctx.answerCallbackQuery({ text: "Not allowed" });

      try {
        const userId = Number(
          ctx.callbackQuery?.data!.replace("renewAccept:", ""),
        );
        const pending = pendingRenewals.get(userId);
        if (!pending)
          return await ctx.answerCallbackQuery({ text: "No pending request" });

        await ctx.answerCallbackQuery({ text: "در حال تمدید..." });

        const pendingCfg = pendingConfig.get(userId);
        if (!pendingCfg) {
          console.error(`renewAccept: no pendingConfig for user=${userId}`);
          return await ctx.reply("خطا: اطلاعات تمدید پیدا نشد!");
        }
        const { UUID, inboundID } = pendingCfg;
        const type = pendingConfigType.get(userId);
        const plan = getPlan(type ?? "");
        if (!plan) {
          console.error(`renewAccept: unknown plan type=${type}`);
          return await ctx.reply(`خطا: پلن نامشخص (${type})`);
        }

        pendingRenewals.delete(userId);
        pendingConfig.delete(userId);
        pendingConfigType.delete(userId);

        const configs = renewCache[userId]?.filter(
          (v) => v.uuid === UUID,
        );
        const rawEmail = configs?.at(0)?.email;
        if (!rawEmail) {
          console.error(`renewAccept: no cached config for uuid=${UUID}`);
          return await ctx.reply("خطا: اشتراک در کش پیدا نشد!");
        }

        console.log("the UUID:", UUID);

        const panel = await getConfigsPanel(UUID, db);
        if (!panel) {
          return await ctx.answerCallbackQuery({ text: "Panel not found!" });
        }

        // ADD the new quota to the ALREADY REMAINING quota:
        // newTotal = remaining + grant. Traffic is reset afterwards, so the
        // post-reset remaining equals newTotal (old remainder is preserved).
        // The client row is resolved by UUID (not by parsing the display
        // email, which breaks when inbound remarks contain dashes) so the
        // current quota is read reliably and never silently replaced.
        // Expiry stays unlimited (0 = never expires).
        const parsedParts = Util.removeEmoji(rawEmail).split("-");
        const parsedEmail = parsedParts.slice(1).join("-");

        let row = await panel.findClientByUUID(UUID);
        if (!row && parsedEmail) {
          const current = await panel.getClientByEmail(parsedEmail);
          const obj = current?.obj;
          row = Array.isArray(obj) ? obj[0] : obj;
        }
        if (!row) {
          console.error(
            `renewAccept: client row not found uuid=${UUID} email=${parsedEmail}`,
          );
          return await ctx.reply("خطا: اشتراک در پنل پیدا نشد!");
        }
        const email = row.email;
        // Coerce: the panel may serialize big counters as strings, and plain
        // `+` on strings concatenates (huge `used` -> zero remaining -> the
        // renew looks like a replace instead of an add).
        const num = (v: unknown) => {
          const n = Number(v ?? 0);
          return Number.isFinite(n) ? n : 0;
        };
        const currentTotal: number = num(row?.totalGB);
        const traffic = row?.traffic;
        const currentUsed: number = traffic
          ? num(traffic.up) + num(traffic.down)
          : num((row as PanelClient)?.up) + num((row as PanelClient)?.down);
        const currentRemaining =
          currentTotal === 0
            ? 0
            : Math.max(0, currentTotal - currentUsed);
        const newTotalGB =
          currentTotal === 0
            ? Util.gigsToBytes(plan.grantGB)
            : currentRemaining + Util.gigsToBytes(plan.grantGB);
        // Accrue the display bonus (title minus grant) so the status view
        // keeps showing title GBs across stacked renewals.
        const prevBonus =
          db.getClientBonus(UUID) ?? Util.inferBonusGB(currentTotal);
        const newBonus = prevBonus + (plan.titleGB - plan.grantGB);
        console.log(
          `renewAccept: ${email} total=${currentTotal} used=${currentUsed} remaining=${currentRemaining} grant=${plan.grantGB}GB newTotal=${newTotalGB} bonus=${prevBonus}->${newBonus}`,
        );
        const updatedClient: PanelClientPayload = {
          email,
          uuid: UUID,
          flow: "",
          limitIp: row?.limitIp ?? 0,
          totalGB: newTotalGB,
          expiryTime: 0,
          enable: true,
          tgId: userId,
          comment: String(userId),
          subId: row?.subId ?? "",
        };

        let res: Response;
        try {
          res = await panel.updateClient(email, updatedClient);
        } catch (error) {
          console.error("renewAccept: updateClient threw:", error);
          return await ctx.reply("خطا در ارتباط با پنل!");
        }

        if (res.status === 200) {
          db.setClientBonus(UUID, newBonus);
          const reset = await panel.resetClientTraffic(inboundID, email);
          if (reset) {
            await ctx.api.sendMessage(userId, "اشتراک شما با موفقیت فعال شد ✅", {
              reply_markup: mainMenu,
            });
            await notifyOtherReviewers(
              ctx,
              db,
              `✅ درخواست تمدید کاربر ${userId} توسط ${formatAdminTag(ctx)} تایید شد.`,
            );
            const menu = isOwner(ctx.from?.id) ? adminMenu(true) : subAdminMenu;
            await ctx.reply("تایید شد ✅", { reply_markup: menu });
            await ctx.answerCallbackQuery();
          } else {
            console.error(`renewAccept: resetClientTraffic failed for ${email}`);
            await ctx.reply("تمدید شد ولی ریست ترافیک خطا خورد ❌");
          }
        } else {
          const body = await res.text().catch(() => "");
          console.error(`renewAccept: updateClient status=${res.status} body=${body}`);
          await ctx.reply("خطا در تمدید اشتراک!");
        }
      } catch (error) {
        console.error("renewAccept handler threw:", error);
        try {
          await ctx.answerCallbackQuery({ text: "خطای داخلی!" });
        } catch {}
      }
    });
    this.bot.callbackQuery(/^getConfig:/, async (ctx) => {
      const index = Number(ctx.callbackQuery?.data?.replace("getConfig:", ""));
      const userID = ctx.from?.id!;

      const configs = getConfigCache[userID];

      if (!configs) return;

      const selected = configs[index];

      const panel = await getConfigsPanel(selected?.uuid!, db);

      const { qrFile, configLink } = await genConfig(
        panel!,
        Util.removeEmoji(selected?.email.split("-").slice(1).join("-")!),
        selected?.uuid!,
        selected?.inboundID,
      );

      await ctx.deleteMessage().catch(() => {});
      await ctx.api.sendPhoto(userID, qrFile, {
        caption: `لینک کانفیگ شما به نام ${Util.removeEmoji(selected?.email!)} 👇\n(برای کپی کردن لینک یک بار روی آن کلیک کنید.)\n\n<code>${configLink}</code>`,
        parse_mode: "HTML",
        reply_markup: backToMainMenu(),
      });
      await ctx.answerCallbackQuery();
    });
  }
}
