import { InlineKeyboard, Keyboard } from "grammy";
import {
  tutorialBtnTxt,
  renewSubBtn,
  buySubBtn,
  mySubBtn,
  contactTxt,
  resetBtn,
  addPanelBtn,
  myPanelsBtn,
  deletePanelBtn,
  appStateBtn,
  changeRenewStateBtn,
  changeSellStateBtn,
  getConfigBtn,
  backupBtn,
  broadcastBtn,
} from "./messages";
import { PLANS } from "./plans";

export const shareContactKey = new Keyboard()
  .requestContact("☎️ ارسال شماره موبایل")
  .resized()
  .oneTime();

export const mainMenu = new Keyboard()
  .text(renewSubBtn)
  .text(buySubBtn)
  .row()
  .text(getConfigBtn)
  .text(mySubBtn)
  .row()
  .text(tutorialBtnTxt)
  .text(contactTxt)
  .resized()
  .persistent();

export const renewMenu = (() => {
  const kb = new Keyboard();
  PLANS.forEach((p, i) => {
    kb.text(p.buttonText);
    if (i < PLANS.length - 1) kb.row();
  });
  return kb.row().text(resetBtn).resized();
})();

export const adminReplyKeys = (userID: number) =>
  new InlineKeyboard()
    .text("✅ قبول", `renewAccept:${userID}`)
    .text("❌ رد", `renewDecline:${userID}`);

export const adminMenu = new Keyboard()
  .text(myPanelsBtn)
  .row()
  .text(deletePanelBtn)
  .text(addPanelBtn)
  .row()
  .text(appStateBtn)
  .row()
  .text(changeRenewStateBtn)
  .text(changeSellStateBtn)
  .row()
  .text(broadcastBtn)
  .row()
  .text(backupBtn)
  .resized();

export const broadcastConfirmMenu = (pendingCount: number) =>
  new Keyboard()
    .text(`تایید ارسال به ${pendingCount} کاربر ✅`)
    .row()
    .text(resetBtn)
    .resized();
