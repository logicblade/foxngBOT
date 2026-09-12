import { fetch } from "bun";
import type { DB } from "../../util/db";
import { Util } from "../../util/util";

export function getAllPanels(db: DB) {
  let panels: Panel[] = [];

  const creds = db.getPanels();

  for (const cred of creds) {
    const panel = new Panel(cred.name, cred.url, cred.username, cred.password);
    panels.push(panel);
  }

  return panels;
}

export class Panel {
  private INBOUNDS_PATH = "/panel/api/inbounds";
  private CLIENTS_PATH = "/panel/api/clients";
  private LOGIN_PATH = "/login";
  private UUID_ABS_PATH = "/panel/api/server/getNewUUID";
  private STATUS_ABS_PATH = "/panel/api/server/status";

  headers = new Headers();
  private lastLogins = new Map<string, number>();

  name: string;
  url: string;
  private username: string;
  private password: string;

  constructor(name: string, url: string, usename: string, password: string) {
    this.headers.set("Content-Type", "application/json");
    this.headers.set("Accept", "application/json");
    // Some frontings (Cloudflare Tunnel / WAF / bot-fight-mode) 403
    // non-browser clients. Look like a browser.
    this.headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );

    this.name = name;
    this.url = url;
    this.username = usename;
    this.password = password;
  }

  getUpdatePath(email: string) {
    return `${this.url}${this.CLIENTS_PATH}/update/${encodeURIComponent(email)}`;
  }

  getAddClientPath() {
    return `${this.url}${this.CLIENTS_PATH}/add`;
  }

  private parseInbound(obj: any): Obj {
    // New API returns settings/streamSettings/sniffing as nested objects;
    // old panels returned them as JSON-encoded strings. Accept both.
    const parseIfString = (v: unknown) =>
      typeof v === "string" && v.length > 0 ? JSON.parse(v) : v;
    return {
      ...obj,
      settings: parseIfString(obj.settings) as Settings,
      streamSettings: parseIfString(obj.streamSettings) as StreamSettings,
      sniffing: parseIfString(obj.sniffing) ?? obj.sniffing,
    } as Obj;
  }

  async getInboundByID(inboundID: number) {
    await this.handleLogin();

    const url = `${this.url}${this.INBOUNDS_PATH}/get/${inboundID}`;
    const req = Util.newGetRequest(url, this.headers);

    const res = await fetch(req);
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 500);
      throw new Error(
        `getInboundByID ${inboundID} failed: ${res.status}. Body: ${snippet}`,
      );
    }
    const js = (await res.json().catch(() => null)) as GetInboundResponse | null;
    if (!js || !js.obj) {
      throw new Error(
        `getInboundByID ${inboundID} returned no inbound (success=${js?.success}, msg=${js?.msg})`,
      );
    }

    const parsed: GetInboundResponse = {
      ...js,
      obj: this.parseInbound(js.obj),
    };

    return parsed;
  }

  async resetClientTraffic(_inboundID: number, email: string) {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/resetTraffic/${encodeURIComponent(email)}`;

    const req = Util.newPostRequest(url, this.headers);
    const res = await fetch(req);

    if (res.status !== 200) {
      return false;
    } else {
      return true;
    }
  }

  async getInbounds() {
    await this.handleLogin();

    const url = `${this.url}${this.INBOUNDS_PATH}/list`;
    const req = Util.newGetRequest(url, this.headers);

    try {
      const res = await fetch(req);
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 500);
        console.error(
          `Failed to get all inbounds for ${this.name}: GET ${url} -> ${res.status}. Body: ${snippet}`,
        );
        return;
      }

      const js = (await res.json().catch(() => null)) as GetInboundsResponse | null;
      if (!js || !Array.isArray(js.obj)) {
        console.error(
          `Failed to get all inbounds for ${this.name}: bad payload (success=${js?.success}, msg=${js?.msg})`,
        );
        return;
      }

      const parsed: GetInboundsResponse = {
        ...js,
        obj: js.obj.map((obj) => this.parseInbound(obj)),
      };

      return parsed;
    } catch (error) {
      console.error(`Failed to get all inbounds for ${this.name}:`, error);
      return;
    }
  }

  async getClients(): Promise<GetClientsResponse | undefined> {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/list`;
    const req = Util.newGetRequest(url, this.headers);

    try {
      const res = await fetch(req);
      const js = (await res.json()) as GetClientsResponse;
      return js;
    } catch (error) {
      console.error("Failed to get clients list:", error);
      return;
    }
  }

  async getClientByEmail(email: string) {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/get/${encodeURIComponent(email)}`;
    const req = Util.newGetRequest(url, this.headers);

    try {
      const res = await fetch(req);
      if (!res.ok) {
        console.error(
          `getClientByEmail ${email} failed: ${res.status}. Body: ${(await res.text().catch(() => "")).slice(0, 300)}`,
        );
        return;
      }
      const js = (await res.json()) as GetClientResponse;
      if (!js?.obj) {
        console.error(
          `getClientByEmail ${email}: no client in response (success=${js?.success}, msg=${js?.msg})`,
        );
      }
      return js;
    } catch (error) {
      console.error("Failed to get client:", error);
      return;
    }
  }

  /**
   * Adds a client and returns the credential the panel ACTUALLY stored.
   * The panel owns the uuid/vless-id: after a successful add we re-read the
   * row and use its uuid for config links — never the value we requested.
   * If the stored uuid cannot be verified, this FAILS — no fallback — so a
   * config link is never built from an unconfirmed credential.
   */
  async addClient(
    inboundID: number,
    client: NewPanelClient,
  ): Promise<AddClientResult> {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/add`;
    const body = JSON.stringify({ client, inboundIds: [inboundID] });
    const req = Util.newPostRequest(url, this.headers, body);

    const res = await fetch(req);
    const text = await res.text().catch(() => "");

    if (res.status !== 200 || !text.includes("true")) {
      return { ok: false, status: res.status, body: text.slice(0, 500) };
    }

    // 1st verification attempt: the single-client endpoint. Some panel
    // versions return obj as a single object, others as a one-element array.
    try {
      const stored = await this.getClientByEmail(client.email);
      const row = Array.isArray(stored?.obj) ? stored.obj[0] : stored?.obj;
      const uuid = Panel.extractClientUuid(row);
      if (uuid) {
        if (client.uuid && uuid !== client.uuid) {
          console.warn(
            `addClient: panel stored a different uuid than requested for ${client.email} (requested=${client.uuid}, stored=${uuid})`,
          );
        }
        return { ok: true, uuid };
      }
    } catch (error) {
      console.error("addClient: verification read threw:", error);
    }

    // 2nd attempt: scan the full clients list for this email.
    try {
      const list = await this.getClients();
      const rows = Array.isArray(list?.obj) ? list.obj : [];
      const row = rows.find((r) => r?.email === client.email);
      const uuid = Panel.extractClientUuid(row);
      if (uuid) {
        if (client.uuid && uuid !== client.uuid) {
          console.warn(
            `addClient: panel stored a different uuid than requested for ${client.email} (requested=${client.uuid}, stored=${uuid})`,
          );
        }
        return { ok: true, uuid };
      }
    } catch (error) {
      console.error("addClient: list verification threw:", error);
    }

    // The panel's stored credential could not be confirmed — hard fail.
    // A config link built from anything else would not work.
    console.error(
      `addClient: could not verify stored uuid for ${client.email} — failing without fallback`,
    );
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }

  /** Pulls the vless/vmess credential off a stored client row. */
  private static extractClientUuid(
    row: PanelClient | undefined | null,
  ): string | undefined {
    if (!row) return undefined;
    if (typeof row.uuid === "string" && row.uuid) return row.uuid;
    // Some panel versions keep the vless credential in a string `id` field
    // (numeric row ids don't count — real uuids contain dashes).
    const id = (row as unknown as { id?: unknown }).id;
    if (typeof id === "string" && id.includes("-")) return id;
    return undefined;
  }

  async updateClient(email: string, client: PanelClientPayload) {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/update/${encodeURIComponent(email)}`;
    const body = JSON.stringify(client);
    const req = Util.newPostRequest(url, this.headers, body);

    const res = await fetch(req);
    return res;
  }

  async getConfigJSON() {
    await this.handleLogin();

    const url = `${this.url}/panel/api/server/getConfigJson`;
    const req = Util.newGetRequest(url, this.headers);

    try {
      const res = await fetch(req);
      const js = (await res.json()) as ConfigJSON;
      return js;
    } catch (error) {
      console.error("Failed to get config JSON:", error);
      return;
    }
  }

  async getUserConfigs(userID: number) {
    await this.handleLogin();

    const inbounds = await this.getInbounds();
    const clientsRes = await this.getClients();
    const clientsByEmail = new Map<string, PanelClient>();
    for (const c of clientsRes?.obj ?? []) {
      if (c?.email) clientsByEmail.set(c.email, c);
    }

    if (inbounds) {
      let userConfigs: UserConfig[] = [];

      for (const obj of inbounds.obj) {
        obj.settings.clients.forEach((client) => {
          // Owner identity: comment holds the telegram ID; fall back to
          // tgId and to the email prefix convention (first3ofTgID + 3 digits).
          const owner =
            client.comment ?? (client.tgId !== undefined ? String(client.tgId) : "");
          const emailPrefix = client.email.slice(0, 3);
          const matches =
            userID === Number(client.comment) ||
            (client.tgId !== undefined && Number(client.tgId) === userID) ||
            String(userID).startsWith(emailPrefix) ||
            owner === String(userID);
          if (matches) {
            const stat = obj.clientStats.find(
              (s) => s.uuid === client.id || s.email === client.email,
            );

            if (!stat) {
              console.warn(
                `No clientStat found for client id=${client.id} email=${client.email}`,
              );
            }

            const clientRow = clientsByEmail.get(client.email);
            const used =
              (clientRow?.traffic
                ? clientRow.traffic.down + clientRow.traffic.up
                : (stat?.down ?? 0) + (stat?.up ?? 0));
            const remainingGB = client.totalGB - used;
            // Time-unlimited plans: renewability is quota-based only.
            const isRenewable =
              client.totalGB !== 0 && remainingGB <= Util.gigsToBytes(3);
            const inboundRemark = obj.remark;
            const status = clientRow?.traffic?.enable ?? stat?.enable ?? client.enable ?? false;
            // "Started" = has actually transferred traffic (expiry is 0/unlimited now).
            const hasStarted = used > 0 || client.expiryTime > 0;
            const displayEmail = clientRow?.email ?? stat?.email ?? client.email ?? "";
            const email = `${status ? (hasStarted ? (isRenewable ? "🟡" : "🟢") : "🟠") : "🔴"} ${inboundRemark}-${displayEmail}`;

            userConfigs.push({
              email,
              inboundID: clientRow?.inboundIds?.[0] ?? stat?.inboundId ?? obj.id ?? 0,
              inboundRemark,
              isOff: !(clientRow?.enable ?? client.enable),
              isRenewable,
              status,
              uuid: clientRow?.uuid ?? client.id,
              hasStarted,
            });
          }
        });
      }

      return userConfigs;
    }
  }

  async getNewUUID() {
    await this.handleLogin();

    const req = Util.newGetRequest(
      `${this.url}${this.UUID_ABS_PATH}`,
      this.headers,
    );

    try {
      const res = await fetch(req);
      const body = (await res.json()) as
        | UUIDResponse
        | { success: boolean; msg: string; obj: string };
      // New API: { obj: "<uuid-string>" }; old API: { obj: { uuid } }.
      if (typeof body.obj === "string") return body.obj;
      return body.obj.uuid;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async handleLogin() {
    const now = Date.now();

    const lastLogin = this.lastLogins.get(this.name);
    const isLoggedIn = await this.isStatusSuccess();

    if (
      isLoggedIn &&
      lastLogin &&
      now - lastLogin < Util.getUnixTimeOf({ days: 2 })
    ) {
      console.log("You're already logged in");
      return;
    }

    const loginRes = await this.performLogin();
    if (loginRes === "okay") {
      this.lastLogins.set(this.name, now);
      console.log("Login done!");
    } else {
      console.error("Failed to login for:", this.name);
    }
  }

  private async performLogin(): Promise<Result> {
    const user: LoginUser = {
      username: this.username,
      password: this.password,
    };

    const url = `${this.url}${this.LOGIN_PATH}`;

    // Newer 3x-ui enforces CSRF on cookie auth: fetch a CSRF token first,
    // retry login with the X-CSRF-Token header if the first attempt is
    // rejected with 403.
    await this.refreshCsrfToken();

    let res = await fetch(
      Util.newPostRequest(url, this.headers, JSON.stringify(user)),
    );
    if (res.status === 403) {
      const snippet = (await res.text().catch(() => "")).slice(0, 500);
      console.error(
        `Login 403 for ${this.name} (retrying with fresh CSRF token). Body: ${snippet}`,
      );
      await this.refreshCsrfToken();
      res = await fetch(
        Util.newPostRequest(url, this.headers, JSON.stringify(user)),
      );
    }
    if (res.status !== 200) {
      const snippet = (await res.text().catch(() => "")).slice(0, 500);
      console.error(
        `Failed to login for ${this.name}: POST ${url} -> status ${res.status}. Body: ${snippet}`,
      );
      return "error";
    }

    // Bun may fold multiple Set-Cookie headers into one comma-joined value.
    const sessionCookie = this.extractSessionCookie(res.headers);
    if (sessionCookie) {
      this.headers.set("Cookie", sessionCookie);
      return "okay";
    }

    const bodySnippet = (await res.text().catch(() => "")).slice(0, 500);
    console.error(
      `Login for ${this.name} returned 200 but no 3x-ui session cookie. Body: ${bodySnippet}`,
    );
    return "error";
  }

  private async refreshCsrfToken() {
    try {
      const res = await fetch(
        Util.newGetRequest(`${this.url}/csrf-token`, this.headers),
      );
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        obj?: string;
      } | null;
      const token = typeof body?.obj === "string" ? body.obj : undefined;
      if (token) this.headers.set("X-CSRF-Token", token);
      this.extractSessionCookie(res.headers, true);
    } catch {
      // CSRF endpoint may not exist on older panels — login still works.
    }
  }

  private extractSessionCookie(headers: Headers, persist = false): string | undefined {
    const setCookieHeader =
      headers.get("Set-Cookie") ?? headers.get("set-cookie");
    if (!setCookieHeader) return undefined;
    // Bun folds multiple Set-Cookie headers into one comma-joined value.
    // Splitting on commas is unsafe (Expires=... contains commas), so also
    // try parsing the whole value as a single cookie.
    const candidates = [
      setCookieHeader,
      ...setCookieHeader.split(/,(?=[^;,]+=[^;,]*;)/),
    ];
    const sessionCookie = candidates
      .map((c) => c.trim().split(";")[0]?.trim() ?? "")
      .find((c) => c.startsWith("3x-ui=") && c.length > "3x-ui=".length);
    if (sessionCookie && persist) this.headers.set("Cookie", sessionCookie);
    return sessionCookie;
  }

  private async isStatusSuccess() {
    const loginURL = `${this.url}${this.STATUS_ABS_PATH}`;

    const req = Util.newGetRequest(loginURL, this.headers);

    try {
      const res = await fetch(req);
      return res.status === 200;
    } catch (error) {
      console.error(`Status check failed for ${this.name}:`, error);
      return false;
    }
  }
}
