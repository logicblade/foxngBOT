import { InlineKeyboard, Keyboard } from "grammy";
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
} from "./messages";
import { PLANS } from "./plans";

// NOTE: Telegram does not allow `request_contact` on inline buttons, so the
// contact-request keyboard intentionally stays a reply keyboard. Everything
// else is inline (callback_data based) so no persistent reply keyboard stays
// on screen.
export const shareContactKey = new Keyboard()
  .requestContact("☎️ ارسال شماره موبایل")
  .resized()
  .oneTime();

// Legacy reply keyboards are removed by sending this once (on /start and on
// "home"). All menus below are inline.
export const removeReplyKeyboard = { remove_keyboard: true } as const;

export const mainMenu = new InlineKeyboard()
  .text(renewSubBtn, "menu:renew")
  .text(buySubBtn, "menu:buy")
  .row()
  .text(getConfigBtn, "menu:getconfig")
  .text(mySubBtn, "menu:status")
  .row()
  .text(tutorialBtnTxt, "menu:tutorial")
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

export const adminReplyKeys = (userID: number) =>
  new InlineKeyboard()
    .text("✅ قبول", `renewAccept:${userID}`)
    .text("❌ رد", `renewDecline:${userID}`);

export const adminMenu = new InlineKeyboard()
  .text(myPanelsBtn, "admin:panels")
  .row()
  .text(addPanelBtn, "admin:add")
  .text(deletePanelBtn, "admin:del")
  .row()
  .text(appStateBtn, "admin:state")
  .row()
  .text(changeRenewStateBtn, "admin:trenew")
  .text(changeSellStateBtn, "admin:tsell")
  .row()
  .text(broadcastBtn, "admin:broadcast")
  .text(broadcastSubsBtn, "admin:broadcast-subs")
  .row()
  .text(backupBtn, "admin:backup")
  .text(userCountBtn, "admin:users");

export const broadcastConfirmMenu = (pendingCount: number) =>
  new InlineKeyboard()
    .text(`تایید ارسال به ${pendingCount} کاربر ✅`, "broadcast:confirm")
    .row()
    .text(resetBtn, "broadcast:cancel");

