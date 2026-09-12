export type PlanId = "10g" | "20g" | "30g" | "50g" | "100g";

export interface Plan {
  id: PlanId;
  /** Title shown on the button, e.g. "10GB" */
  titleGB: number;
  /** Actual quota granted on the panel, in GB */
  grantGB: number;
  /** Price in tomans */
  priceToman: number;
  durationDays: number;
  buttonText: string;
}

export const PLANS: Plan[] = [
  {
    id: "10g",
    titleGB: 10,
    grantGB: 8,
    priceToman: 150000,
    durationDays: 30,
    buttonText: "اشتراک 1 ماهه 10 گیگابایت - 150 هزار تومان",
  },
  {
    id: "20g",
    titleGB: 20,
    grantGB: 17,
    priceToman: 300000,
    durationDays: 30,
    buttonText: "اشتراک 1 ماهه 20 گیگابایت - 300 هزار تومان",
  },
  {
    id: "30g",
    titleGB: 30,
    grantGB: 27,
    priceToman: 450000,
    durationDays: 30,
    buttonText: "اشتراک 1 ماهه 30 گیگابایت - 450 هزار تومان",
  },
  {
    id: "50g",
    titleGB: 50,
    grantGB: 47,
    priceToman: 750000,
    durationDays: 30,
    buttonText: "اشتراک 1 ماهه 50 گیگابایت - 750 هزار تومان",
  },
  {
    id: "100g",
    titleGB: 100,
    grantGB: 95,
    priceToman: 1500000,
    durationDays: 30,
    buttonText: "اشتراک 1 ماهه 100 گیگابایت - 1500 هزار تومان",
  },
];

export const PLAN_MAP: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>;

export function getPlan(id: string | undefined): Plan | undefined {
  if (!id) return undefined;
  return (PLAN_MAP as Record<string, Plan>)[id];
}

function formatToman(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, "٬");
}

export function paymentText(kind: "buy" | "renew", plan: Plan): string {
  const verb = kind === "buy" ? "خرید" : "تمدید";
  return `
💵هزینه ${verb} اشتراک شما:
  ✅${formatToman(plan.priceToman)} تومان

💳شایان براقی - توسعه تعاون💳

<blockquote><code>5029081059314381</code></blockquote>
🚨(برای کپی کردن شماره کارت روی آن کلیک کنید)


⚠️توجه⚠️
‼️عکس رسید تراکنش خود را همینجا بفرستید تا اشتراک شما به صورت خودکار فعال شود‼️
`;
}
