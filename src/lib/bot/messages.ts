export const greet = "به منو اصلی خوش برگشتی🔻";
export function bigGreet(firstName?: string): string {
  const name = firstName?.trim();
  const helloLine = name
    ? `🌐 سلام ${name} عزیز! خوش اومدی به ربات FOXNG 🚀`
    : `🌐 خوش اومدی به ربات FOXNG 🚀`;
  return `${helloLine}
🔐 اینترنت آزاد فقط چند کلیک با تو فاصله داره!

✅  سرعت بالا، بدون قطعی
✅  آیپی ثابت
✅  پشتیبانی تا آخرین روز سرویس
✅  ضمانت بازگشت وجه

از منوی پایین شروع کن  👇🏼

یا اگه نیاز به پشتیبانی داری به آیدی زیر پیام بده:

🆔: @FOXNGsup`;
}
export const planFeaturesNote = `⏳ بدون محدودیت زمانی | 🌐 آیپی ثابت ✅
تمامی اشتراک‌ها بدون محدودیت زمانی هستن و با آیپی ثابت ارائه می‌شن`;
export const mySubBtn = "⏳ وضعیت اشتراک من";
export const testConfBtn = "✅ دریافت کانفیگ تست";
export const buySubBtn = "🚀 خرید اشتراک جدید";
export const renewSubBtn = "♻️ تمدید اشتراک";
export const contactTxt = "👨🏼‍💻 ارتباط با پشتیبانی";
export const tutorialBtnTxt = "⚙️ آموزش اتصال به کانفیگ";
export const getConfigBtn = "🔗 دریافت دوباره لینک کانفیگ";
export const resetBtn = "بازگشت به منو اصلی 🔙";
export const cancelBtn = "لغو سفارش";
export const creatingTestConfTxt = `در حال ساختن کانفیگ تست
لطفا صبر کنید...`;
export const welcomeTxt =
  "کاربر عزیز، جهت استفاده از ربات برای پیگیری سفارش و دریافت پشتیبانی، لطفا با استفاده از دکمه زیر، شماره همراه خود را ثبت کنید 👇";
export const buySubTxt = `
اگر قبلا اشتراک خریدی
از دکمه " ♻️ تمدید اشتراک"
یا /renew استفاده کن

و اگر اشتراک نداری، برای خرید اشتراک به آیدی زیر پیام بده 👇

🆔: @foxngsup
`;
export const searchingTxt = "⏳ در حال جستجو...";
export const disableSellTxt = `
کاربر عزیز، متاسفانه در حال حاضر امکان خرید اشتراک جدید وجود ندارد ⛔️
`;
export const disableRenewTxt = `
کاربر عزیز، متاسفانه در حال حاضر امکان تمدید اشتراک وجود ندارد ⛔️
`;
export const noSubFoundTxt = `
کاربر عزیز، اشتراک شما پیدا نشد ⛔️

جهت خرید اشتراک از دکمه
"🚀 خرید اشتراک جدید" استفاده کنید 👇
`;
export const subFoundTxt = `
اشتراکی که میخوای تمدید کنی انتخاب کن: 👇🚀

🟢: اشتراک فعال
🟡: اشتراک فعال ولی حجمش رو به اتمامه
🔴: حجم اشتراک به اتمام رسیده
`;
export const subFoundGetConfTxt = `
اشتراکی که لینکشو میخوای انتخاب کن: 👇🚀
`;
export const statusEnabledTxt = `
اشتراک شما هنوز فعال است.
اگه برای اتصال مشکلی داری، به آیدی پشتیبان پیام بده. 👇

🆔: @foxngsup
`;
export const statusNotStartedtxt = `
اشتراک شما فعال است اما هنوز بهش وصل نشدی.

اگه برای اتصال مشکلی داری، به آیدی پشتیبان پیام بده. 👇

🆔: @foxngsup
`;
export const statusOffTxt = `
متاسفانه امکان تمدید اشتراک شما وجود ندارد.

با پشتیبانی در ارتباط باشید👇🏼

🆔: @foxngsup
`;
// Deprecated: payment texts are now generated via paymentText() in ./plans.
export const renewTxt250 = ``;
export const renewTxt450 = ``;
export const reciptReceiveTxt = `
با تشکر | رسید شما دریافت شد ✅
بعد از بررسی ادمین تا چند لحظه دیگه اشتراک شما فعال و از همین ربات بهتون اطلاع میدیم…❤️
`;

// New 5-tier plans. Single source of truth lives in ./plans (PLANS).
// Kept as deprecated aliases so old imports don't break.
export const oneM10G = "زمان نامحدود 10 گیگابایت - 150 هزار تومان";
export const oneM20G = "زمان نامحدود 20 گیگابایت - 300 هزار تومان";
export const oneM30G = "زمان نامحدود 30 گیگابایت - 450 هزار تومان";
export const oneM50G = "زمان نامحدود 50 گیگابایت - 750 هزار تومان";
export const oneM100G = "زمان نامحدود 100 گیگابایت - 1,500 هزار تومان";

export const justImageTxt = `
شرمنده فقط عکس قبوله!
برو از اول!

البته اگه تراکنش انجام شده ولی عکس رسید رو نداری با پشتیبان در ارتباط باش👇

🆔: @foxngsup
`;

export const myPanelsBtn = "پنل های من";
export const addPanelBtn = "اضافه کردن پنل";
export const deletePanelBtn = "حذف کردن پنل";
export const appStateBtn = "وضعیت خرید و تمدید";
export const changeSellStateBtn = "تغییر وضعیت خرید";
export const changeRenewStateBtn = "تغییر وضعیت تمدید";
export const backupBtn = "بکاپ گرفتن از دیتابیس";
export const broadcastBtn = "📣 پیام همگانی";
export const broadcastSubsBtn = "📣 پیام به مشترکین";
export const userCountBtn = "👥 تعداد کاربران";
export const adminsBtn = "👮 ادمین‌ها";

export const welcomeAdminTxt = `
خوش اومدی!

فعلا ربات غیرفعاله چون هنوز پنلی نداریم.

کارو با اضافه کردن پنل شروع کن!
`;

// Deprecated: payment texts are now generated via paymentText() in ./plans.
export const buyTxt250 = ``;
export const buyTxt450 = ``;
