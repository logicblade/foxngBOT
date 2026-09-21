export interface State {
  isSellActive: boolean;
  isRenewActive: boolean;
}

/// Helper type for database
export interface Credential {
  id: number;
  url: string;
  name: string;
  username: string;
  password: string;
}

export type OrderType = "buy" | "renew";
export type OrderStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface Order {
  id: number;
  tg_id: number;
  tg_name: string;
  tg_username: string | null;
  type: OrderType;
  plan_id: string;
  volume_gb: number;
  duration_days: number;
  price: number;
  receipt_file_id: string | null;
  receipt_kind: string | null;
  status: OrderStatus;
  target_uuid: string | null;
  target_inbound_id: number | null;
  created_at: number;
  decided_at: number | null;
  decided_by: number | null;
}

export interface BotUser {
  tg_id: number;
  /** Present in the new schema; absent in the legacy FoxNG `users` table. */
  first_name?: string | null;
  username?: string | null;
  started_at?: number;
  last_seen_at?: number;
}

export interface BotAdmin {
  tg_id: number;
  /** Present in the new schema only. */
  added_by?: number | null;
  added_at: number;
}

export interface Plan {
  id: string;
  volumeGB: number;
  days: number;
  price: number;
  label: string;
}

export type ConfigPrice = "250" | "450";

export interface PendingRenewConfig {
  UUID: string;
  inboundID: number;
}

export type Result = "okay" | "error";

export interface LoginUser {
  username: string;
  password: string;
}

export type UUID = string | null;
export interface UUIDResponse {
  success: string;
  msg: string;
  obj: {
    uuid: UUID;
  };
}

/// New 3X-UI client-centric API (/panel/api/clients/*)
export interface PanelClientTraffic {
  up: number;
  down: number;
  enable: boolean;
}

export interface PanelClient {
  id: number;
  email: string;
  subId?: string;
  uuid?: string;
  password?: string;
  totalGB: number;
  expiryTime: number;
  enable: boolean;
  tgId?: number | string;
  comment?: string;
  limitIp?: number;
  reset?: number;
  flow?: string;
  auth?: string;
  security?: string;
  reverse?: unknown;
  groupName?: string;
  createdAt?: number;
  updatedAt?: number;
  inboundIds: number[];
  traffic?: PanelClientTraffic;
  up?: number;
  down?: number;
}

export interface GetClientsResponse {
  success: boolean;
  msg: string;
  obj: PanelClient[];
}

export interface GetClientResponse {
  success: boolean;
  msg: string;
  obj: PanelClient;
}

export interface NewPanelClient {
  email: string;
  uuid?: string;
  totalGB: number;
  expiryTime: number;
  enable: boolean;
  tgId?: number | string;
  comment?: string;
  limitIp?: number;
  subId?: string;
  flow?: string;
}

export interface PanelClientPayload extends NewPanelClient {
  email: string;
}

export interface UserConfig {
  email: string;
  inboundID: number;
  inboundRemark: string;
  status: boolean;
  uuid: string;
  isRenewable: boolean;
  isOff: boolean;
  hasStarted: boolean;
  remainingBytes: number;
  totalBytes: number;
  expiryTime: number;
}

export interface ExpiryCheckUser {
  email: string;
  tgID: string | number;
  remark: string;
  remainingBytes?: number;
}

export interface GetInboundsResponse {
  success: boolean;
  msg: string;
  obj: Obj[];
}

export interface GetInboundResponse {
  success: boolean;
  msg: string;
  obj: Obj;
}

export interface Obj {
  id: number;
  up: number;
  down: number;
  total: number;
  allTime: number;
  remark: string;
  enable: boolean;
  expiryTime: number;
  trafficReset: string;
  lastTrafficResetTime: number;
  clientStats: ClientStat[];
  listen: string;
  port: number;
  protocol: string;
  settings: Settings;
  streamSettings: StreamSettings;
  tag: string;
  sniffing: string;
}

