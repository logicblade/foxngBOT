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
   * Display remaining quota for the status message.
   * - If remaining < total / 3, show the actual remaining.
   * - Otherwise inflate: +5GB for 100GB accounts, +3GB for the rest.
   * A "100GB account" is detected from the panel quota: title 100GB grants
   * 95GB, so both 95 and 100 (rounded GB) count as 100GB.
   */
  public static displayRemainingGB(totalBytes: number, remainingBytes: number) {
    const total = Math.max(0, totalBytes);
    const remaining = Math.max(0, remainingBytes);
    if (total === 0) return this.bytesToGigs(remaining);
    if (remaining < total / 3) return this.bytesToGigs(remaining);
    const totalGB = Math.round(this.bytesToGigs(total));
    const bonusGB = totalGB === 100 || totalGB === 95 ? 5 : 3;
    return this.bytesToGigs(remaining) + bonusGB;
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
