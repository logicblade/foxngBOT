import { Bot, type Context, InputFile } from "grammy";
import { DB } from "../../util/db";
import {
  addPanelConv,
  cancelBroadcast,
  executeBroadcast,
  formatAdminTag,
  genConfig,
  getConfigCache,
  getConfigsPanel,
  handleAdminIdMessage,
  handleAdminMenuCallback,
  handleAdminsMenuCallback,
  handleBroadcastMessage,
  handleCreateDeclineCallback,
  handleImagesIncome,
  handleOrderCancel,
  handlePlanSelection,
  handleRenewCallback,
  handleRenewDeclineCallback,
  handleStartCommandForAdmin,
  handleStartCommandForUser,
  handleUserMenuCallback,
  isOwner,
  isPrivileged,
  notifyOtherReviewers,
  pendingConfig,
  pendingConfigType,
  pendingCreateConfig,
  pendingCreateConfigType,
  pendingCreates,
  pendingRenewals,
  removePanelConv,
  renewCache,
  waitingForCreateImage,
  waitingForRenewImage,
} from "./helpers";
import { adminMenu, mainMenu, subAdminMenu } from "./keyboards";
import { getPlan } from "./plans";
import { type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { Util } from "../../util/util";
import { getAllPanels } from "../panel/panel";
import { WHICH_INBOUND, WHICH_PANEL } from "../..";

export const creatingEmail = new Map<number, string>();

export class TelBot {
  bot: Bot<ConversationFlavor<Context>>;

  constructor(token: string, db: DB) {
    this.bot = new Bot<ConversationFlavor<Context>>(token);

    this.bot.use(conversations());
    this.bot.use(createConversation(addPanelConv));
    this.bot.use(createConversation(removePanelConv));

    this.bot.command("start", async (ctx) => {
      if (isOwner(ctx.from?.id) || db.isAdmin(ctx.from?.id!)) {
        await handleStartCommandForAdmin(ctx, db);
      } else {
        await handleStartCommandForUser(ctx, db);
      }
    });

    this.bot.on("message", async (ctx) => {
      const userID = ctx.from.id;
      db.upsertUser(userID);
      if (
        waitingForRenewImage.has(userID) ||
        waitingForCreateImage.has(userID)
      ) {
        await handleImagesIncome(ctx, db);
        return;
      }
      // Owner admin flows: broadcast input + admin-ID entry (text-based).
      if (isOwner(userID)) {
        if (await handleBroadcastMessage(ctx, db)) return;
        if (await handleAdminIdMessage(ctx, db)) return;
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

    this.bot.callbackQuery(/^renew:/, handleRenewCallback);

    this.bot.callbackQuery(/^renewDecline:/, async (ctx) =>
      handleRenewDeclineCallback(ctx, db),
    );
    this.bot.callbackQuery(/^createDecline:/, async (ctx) =>
      handleCreateDeclineCallback(ctx, db),
    );
    this.bot.callbackQuery(/^createAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (!isPrivileged(db, adminID))
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

        const type = pendingCreateConfigType.get(userId);
        const plan = getPlan(type ?? "");
        if (!plan) {
          console.error(`createAccept: unknown plan type=${type}`);
          return await ctx.reply(`خطا: پلن نامشخص (${type})`);
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
      if (!isPrivileged(db, adminID))
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

      await ctx.deleteMessage();
      await ctx.api.sendPhoto(userID, qrFile, {
        caption: `لینک کانفیگ شما به نام ${Util.removeEmoji(selected?.email!)} 👇\n(برای کپی کردن لینک یک بار روی آن کلیک کنید.)\n\n<code>${configLink}</code>`,
        parse_mode: "HTML",
        reply_markup: mainMenu,
      });
      await ctx.answerCallbackQuery();
    });
  }
}
