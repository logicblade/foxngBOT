export class Util {
  private static unixHour: number = 60 * 60 * 1000;
  private static readonly iranDateFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  private static readonly iranDateTimeFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  private static readonly iranFileDateTimeFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  public static getUnixTimeOf({ days = 1, hours = 24 }) {
    return days * hours * this.unixHour;
  }

  public static gigsToBytes(size: number) {
    return size * 1073741824;
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
    return (email ?? "").replace(/^\p{Extended_Pictographic}\s*/u, "");
  }

  public static bytesToGB(bytes: number) {
    return bytes / 1073741824;
  }

  public static formatGB(bytes: number) {
    const gb = Util.bytesToGB(Math.max(0, bytes));
    return gb >= 10 ? gb.toFixed(1) : gb.toFixed(2);
  }

  public static formatDate(ms: number) {
    if (!ms || ms <= 0) return "—";
    return this.iranDateFormatter.format(new Date(ms));
  }

  public static formatDateTime(ms: number) {
    if (!ms || ms <= 0) return "—";
    return this.iranDateTimeFormatter.format(new Date(ms));
  }

  public static formatPrice(n: number) {
    return Number(n || 0).toLocaleString("en-US");
  }

  public static displayName(first?: string, last?: string, fallback = "کاربر") {
    const full = `${first ?? ""} ${last ?? ""}`.trim();
    return full || fallback;
  }

  public static timestampName(prefix: string, ext: string) {
    const parts = Object.fromEntries(
      this.iranFileDateTimeFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
    );
    const stamp = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
    return `${prefix}_${stamp}.${ext}`;
  }

  public static sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
