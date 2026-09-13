export class Util {
  private static unixHour: number = 60 * 60 * 1000;

  public static getUnixTimeOf({ days = 1, hours = 24 }) {
    return days * hours * this.unixHour;
  }

  public static gigsToBytes(size: number) {
    return size * 1073741824;
  }

  public static bytesToGigs(bytes: number) {
    return bytes / 1073741824;
  }

  /**
   * Per-plan display shortfall: title GB minus actually granted GB.
   * Displayed quota = actual quota + accumulated shortfall, so what the
   * user sees matches the title GBs they bought (10+10 shows 20, etc.).
   */
  private static readonly GRANT_BONUS: Array<{ grant: number; bonus: number }> =
    [
      { grant: 95, bonus: 5 },
      { grant: 47, bonus: 3 },
      { grant: 27, bonus: 3 },
      { grant: 17, bonus: 3 },
      { grant: 8, bonus: 2 },
    ];

  /**
   * Infer the accumulated bonus for a client with no stored bonus (created
   * before bonus tracking): decompose the panel total into exact grants and
   * sum their shortfalls, so stacked renewals (e.g. 8+8=16 -> bonus 4)
   * display correctly. Falls back to the single-plan bucket when the total
   * is not an exact combination (e.g. drifted by usage before a renew).
   */
  public static inferBonusGB(totalBytes: number) {
    const totalGB = Math.round(this.bytesToGigs(Math.max(0, totalBytes)));
    if (totalGB <= 0) return 0;
    if (totalGB <= 2000) {
      const grants = this.GRANT_BONUS.map((g) => g.grant);
      const bonusOf = new Map(this.GRANT_BONUS.map((g) => [g.grant, g.bonus]));
      const dp: Array<number[] | null> = new Array(totalGB + 1).fill(null);
      dp[0] = [];
      for (let s = 1; s <= totalGB; s++) {
        for (const g of grants) {
          const prev = s - g >= 0 ? dp[s - g] : null;
          if (prev) {
            dp[s] = [...prev, g];
            break;
          }
        }
      }
      const combo = dp[totalGB];
      if (combo) {
        return combo.reduce((sum, g) => sum + (bonusOf.get(g) ?? 0), 0);
      }
    }
    if (totalGB === 100 || totalGB === 95) return 5;
    if (totalGB === 10 || totalGB === 8) return 2;
    return 3;
  }

  /**
   * Display remaining quota for the status message (smooth fade, no jumps).
   * - At full quota (remaining == total granted) shows the title GBs
   *   (remaining + full bonus).
   * - The bonus then fades linearly to 0 as the ACTUAL remaining drops to
   *   5GB: display = remaining + bonus * (remaining - 5) / (total - 5).
   * - At/below 5GB actual remaining shows the actual remaining (0% bonus),
   *   matching the 5GB low-quota notify threshold.
   * When the accumulated bonus is known (stored per client, covering
   * stacked renewals) pass it in; otherwise it is inferred from the total
   * (exact grant decomposition, single-plan bucket fallback).
   */
  public static displayRemainingGB(
    totalBytes: number,
    remainingBytes: number,
    bonusGB?: number,
  ) {
    const total = Math.max(0, totalBytes);
    const remaining = Math.max(0, remainingBytes);
    if (total === 0) return this.bytesToGigs(remaining);
    const bonus = bonusGB ?? this.inferBonusGB(total);
    const bonusBytes = Math.max(0, bonus) * 1073741824;
    if (bonusBytes === 0) return this.bytesToGigs(remaining);
    const floorBytes = this.gigsToBytes(5);
    if (remaining <= floorBytes) return this.bytesToGigs(remaining);
    if (total <= floorBytes) return this.bytesToGigs(remaining);
    const fraction = Math.min(
      1,
      Math.max(0, (remaining - floorBytes) / (total - floorBytes)),
    );
    return this.bytesToGigs(remaining + bonusBytes * fraction);
  }

  public static formatGB(gb: number) {
    const rounded = Math.round(gb * 100) / 100;
    return `${rounded}`;
  }

  public static newPostRequest(url: string, headers: Headers, body?: string) {
    return new Request(url, {
      method: "POST",
      headers,
      body,
      credentials: "include",
    });
  }

  public static newGetRequest(url: string, headers: Headers) {
    return new Request(url, {
      method: "GET",
      headers,
      credentials: "include",
    });
  }

  public static removeEmoji(email: string) {
    return email.replace(/^\p{Extended_Pictographic}\s*/u, "");
  }
}
