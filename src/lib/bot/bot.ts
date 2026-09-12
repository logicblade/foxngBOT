import { Bot, Context, InputFile, Keyboard } from "grammy";
import { DB } from "../../util/db";
import {
  addPanelConv,
  ADMIN_ID,
  genConfig,
  getConfigCache,
  getConfigsPanel,
  handleBackup,
  handleBroadcastConfirm,
  handleBroadcastMessage,
  handleCheckAccount,
  handleCreateAccount,
  handleCreateDeclineCallback,
  handleGetConfig,
  handleImagesIncome,
  handleRenewAccount,
  handleRenewCallback,
  handleRenewDeclineCallback,
  handleStartCommandForAdmin,
  handleStartCommandForUser,
  pendingBroadcast,
  pendingConfig,
  pendingConfigType,
  pendingCreateConfig,
  pendingCreateConfigType,
  pendingCreates,
  pendingRenewals,
  removePanelConv,
  renewCache,
  showPanelsListToAdmin,
  state,
  waitingForBroadcast,
  waitingForCreateImage,
  waitingForRenewImage,
} from "./helpers";
import {
  buySubBtn,
  tutorialBtnTxt,
  myPanelsBtn,
  addPanelBtn,
  deletePanelBtn,
  renewSubBtn,
  mySubBtn,
  cancelBtn,
  greet,
  resetBtn,
  contactTxt,
  disableSellTxt,
  disableRenewTxt,
  appStateBtn,
  changeSellStateBtn,
  changeRenewStateBtn,
  getConfigBtn,
  backupBtn,
  broadcastBtn,
} from "./messages";
import { adminMenu, mainMenu } from "./keyboards";
import { PLANS, getPlan, paymentText } from "./plans";
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
      if (ctx.from?.id === ADMIN_ID) {
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
        await handleImagesIncome(ctx);
      }
      if (userID === ADMIN_ID) {
        if (await handleBroadcastMessage(ctx, db)) return;
        if (pendingBroadcast.has(userID)) {
          if (await handleBroadcastConfirm(ctx, db)) return;
        }
      }
      if (!ctx.message?.text) return;

      switch (ctx.message.text) {
        case buySubBtn:
          if (!state.isSellActive) {
            await ctx.reply(disableSellTxt, { reply_markup: mainMenu });
            break;
          }
          await handleCreateAccount(ctx);
          break;

        case mySubBtn:
          await handleCheckAccount(ctx, db);
          break;

        case renewSubBtn:
          if (!state.isRenewActive) {
            ctx.reply(disableRenewTxt, { reply_markup: mainMenu });
            break;
          }
          await handleRenewAccount(ctx, db);
          break;

        case getConfigBtn:
          await handleGetConfig(ctx, db);
          break;

        case tutorialBtnTxt:
          await ctx.reply("آموزش به زودی اضافه میشه! لطفا صبور باشید...", {
            reply_markup: mainMenu,
          });
          break;

        case contactTxt:
          await ctx.reply(
            `
برای ارتباط با پشتیبانی میتونید به آیدی زیر پیام بدید 👇

🆔: @foxngsup
      `,
            { reply_markup: mainMenu },
          );
          break;

        case resetBtn:
        case cancelBtn:
          await ctx.deleteMessage();

          waitingForRenewImage.delete(userID);
          pendingRenewals.delete(userID);
          pendingConfig.delete(userID);
          pendingConfigType.delete(userID);

          waitingForCreateImage.delete(userID);
          pendingCreates.delete(userID);
          pendingCreateConfig.delete(userID);
          pendingCreateConfigType.delete(userID);

          waitingForBroadcast.delete(userID);
          pendingBroadcast.delete(userID);

          await ctx.reply(greet, {
            reply_markup: mainMenu,
          });
          break;

        case myPanelsBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          await showPanelsListToAdmin(ctx, db);
          break;

        case addPanelBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          await ctx.conversation.enter("addPanelConv");
          break;

        case deletePanelBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          await ctx.conversation.enter("removePanelConv");
          break;

        case appStateBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          await ctx.reply(
            `وضعیت خرید و تمدید:\n\nخرید: ${state.isSellActive ? "فعال" : "غیرفعال"}\nتمدید: ${state.isRenewActive ? "فعال" : "غیرفعال"}`,
          );
          break;

        case changeSellStateBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          state.isSellActive = !state.isSellActive;
          await ctx.reply(
            `وضعیت خرید به ${state.isSellActive ? "فعال" : "غیرفعال"} تغییر پیدا کرد.`,
          );
          break;

        case changeRenewStateBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          state.isRenewActive = !state.isRenewActive;
          await ctx.reply(
            `وضعیت تمدید به ${state.isRenewActive ? "فعال" : "غیرفعال"} تغییر پیدا کرد.`,
          );
          break;

        case backupBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          await handleBackup(ctx);
          break;

        case broadcastBtn:
          if (userID !== ADMIN_ID) {
            await ctx.reply("این حرفا رو از کجا یاد گرفتی؟؟", {
              reply_markup: mainMenu,
            });
            break;
          }
          pendingBroadcast.delete(userID);
          waitingForBroadcast.add(userID);
          await ctx.reply(
            "متن یا عکسی که میخوای برای همه کاربرا بفرستم رو همینجا بفرست.\n\nاگه پشیمون شدی بنویس «بیخیال».",
            { reply_markup: adminMenu },
          );
          break;

        default: {
          const plan = PLANS.find((p) => p.buttonText === ctx.message.text);
          if (!plan) break;
          const replyOpts = {
            parse_mode: "HTML" as const,
            reply_markup: new Keyboard().text(cancelBtn).resized(),
          };
          if (pendingConfig.has(ctx.from.id)) {
            pendingConfigType.set(ctx.from.id, plan.id);
            waitingForRenewImage.add(userID);

            await ctx.reply(paymentText("renew", plan), replyOpts);
          } else if (pendingCreateConfig.has(ctx.from.id)) {
            pendingCreateConfigType.set(ctx.from.id, plan.id);
            waitingForCreateImage.add(userID);
            console.log("added create image id");

            await ctx.reply(paymentText("buy", plan), replyOpts);
          }
          break;
        }
      }
    });

    this.bot.callbackQuery(/^renew:/, handleRenewCallback);

    this.bot.callbackQuery(/^renewDecline:/, handleRenewDeclineCallback);
    this.bot.callbackQuery(/^createDecline:/, handleCreateDeclineCallback);
    this.bot.callbackQuery(/^createAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (adminID !== ADMIN_ID)
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
        });
        await ctx.reply("تایید شد ✅");
      } catch (error) {
        console.error("createAccept handler threw:", error);
        try {
          await ctx.answerCallbackQuery({ text: "خطای داخلی!" });
        } catch {}
      }
    });
    this.bot.callbackQuery(/^renewAccept:/, async (ctx: Context) => {
      const adminID = ctx.from?.id!;
      if (adminID !== ADMIN_ID)
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
          (v) =>
            (v.isRenewable && v.uuid === UUID) ||
            (v.status === false && v.uuid === UUID),
        );
        const rawEmail = configs?.at(0)?.email;
        if (!rawEmail) {
          console.error(`renewAccept: no cached config for uuid=${UUID}`);
          return await ctx.reply("خطا: اشتراک در کش پیدا نشد!");
        }

        const emailParts = Util.removeEmoji(rawEmail).split("-");
        const email = emailParts.slice(1).join("-");

        console.log("the UUID:", UUID);

        const panel = await getConfigsPanel(UUID, db);
        if (!panel) {
          return await ctx.answerCallbackQuery({ text: "Panel not found!" });
        }

        // New API replaces the whole client row: fetch current row first,
        // then add quota. Expiry stays unlimited (0 = never expires).
        const current = await panel.getClientByEmail(email);
        const currentObj = current?.obj;
        const updatedClient: PanelClientPayload = {
          email,
          uuid: UUID,
          flow: "",
          limitIp: currentObj?.limitIp ?? 0,
          totalGB:
            (currentObj?.totalGB ?? 0) + Util.gigsToBytes(plan.grantGB),
          expiryTime: 0,
          enable: true,
          tgId: userId,
          comment: String(userId),
          subId: currentObj?.subId ?? "",
        };

        let res: Response;
        try {
          res = await panel.updateClient(email, updatedClient);
        } catch (error) {
          console.error("renewAccept: updateClient threw:", error);
          return await ctx.reply("خطا در ارتباط با پنل!");
        }

        if (res.status === 200) {
          const reset = await panel.resetClientTraffic(inboundID, email);
          if (reset) {
            await ctx.api.sendMessage(userId, "اشتراک شما با موفقیت فعال شد ✅");
            await ctx.reply("تایید شد ✅");
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
      });
      await ctx.answerCallbackQuery();
    });
  }
}
