import { InlineKeyboard } from "grammy";
import {
  tutorialBtnTxt,
  renewSubBtn,
  buySubBtn,
  mySubBtn,
  contactTxt,
  resetBtn,
  cancelBtn,
  addPanelBtn,
  myPanelsBtn,
  deletePanelBtn,
  appStateBtn,
  changeRenewStateBtn,
  changeSellStateBtn,
  getConfigBtn,
  backupBtn,
  broadcastBtn,
  broadcastSubsBtn,
  userCountBtn,
  adminsBtn,
} from "./messages";
import { PLANS } from "./plans";

// All menus are inline (callback_data based) so no persistent reply keyboard
// ever stays on screen.

export const mainMenu = new InlineKeyboard()
  .text(buySubBtn, "menu:buy")
  .row()
  .text(renewSubBtn, "menu:renew")
  .row()
  .text(getConfigBtn, "menu:getconfig")
  .row()
  .text(mySubBtn, "menu:status")
  .row()
  .text(tutorialBtnTxt, "menu:tutorial")
  .row()
  .text(contactTxt, "menu:contact");

export const renewMenu = (() => {
  const kb = new InlineKeyboard();
  PLANS.forEach((p) => {
    kb.text(p.buttonText, `plan:${p.id}`).row();
  });
  return kb.text(cancelBtn, "order:cancel").row().text(resetBtn, "menu:home");
})();

export const cancelMenu = new InlineKeyboard().text(cancelBtn, "order:cancel");

export const backHomeMenu = new InlineKeyboard().text(resetBtn, "menu:home");

type InlineReplyMarkup = {
  inline_keyboard: Array<Array<{ callback_data?: string } & Record<string, unknown>>>;
};

/** Adds the shared home action without changing an existing keyboard instance. */
export function withBackHomeButton(
  replyMarkup?: InlineReplyMarkup | InlineKeyboard,
): InlineReplyMarkup {
  const markup = replyMarkup
    ? (replyMarkup as InlineReplyMarkup)
    : { inline_keyboard: [] };
  const hasHomeButton = markup.inline_keyboard.some((row) =>
    row.some((button) => button.callback_data === "menu:home"),
  );

  if (hasHomeButton) return markup;

  return {
    ...markup,
    inline_keyboard: [
      ...markup.inline_keyboard.map((row) => [...row]),
      [{ text: resetBtn, callback_data: "menu:home" }],
    ],
  };
}

export const adminMenu = (isOwner: boolean) => {
  const kb = new InlineKeyboard()
    .text(myPanelsBtn, "admin:panels")
    .row()
    .text(addPanelBtn, "admin:add")
    .row()
    .text(deletePanelBtn, "admin:del")
    .row()
    .text(appStateBtn, "admin:state")
    .row()
    .text(changeRenewStateBtn, "admin:trenew")
    .row()
    .text(changeSellStateBtn, "admin:tsell")
    .row()
    .text(broadcastBtn, "admin:broadcast")
    .row()
    .text(broadcastSubsBtn, "admin:broadcast-subs")
    .row()
    .text(backupBtn, "admin:backup")
    .row()
    .text(userCountBtn, "admin:users");
  if (isOwner) kb.row().text(adminsBtn, "admin:admins");
  return kb;
};

export const subAdminMenu = new InlineKeyboard().text(
  "🔄 به‌روزرسانی",
  "admins:noop",
);

export const adminsMenu = new InlineKeyboard()
  .text("➕ افزودن ادمین", "admins:add")
  .row()
  .text("➖ حذف ادمین", "admins:del")
  .row()
  .text("📋 لیست ادمین‌ها", "admins:list")
  .row()
  .text(resetBtn, "menu:home")
  .row()
  .text("🔙 منوی ادمین", "admins:back");

export const broadcastConfirmMenu = (pendingCount: number) =>
  new InlineKeyboard()
    .text(`تایید ارسال به ${pendingCount} کاربر ✅`, "broadcast:confirm")
    .row()
    .text(resetBtn, "broadcast:cancel");

