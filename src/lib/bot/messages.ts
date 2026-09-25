import type { Plan } from "../types";
import { Util } from "../../util/util";

export const SUPPORT_ID = process.env.SUPPORT_ID || "@foxngsup";
export const CARD_NUMBER = process.env.CARD_NUMBER || "*****";
export const CARD_OWNER = process.env.CARD_OWNER || "*****";

export function startMessage(name: string) {
  return `🌐 سلام ${name} عزیز! خوش اومدی به ربات FOXNG 🚀
🔐 اینترنت آزاد فقط چند کلیک با تو فاصله داره!

✅ سرعت بالا، بدون قطعی
✅ آیپی ثابت
✅ پشتیبانی تا آخرین روز سرویس
✅ ضمانت بازگشت وجه

از منوی پایین شروع کن 👇🏼`;
}

export function supportMessage() {
  return `برای ارتباط با پشتیبانی می‌تونید به آیدی زیر پیام بدید 👇\n\n🆔: ${SUPPORT_ID}`;
}
export const searchingTxt = "⏳ در حال جستجو...";
export const disableSellTxt = `
کاربر عزیز، متاسفانه در حال حاضر امکان خرید اشتراک جدید وجود ندارد 😓⛔️
`;
export const disableRenewTxt = `
کاربر عزیز، متاسفانه در حال حاضر امکان تمدید اشتراک وجود ندارد 😓⛔️
`;
export const noSubFoundTxt = `شما در حال حاضر اشتراک فعالی ندارید. 😓`;
export const subFoundTxt = `
اشتراکی که میخوای تمدید کنی انتخاب کن: 👇🚀

🟢: اشتراک فعال
🔴: اشتراک منقضی شده
`;
export const subFoundGetConfTxt = `
اشتراکی که لینکشو میخوای انتخاب کن: 👇🚀
`;
export const statusEnabledTxt = `اشتراک شما هنوز فعال است.
اگه برای اتصال مشکلی داری، به آیدی پشتیبانی پیام بده. 👇`;

export function withSupport(text: string) {
  return `${text}\n\n🆔: ${SUPPORT_ID}`;
}
export const statusNotStartedtxt = `اشتراک شما فعال است اما هنوز بهش وصل نشدی.

اگه برای اتصال مشکلی داری، به آیدی پشتیبانی پیام بده. 👇`;
export const statusOffTxt = `متاسفانه امکان تمدید اشتراک شما وجود ندارد.

با پشتیبانی در ارتباط باشید👇🏼`;

export function discountedPlan(plan: Plan, discountPercent: number): Plan {
  if (discountPercent <= 0) return plan;
  const discountedPrice = Math.round(plan.price - (plan.price * discountPercent) / 100);
  return {
    ...plan,
    price: discountedPrice,
    label: `🔥 ${discountPercent}٪ | ${plan.volumeGB} گیگ | 💰 ${Util.formatPrice(discountedPrice)} تومان`,
  };
}

export function paymentText(kind: "buy" | "renew", plan: Plan, originalPrice?: number) {
  const title = kind === "buy" ? "خرید" : "تمدید";
  const price = originalPrice && originalPrice !== plan.price
    ? `🔥 تخفیف فعال\nقیمت اصلی: ${Util.formatPrice(originalPrice)} تومان\nقیمت با تخفیف: ${Util.formatPrice(plan.price)} تومان`
    : `✅ ${Util.formatPrice(plan.price)} تومان`;
  return `💵 هزینه ${title} اشتراک شما:
${price}
📦 ${plan.volumeGB} گیگ | ⏳ ${plan.days} روزه

💳 ${CARD_OWNER} 💳

<blockquote><code>${CARD_NUMBER}</code></blockquote>
🚨(برای کپی کردن شماره کارت روی آن کلیک کنید)


⚠️توجه⚠️
‼️عکس رسید تراکنش خود را همینجا بفرستید تا بعد از تایید ادمین اشتراک شما فعال شود‼️`;
}
export const reciptReceiveTxt = `با تشکر | رسید شما دریافت شد ✅
سفارش شما با وضعیت در انتظار بررسی ثبت شد. بعد از بررسی ادمین نتیجه از همین ربات بهتون اطلاع داده می‌شه…❤️`;
export const PLANS: Plan[] = [
  { id: "p10", volumeGB: 10, days: 60, price: 150000, label: "📦 10 گیگ | ⏳ 60 روزه | 💰 150,000 تومان" },
  { id: "p20", volumeGB: 20, days: 60, price: 300000, label: "📦 20 گیگ | ⏳ 60 روزه | 💰 300,000 تومان" },
  { id: "p30", volumeGB: 30, days: 60, price: 450000, label: "📦 30 گیگ | ⏳ 60 روزه | 💰 450,000 تومان" },
  { id: "p50", volumeGB: 50, days: 60, price: 750000, label: "📦 50 گیگ | ⏳ 60 روزه | 💰 750,000 تومان" },
  { id: "p100", volumeGB: 100, days: 90, price: 1500000, label: "📦 100 گیگ | ⏳ 90 روزه | 💰 1,500,000 تومان" },
];

export const justImageTxt = `شرمنده فقط عکس رسید قبوله!
لطفا عکس رسید تراکنش را همینجا بفرستید.`;

export const welcomeAdminTxt = `خوش اومدی!

فعلا ربات غیرفعاله چون هنوز پنلی نداریم.

کارو با اضافه کردن پنل شروع کن!`;
