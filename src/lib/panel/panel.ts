import { fetch } from "bun";
import type { DB } from "../../util/db";
import { Util } from "../../util/util";
import type {
  ConfigJSON,
  GetClientResponse,
  GetClientsResponse,
  GetInboundResponse,
  GetInboundsResponse,
  NewPanelClient,
  Obj,
  PanelClientPayload,
  Result,
  Settings,
  StreamSettings,
  UserConfig,
} from "../types";

/** Cooldown applied to a panel after a soft login failure (retry the next approval). */
const LOGIN_BACKOFF_MS = 60_000;
/** 3x-ui bans ip+username for 15 min after 5 failed logins in 5 min. Mirror that to avoid pointless 403 retries. */
const LOGIN_BAN_COOLDOWN_MS = 15 * 60_000;

export function getAllPanels(db: DB) {
  let panels: Panel[] = [];

  const creds = db.getPanels();

  for (const cred of creds) {
    const panel = new Panel(cred.name, cred.url, cred.username, cred.password);
    panels.push(panel);
  }

  return panels;
}

/** Thrown when a panel operation can't proceed because login/panel access failed. */
export class PanelLoginError extends Error {
  panelName: string;

  constructor(panelName: string, message = "panel login failed") {
    super(`${message} for panel "${panelName}"`);
    this.name = "PanelLoginError";
    this.panelName = panelName;
  }
}

export class Panel {
  /**
   * Panel instances are short-lived (they are recreated for each bot update),
   * so a per-instance cooldown would not stop repeated login attempts. Keep
   * this state process-wide, keyed by the panel endpoint and account.
   */
  private static loginBackoffUntilByPanel = new Map<string, number>();
  private INBOUNDS_PATH = "/panel/api/inbounds";
  private CLIENTS_PATH = "/panel/api/clients";
  private LOGIN_PATH = "/login";
  private UUID_ABS_PATH = "/panel/api/server/getNewUUID";
  private STATUS_ABS_PATH = "/panel/api/server/status";

    headers = new Headers();
  private lastLogins = new Map<string, number>();
  private lastLoginIssue: string | null = null;
  private csrfToken: string | null = null;
  /** Timestamp until which we must NOT retry logging in to this panel (rate-limit ban / backoff). */
  private loginBackoffUntil: number = 0;

  /** Human-readable reason of the most recent login failure (null on success). */
  get loginIssue(): string | null {
    return this.lastLoginIssue;
  }

  name: string;
  url: string;
  private username: string;
  private password: string;

  constructor(name: string, url: string, usename: string, password: string) {
    this.headers.set("Content-Type", "application/json");
    this.headers.set("Accept", "application/json, text/plain, */*");
    // A normal browser User-Agent avoids 403s from reverse proxies / WAFs that
    // block default bot clients (Bun's default UA is "Bun/x.y.z").
    this.headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    );

