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
  handleBackup,
  handleCheckAccount,
  handleCreateAccount,
  handleCreateDeclineCallback,
  handleGetConfig,
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

      const userId = Number(
        ctx.callbackQuery?.data!.replace("createAccept:", ""),
      );
      const pending = pendingCreates.get(userId);
      if (!pending)
        return await ctx.answerCallbackQuery({ text: "No pending request" });

      const panels = getAllPanels(db);
      if (panels.length === 0)
        return await ctx.answerCallbackQuery({ text: "No panels available" });

      for (const panel of panels) {
        if (panel.name === WHICH_PANEL) {
          const uuid = await panel.getNewUUID();
          const email = creatingEmail.get(userId)!;

          const type = pendingCreateConfigType.get(userId)!;

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
      }
    });
    this.bot.callbackQuery(/^renewAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (!isAdminOrOwner(db, adminID))
        return await ctx.answerCallbackQuery({ text: "Not allowed" });

      const userId = Number(
        ctx.callbackQuery?.data!.replace("renewAccept:", ""),
      );
      const pending = pendingRenewals.get(userId);
      if (!pending)
        return await ctx.answerCallbackQuery({ text: "No pending request" });

      const { UUID, inboundID } = pendingConfig.get(userId)!;
      const type = pendingConfigType.get(userId)!;

      pendingRenewals.delete(userId);
      pendingConfig.delete(userId);
      pendingConfigType.delete(userId);

      const configs = renewCache[userId]?.filter(
        (v) =>
          (v.isRenewable && v.uuid === UUID) ||
          (v.status === false && v.uuid === UUID),
      );

      const rawEmail = Util.removeEmoji(configs?.at(0)?.email!);
      const emailParts = rawEmail.split("-");
      const email = emailParts.slice(1).join("-");

      console.log("the UUID:", UUID);

      const panel = await getConfigsPanel(UUID, db);
      if (!panel) {
        return await ctx.answerCallbackQuery({ text: "Panel not found!" });
      }

      let settings = "";
      if (type === "250") {
        settings = JSON.stringify({
          clients: [
            {
              id: UUID,
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
              id: UUID,
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

      const body = JSON.stringify({
        id: inboundID,
        settings: settings,
      });

      const url = panel.getUpdatePath(panel.url, UUID);

      const req = Util.newPostRequest(url, panel.headers, body);

      const res = await fetch(req);

      if (res.status === 200) {
        const reset = await panel.resetClientTraffic(inboundID, email);
        if (reset) {
          await ctx.api.sendMessage(userId, "اشتراک شما با موفقیت فعال شد ✅");
          await ctx.reply("تایید شد ✅");
          await ctx.answerCallbackQuery();
        }
      } else {
        console.log(res.status);
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
