import { InlineKeyboard } from "grammy";
import { discountedPlan, PLANS } from "./messages";

export const CB = {
  userMain: "user:main",
  userBuy: "user:buy",
  userRenew: "user:renew",
  userVolume: "user:volume",
  userSupport: "user:support",
  userGetConfig: "user:getconfig",
  adminMain: "admin:main",
} as const;

export function userMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛒 خرید اشتراک", CB.userBuy)
    .text("🔄 تمدید اشتراک", CB.userRenew)
    .row()
    .text("📊 چقدر حجم دارم؟", CB.userVolume)
    .text("🔗 دریافت لینک کانفیگ", CB.userGetConfig)
    .row()
    .text("📞 پشتیبانی", CB.userSupport);
}

export function backToMainMenu(): InlineKeyboard {
  return new InlineKeyboard().text("🔙 بازگشت به منوی اصلی", CB.userMain);
}

export function backToAdminMainMenu(): InlineKeyboard {
  return new InlineKeyboard().text("🔙 بازگشت به منوی اصلی", CB.adminMain);
}

export function initialOwnerMenu(): InlineKeyboard {
  return new InlineKeyboard().text("➕ افزودن پنل", "owner:panel:add");
}

export function planMenu(prefix: "buy" | "renew", plans = PLANS, discountPercent = 0): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of plans) {
    const pricedPlan = discountedPlan(p, discountPercent);
    kb.text(pricedPlan.label, `${prefix}:plan:${p.id}`).row();
  }
  kb.text("📞 ارتباط با پشتیبانی برای حجم بیشتر", `${prefix}:support`).row();
  kb.text("❌ لغو سفارش", `${prefix}:cancel`).row();
  kb.text("🔙 بازگشت به منوی اصلی", CB.userMain);
  return kb;
}

export function ownerMainMenu(pendingCount: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🧾 مدیریت رسیدها${pendingCount > 0 ? ` (${pendingCount})` : ""}`, "admin:orders")
    .row()
    .text("👥 تعداد کاربران", "owner:stats")
    .row()
    .text("📢 پیام همگانی", "owner:broadcast")
    .text("💎 پیام به مشترکین", "owner:subscribers")
    .row()
    .text("💾 بکاپ دیتابیس", "owner:backup")
    .text("👥 مدیریت ادمین‌ها", "owner:admins")
    .row()
    .text("🏷 تخفیفات", "owner:discounts")
    .row()
    .text("🖥 پنل‌ها", "owner:panels")
    .row()
    .text("⚙️ وضعیت خرید و تمدید", "owner:appstate");
}

export function discountManagementMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ اعمال تخفیف", "owner:discount:apply")
    .row()
    .text("❌ لغو تخفیف", "owner:discount:cancel")
    .row()
    .text("🔙 بازگشت", "admin:main");
}

export function adminManagementMenu(adminIds: number[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const adminId of adminIds) {
    kb.text(`❌ حذف ${adminId}`, `owner:admin:remove:${adminId}`).row();
  }
  kb.text("➕ افزودن ادمین", "owner:admin:add").row();
  kb.text("🔙 بازگشت به منوی اصلی", CB.adminMain);
  return kb;
}

export function adminMainMenu(pendingCount: number): InlineKeyboard {
  return new InlineKeyboard().text(
    `🧾 مدیریت رسیدها${pendingCount > 0 ? ` (${pendingCount})` : ""}`,
    "admin:orders",
  );
}

export function pendingOrdersMenu(orders: { id: number; tg_id: number; volume_gb: number }[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const o of orders.slice(0, 10)) {
    kb.text(`🧾 #${o.id} | ${o.tg_id} | ${o.volume_gb}GB`, `admin:order:${o.id}`).row();
  }
  kb.text("🔙 بازگشت به منوی اصلی", CB.adminMain);
  return kb;
}

export function orderDecisionMenu(orderId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ تایید پرداخت", `admin:approve:${orderId}`)
    .text("❌ رد پرداخت", `admin:reject:${orderId}`)
    .row()
    .text("🔙 بازگشت به منوی اصلی", CB.adminMain);
}

export function cancelActionMenu(): InlineKeyboard {
  return new InlineKeyboard().text("❌ لغو", "action:cancel");
}

export function appStateMenu(isSellActive: boolean, isRenewActive: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🛒 خرید: ${isSellActive ? "فعال ✅" : "غیرفعال ❌"}`, "owner:toggle_sell")
    .row()
    .text(`🔄 تمدید: ${isRenewActive ? "فعال ✅" : "غیرفعال ❌"}`, "owner:toggle_renew")
    .row()
    .text("🔙 بازگشت به منوی اصلی", CB.adminMain);
}

/** Panels management: one replace button per panel. */
export function panelsMenu(panels: { id: number; name: string }[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of panels) kb.text(`🔁 جایگزینی: ${p.name}`, `panel:replace:${p.id}`).row();
  kb.text("➕ افزودن پنل", "owner:panel:add").row();
  kb.text("🔙 بازگشت به منوی اصلی", CB.adminMain);
  return kb;
}
