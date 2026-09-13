interface State {
  isSellActive: boolean;
  isRenewActive: boolean;
}

/// Helper type for database
interface Credential {
  id: number;
  url: string;
  name: string;
  username: string;
  password: string;
}

type ConfigPrice = "10g" | "20g" | "30g" | "50g" | "100g";

interface PendingRenewConfig {
  UUID: string;
  inboundID: number;
}

type Result = "okay" | "error";

interface LoginUser {
  username: string;
  password: string;
}

type UUID = string | null;
interface UUIDResponse {
  success: string;
  msg: string;
  obj: {
    uuid: UUID;
  };
}

/// New 3X-UI client-centric API (/panel/api/clients/*)
interface PanelClientTraffic {
  up: number;
  down: number;
  enable: boolean;
}

interface PanelClient {
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

interface GetClientsResponse {
  success: boolean;
  msg: string;
  obj: PanelClient[];
}

interface GetClientResponse {
  success: boolean;
  msg: string;
  obj: PanelClient;
}

interface NewPanelClient {
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

interface PanelClientPayload extends NewPanelClient {
  email: string;
}

/** Result of adding a client, carrying the panel-confirmed credential. */
interface AddClientResult {
  ok: boolean;
  /** The uuid/vless-id actually stored by the panel (source of truth). */
  uuid?: string;
  status?: number;
  body?: string;
}

interface UserConfig {
  email: string;
  inboundID: number;
  inboundRemark: string;
  status: boolean;
  uuid: string;
  isRenewable: boolean;
  isOff: boolean;
  hasStarted: boolean;
  totalGB: number;
  remainingGB: number;
}

interface ExpiryCheckUser {
  email: string;
  tgID: string | number;
  remark: string;
}

interface GetInboundsResponse {
  success: boolean;
  msg: string;
  obj: Obj[];
}

interface GetInboundResponse {
  success: boolean;
  msg: string;
  obj: Obj;
}

interface Obj {
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

interface ClientStat {
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

interface Settings {
  clients: Client[];
  decryption?: string;
  encryption?: string;
  testseed?: number[];
}

interface Client {
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

interface StreamSettings {
  network: string;
  security: string;
  externalProxy?: ExternalProxy[];
  tcpSettings?: {
    acceptProxyProtocol: boolean;
    header: {
      type: string;
      request?: {
        version: string;
        method: string;
        path: string[];
        headers: {
          Host: string[];
        };
      };
      response?: {
        version: string;
        status: string;
        reason: string;
        headers: {};
      };
    };
  };
  wsSettings?: {
    acceptProxyProtocol?: boolean;
    path?: string;
    /** Newer xray panels put the Host here directly. */
    host?: string;
    /** Older ones keep it in headers.Host. */
    headers?: {
      Host?: string;
      [key: string]: string | undefined;
    };
  };
  realitySettings?: {
    show?: boolean;
    dest?: string;
    xver?: number;
    serverNames?: string[];
    privateKey?: string;
    publicKey?: string;
    shortIds?: string[];
    fingerprint?: string;
    spiderX?: string;
  };
  xhttpSettings?: {
    path?: string;
    host?: string;
    mode?: string;
  };
  kcpSettings?: KcpSettings;
}

interface ExternalProxy {
  forceTls: string;
  dest: string;
  port: number;
  remark: string;
}

interface ConfigJSON {
  success: boolean;
  msg: string;
  obj: ObjJSON;
}

interface ObjJSON {
  api: API;
  burstObservatory: null;
  dns: null;
  fakedns: null;
  inbounds: Inbound[];
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

interface API {
  services: string[];
  tag: string;
}

interface Inbound {
  listen: null | string;
  port: number;
  protocol: string;
  settings: InboundSettings;
  sniffing: Sniffing | null;
  streamSettings: StreamSettings | null;
  tag: string;
}

interface InboundSettings {
  address?: string;
  clients?: Client[];
  decryption?: string;
  encryption?: string;
  testseed?: number[];
}

interface Client {
  email: string;
  flow?: string;
  id: string;
  password?: string;
}

interface Sniffing {
  destOverride: DestOverride[];
  enabled: boolean;
  metadataOnly: boolean;
  routeOnly: boolean;
}

enum DestOverride {
  Fakedns = "fakedns",
  HTTP = "http",
  Quic = "quic",
  TLS = "tls",
}

interface KcpSettings {
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

interface Header {
  type: string;
}

interface Log {
  access: string;
  dnsLog: boolean;
  error: string;
  loglevel: string;
  maskAddress: string;
}

interface Metrics {
  listen: string;
  tag: string;
}

interface Outbound {
  protocol: string;
  settings: OutboundSettings;
  tag: string;
}

interface OutboundSettings {
  domainStrategy?: string;
  noises?: any[];
  redirect?: string;
}

interface Policy {
  levels: Levels;
  system: System;
}

interface Levels {
  "0": The0;
}

interface The0 {
  statsUserDownlink: boolean;
  statsUserUplink: boolean;
}

interface System {
  statsInboundDownlink: boolean;
  statsInboundUplink: boolean;
  statsOutboundDownlink: boolean;
  statsOutboundUplink: boolean;
}

interface Routing {
  domainStrategy: string;
  rules: Rule[];
}

interface Rule {
  inboundTag?: string[];
  outboundTag: string;
  type: string;
  ip?: string[];
  protocol?: string[];
}

interface Stats {}
