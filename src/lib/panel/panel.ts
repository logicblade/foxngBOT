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

    this.name = name;
    this.url = url;
    this.username = usename;
    this.password = password;
  }

  getUpdatePath(_url: string, email: string) {
    return `${this.url}${this.CLIENTS_PATH}/update/${encodeURIComponent(email)}`;
  }

  getAddClientPath(_url: string) {
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
    const js = (await res.json()) as GetInboundResponse;

    const parsed: GetInboundResponse = {
      ...js,
      obj: js.obj && this.parseInbound(js.obj),
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

      const js = (await res.json()) as GetInboundsResponse;

      const parsed: GetInboundsResponse = {
        ...js,
        obj: (js.obj ?? []).map((obj) => this.parseInbound(obj)),
      };

      return parsed;
    } catch (error) {
      console.error("Failed to get all inbounds:", error);
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
      const js = (await res.json()) as GetClientResponse;
      return js;
    } catch (error) {
      console.error("Failed to get client:", error);
      return;
    }
  }

  async addClient(inboundID: number, client: NewPanelClient) {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/add`;
    const body = JSON.stringify({ client, inboundIds: [inboundID] });
    const req = Util.newPostRequest(url, this.headers, body);

    const res = await fetch(req);
    return res;
  }

  async updateClient(email: string, client: PanelClientPayload) {
    await this.handleLogin();

    const url = `${this.url}${this.CLIENTS_PATH}/update/${encodeURIComponent(email)}`;
    const body = JSON.stringify(client);
    const req = Util.newPostRequest(url, this.headers, body);

    const res = await fetch(req);
    return res;
  }

  async addClientToInbound(inboundID: number, email: string, UUID: string) {
    await this.handleLogin();
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

    if (inbounds) {
      let userConfigs: UserConfig[] = [];

      for (const obj of inbounds.obj) {
        obj.settings.clients.forEach((client) => {
          if (userID === Number(client.comment)) {
            const stat = obj.clientStats.find(
              (s) => s.uuid === client.id || s.email === client.email,
            );

            if (!stat) {
              console.warn(
                `No clientStat found for client id=${client.id} email=${client.email}`,
              );
            }

            const used = (stat?.down ?? 0) + (stat?.up ?? 0);
            const remainingGB = client.totalGB - used;
            const isRenewable =
              (client.expiryTime !== 0 &&
                client.expiryTime - Date.now() <
                  Util.getUnixTimeOf({ days: 3 })) ||
              (client.totalGB !== 0 && remainingGB <= Util.gigsToBytes(3));
            const inboundRemark = obj.remark;
            const status = stat?.enable ?? false;
            const hasStarted = client.expiryTime > 0;
            const displayEmail = stat?.email ?? client.email ?? "";
            const email = `${status ? (hasStarted ? (isRenewable ? "🟡" : "🟢") : "🟠") : "🔴"} ${inboundRemark}-${displayEmail}`;

            userConfigs.push({
              email,
              inboundID: stat?.inboundId ?? 0,
              inboundRemark,
              isOff: !client.enable,
              isRenewable,
              status,
              uuid: client.id,
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

    const req = Util.newPostRequest(url, this.headers, JSON.stringify(user));

    const res = await fetch(req);
    if (res.status !== 200) {
      console.error("Failed to get response, status code", res.status);
      return "error";
    }

    const setCookieHeader = res.headers.get("Set-Cookie");
    if (setCookieHeader?.includes("3x-ui=")) {
      const tokenFromCookie = setCookieHeader.split(";")[0];
      if (tokenFromCookie) {
        this.headers.set("Cookie", tokenFromCookie!);
        return "okay";
      }
    }

    return "error";
  }

  private async isStatusSuccess() {
    const loginURL = `${this.url}${this.STATUS_ABS_PATH}`;

    const req = Util.newGetRequest(loginURL, this.headers);

    const res = await fetch(req);

    return res.status === 200;
  }
}