    this.name = name;
    this.url = url;
    this.username = usename;
    this.password = password;
  }

  private loginKey() {
    return `${this.url}|${this.username}`;
  }

  private setLoginBackoff(durationMs: number) {
    const until = Date.now() + durationMs;
    this.loginBackoffUntil = until;
    Panel.loginBackoffUntilByPanel.set(this.loginKey(), until);
  }

  private clearLoginBackoff() {
    this.loginBackoffUntil = 0;
    Panel.loginBackoffUntilByPanel.delete(this.loginKey());
  }

  /** Fetches the CSRF token bound to the current authenticated session. */
  private async refreshCsrfToken(): Promise<void> {
    try {
      const response = await fetch(`${this.url}/csrf-token`, {
        headers: new Headers({
          Accept: "application/json",
          Cookie: this.headers.get("Cookie") ?? "",
          "User-Agent": this.headers.get("User-Agent") ?? "",
        }),
      });
      if (!response.ok) return;
      const body = (await response.json().catch(() => null)) as { obj?: unknown } | null;
      if (typeof body?.obj === "string" && body.obj !== "") {
        this.csrfToken = body.obj;
        this.headers.set("X-CSRF-Token", this.csrfToken);
      }
    } catch {
      // Older panels do not implement CSRF protection.
    }
  }

  getUpdatePath(_url: string, email: string) {
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
    if (!(await this.handleLogin())) return false;

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
    // Never call panel endpoints without a valid session. A 403 login response
    // otherwise leads to an unauthenticated response (often `null`), which
    // used to crash while reading `obj` below.
    if (!(await this.handleLogin())) return;

    const url = `${this.url}${this.INBOUNDS_PATH}/list`;
    const req = Util.newGetRequest(url, this.headers);

    try {
      const res = await fetch(req);
      if (!res.ok) {
        this.lastLoginIssue = `could not fetch inbounds (HTTP ${res.status})`;
        console.error(`Failed to get all inbounds for panel "${this.name}": HTTP ${res.status}`);
        return;
      }

      const js = (await res.json().catch(() => null)) as GetInboundsResponse | null;
      if (js === null || !Array.isArray(js.obj)) {
        this.lastLoginIssue = "panel returned an invalid inbounds response";
        console.error(`Failed to get all inbounds for panel "${this.name}": invalid response body`);
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

  async addClient(inboundID: number, client: NewPanelClient) {
    if (!(await this.handleLogin())) {
      throw new PanelLoginError(this.name, this.loginIssue ?? "could not log in");
    }

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

  /** Finds a client row by its vless/vmess credential (uuid), scanning the list. */
  async findClientByUUID(uuid: string): Promise<PanelClient | undefined> {
    try {
      const list = await this.getClients();
      const rows = Array.isArray(list?.obj) ? list.obj : [];
      return rows.find(
        (r) =>
          Panel.extractClientUuid(r) === uuid ||
          r?.email === uuid,
      );
    } catch (error) {
      console.error("findClientByUUID failed:", error);
      return undefined;
    }
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
    if (!(await this.handleLogin())) {
      throw new PanelLoginError(this.name, this.loginIssue ?? "could not log in");
    }

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
    // getInbounds owns authentication; do not retry /login a second time for
    // a single user request, especially while the panel is rate-limiting us.
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

            const used = (stat?.down ?? 0) + (stat?.up ?? 0);
            const totalBytes = client.totalGB ?? 0;
            const remainingGB = totalBytes - used;
            const isRenewable =
              client.totalGB !== 0 && remainingGB <= Util.gigsToBytes(3);
            const inboundRemark = obj.remark;
            const status = stat?.enable ?? false;
            const hasStarted = client.expiryTime > 0;
            const displayEmail = stat?.email ?? client.email ?? "";
            const statusMark = status && hasStarted ? "🟢" : status ? "" : "🔴";
            const email = `${statusMark} ${inboundRemark}-${displayEmail}`.trim();

            userConfigs.push({
              email,
              // Client stats may not be populated immediately after
              // provisioning. The inbound itself remains authoritative.
              inboundID: stat?.inboundId ?? obj.id,
              inboundRemark,
              isOff: !(clientRow?.enable ?? client.enable),
              isRenewable,
              status,
              uuid: clientRow?.uuid ?? client.id,
              hasStarted,
              remainingBytes: remainingGB,
              totalBytes,
              expiryTime: client.expiryTime ?? 0,
            });
          }
        });
      }

      return userConfigs;
    }
  }

  /**
   * Looks up the client exactly as stored in the panel. The client's `id` is
   * the authoritative UUID; `comment` is deliberately not used as an email.
   */
  async getStoredClient(email: string): Promise<{ uuid: string; inboundID: number } | undefined> {
    const inbounds = await this.getInbounds();
    for (const inbound of inbounds?.obj ?? []) {
      const client = inbound.settings.clients.find((item) => item.email === email);
      if (client) return { uuid: client.id, inboundID: inbound.id };
    }
    return;
  }

  async getNewUUID(): Promise<string | null> {
    const loggedIn = await this.handleLogin();
    if (!loggedIn) {
      console.error(
        `getNewUUID: skipping request, not logged in for panel "${this.name}"`,
      );
      return null;
    }

    const req = Util.newGetRequest(
      `${this.url}${this.UUID_ABS_PATH}`,
      this.headers,
    );

    try {
      const res = await fetch(req);
      if (res.status !== 200) {
        console.error("getNewUUID failed, status code", res.status);
        return null;
      }
      // The panel can answer 200 with a non-JSON/error body on auth problems,
      // so tolerate any parse failure here instead of crashing.
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        msg?: string;
        obj?: unknown;
      } | null;
      if (!body || typeof body !== "object") {
        console.error("getNewUUID: unexpected (non-JSON) response body");
        return null;
      }
      if (body.success === false) {
        console.error("getNewUUID failed:", body.msg);
        return null;
      }
      // New API: { obj: "<uuid-string>" }; old API: { obj: { uuid } }.
      if (typeof body.obj === "string") return body.obj;
      const uuid = (body.obj as { uuid?: string } | null)?.uuid;
      return typeof uuid === "string" ? uuid : null;
    } catch (error) {
      console.error("getNewUUID error:", error);
      return null;
    }
  }

  private async handleLogin(): Promise<boolean> {
    const now = Date.now();

    // Respect the per-panel login backoff (set after 3x-ui's 15-min IP ban or
    // other failures) so we stop hammering /login while blocked and let the
    // ban cool down before retrying.
    const sharedBackoffUntil = Panel.loginBackoffUntilByPanel.get(this.loginKey()) ?? 0;
    this.loginBackoffUntil = Math.max(this.loginBackoffUntil, sharedBackoffUntil);
    if (now < this.loginBackoffUntil) {
      const remainingSeconds = Math.round((this.loginBackoffUntil - now) / 1000);
      this.lastLoginIssue = `login is temporarily blocked; retry in ${remainingSeconds}s`;
      console.error(
        `login on backoff for panel "${this.name}" (cooling down for ${remainingSeconds}s)`,
      );
      return false;
    }

    const lastLogin = this.lastLogins.get(this.name);
    const isLoggedIn = await this.isStatusSuccess();

    if (
      isLoggedIn &&
      lastLogin &&
      now - lastLogin < Util.getUnixTimeOf({ days: 2 })
    ) {
      console.log("You're already logged in");
      return true;
    }

    const loginRes = await this.performLogin();
    if (loginRes === "okay") {
      this.lastLogins.set(this.name, now);
      console.log("Login done!");
      return true;
    }

    console.error("Failed to login for:", this.name);
    return false;
  }

  private async performLogin(): Promise<Result> {
  const url = `${this.url}${this.LOGIN_PATH}`;
  this.lastLoginIssue = null;

  // Newer 3X-UI releases reject a plain POST /login with HTTP 403. Their web
  // UI first obtains a CSRF token and pre-login cookie, then sends both with
  // JSON credentials. Older releases do not expose /csrf-token, so this step
  // remains best-effort and they fall back to the ordinary JSON login.
  let csrfCookie: string | null = null;
  this.csrfToken = null;
  try {
    const csrfRes = await fetch(`${this.url}/csrf-token`, {
      headers: new Headers({
        Accept: "application/json",
        "User-Agent": this.headers.get("User-Agent") ?? "",
      }),
    });
    if (csrfRes.ok) {
      const csrfBody = (await csrfRes.json().catch(() => null)) as {
        obj?: unknown;
      } | null;
      if (typeof csrfBody?.obj === "string" && csrfBody.obj !== "") {
        this.csrfToken = csrfBody.obj;
      }
      csrfCookie = this.sessionCookieFrom(csrfRes);
    }
  } catch {
    // Older panels and some reverse proxies have no CSRF endpoint.
  }

  const headers = new Headers(this.headers);
  headers.set("Content-Type", "application/json");
  if (csrfCookie !== null) headers.set("Cookie", csrfCookie);
  if (this.csrfToken !== null) headers.set("X-CSRF-Token", this.csrfToken);
  const body = JSON.stringify({ username: this.username, password: this.password });

  const req = Util.newPostRequest(url, headers, body);

  let res: Response;
  try {
    res = await fetch(req);
  } catch (error) {
    this.lastLoginIssue = "panel unreachable (network error)";
    console.error("Login request failed:", error);
    this.setLoginBackoff(LOGIN_BACKOFF_MS);
    return "error";
  }

  // Read once as text so non-JSON bodies (HTML/WAF challenge, ban pages)
  // are surfaced instead of being swallowed as "undefined".
  const bodyText = await res.text().catch(() => "");
  let data: { success?: boolean; msg?: string } | null = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText) as { success?: boolean; msg?: string };
    } catch {
      data = null;
    }
  }
  const bodySnippet = bodyText.slice(0, 300);

  if (res.status === 403) {
    // Login rate limiter ban (or a proxy/WAF block). 3x-ui bans for 15 min,
    // so set a matching backoff so we stop hammering and retry when it lifts.
    this.setLoginBackoff(LOGIN_BAN_COOLDOWN_MS);
    this.lastLoginIssue = `login rate-limited/blocked by panel (HTTP 403)${bodySnippet ? `: ${bodySnippet}` : ""}`;
    console.error(this.lastLoginIssue);
    return "error";
  }

  if (res.status !== 200) {
    this.lastLoginIssue = `panel answered HTTP ${res.status}: ${bodySnippet}`;
    console.error("Failed to get response, status code", res.status, bodySnippet);
    this.setLoginBackoff(LOGIN_BACKOFF_MS);
    return "error";
  }

  if (data && data.success === false) {
    this.lastLoginIssue = `panel rejected login: ${data.msg ?? bodySnippet}`;
    console.error(this.lastLoginIssue);
    this.setLoginBackoff(LOGIN_BACKOFF_MS);
    return "error";
  }

  const session = this.sessionCookieFrom(res);
  if (session) {
    this.headers.set("Cookie", session);
    // A pre-login token is rejected by newer panels for protected POSTs.
    // Refresh it after receiving the authenticated session cookie.
    await this.refreshCsrfToken();
    this.lastLoginIssue = null;
    this.clearLoginBackoff();
    return "okay";
  }

  this.lastLoginIssue = `panel did not return a session cookie${bodySnippet ? `: ${bodySnippet}` : ""}`;
  this.setLoginBackoff(LOGIN_BACKOFF_MS);
  console.error(this.lastLoginIssue);
  return "error";
}

  /** Pulls all session-cookie pairs out of a login or CSRF response. */
  private sessionCookieFrom(res: Response): string | null {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [res.headers.get("Set-Cookie") ?? ""];
    const pairs = cookies
      .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
      .filter((pair) => pair.includes("="));
    return pairs.length > 0 ? pairs.join("; ") : null;
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