export interface ClientStat {
  id: number;
  inboundId: number;
  enable: boolean;
  email: string;
  uuid: string;
  subId: string;
  up: number;
  down: number;
  allTime: number;
  expiryTime: number;
  total: number;
  reset: number;
  lastOnline: number;
}

export interface Settings {
  clients: Client[];
  decryption?: string;
  encryption?: string;
  testseed?: number[];
}

export interface Client {
  comment: string;
  created_at: number;
  email: string;
  enable: boolean;
  expiryTime: number;
  flow: string;
  id: string;
  limitIp: number;
  reset: number;
  subId: string;
  tgId: number | string;
  totalGB: number;
  updated_at: number;
  password?: string;
  security?: string;
}

export interface StreamSettings {
  network: string;
  security: string;
  externalProxy: ExternalProxy[];
  wsSettings?: {
    path?: string;
    host?: string;
    headers?: Record<string, string>;
  };
  tcpSettings: {
    acceptProxyProtocol: boolean;
    header: {
      type: string;
      request: {
        version: string;
        method: string;
        path: string[];
        headers: {
          Host: string[];
        };
      };
      response: {
        version: string;
        status: string;
        reason: string;
        headers: {};
      };
    };
  };
  kcpSettings: KcpSettings;
}

export interface ExternalProxy {
  forceTls: string;
  dest: string;
  port: number;
  remark: string;
}

export interface ConfigJSON {
  success: boolean;
  msg: string;
  obj: ObjJSON;
}

export interface ObjJSON {
  api: API;
  burstObservatory: null;
  dns: null;
  fakedns: null;
  inbounds: ConfigInbound[];
  log: Log;
  metrics: Metrics;
  observatory: null;
  outbounds: Outbound[];
  policy: Policy;
  reverse: null;
  routing: Routing;
  stats: Stats;
  transport: null;
}

export interface API {
  services: string[];
  tag: string;
}

export interface ConfigInbound {
  listen: null | string;
  port: number;
  protocol: string;
  settings: InboundSettings;
  sniffing: Sniffing | null;
  streamSettings: StreamSettings | null;
  tag: string;
}

export interface InboundSettings {
  address?: string;
  clients?: InboundClient[];
  decryption?: string;
  encryption?: string;
  testseed?: number[];
}

export interface InboundClient {
  email: string;
  flow?: string;
  id: string;
  password?: string;
}

export interface Sniffing {
  destOverride: DestOverride[];
  enabled: boolean;
  metadataOnly: boolean;
  routeOnly: boolean;
}

export enum DestOverride {
  Fakedns = "fakedns",
  HTTP = "http",
  Quic = "quic",
  TLS = "tls",
}

export interface KcpSettings {
  congestion: boolean;
  downlinkCapacity: number;
  header: Header;
  mtu: number;
  readBufferSize: number;
  seed: string;
  tti: number;
  uplinkCapacity: number;
  writeBufferSize: number;
}

export interface Header {
  type: string;
}

export interface Log {
  access: string;
  dnsLog: boolean;
  error: string;
  loglevel: string;
  maskAddress: string;
}

export interface Metrics {
  listen: string;
  tag: string;
}

export interface Outbound {
  protocol: string;
  settings: OutboundSettings;
  tag: string;
}

export interface OutboundSettings {
  domainStrategy?: string;
  noises?: any[];
  redirect?: string;
}

export interface Policy {
  levels: Levels;
  system: System;
}

export interface Levels {
  "0": The0;
}

export interface The0 {
  statsUserDownlink: boolean;
  statsUserUplink: boolean;
}

export interface System {
  statsInboundDownlink: boolean;
  statsInboundUplink: boolean;
  statsOutboundDownlink: boolean;
  statsOutboundUplink: boolean;
}

export interface Routing {
  domainStrategy: string;
  rules: Rule[];
}

export interface Rule {
  inboundTag?: string[];
  outboundTag: string;
  type: string;
  ip?: string[];
  protocol?: string[];
}

export interface Stats {}
