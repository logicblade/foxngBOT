import { Database } from "bun:sqlite";
import type { BotAdmin, BotUser, Credential, Order, OrderType } from "../lib/types";

export class DB {
  db: Database;
  constructor(dbPath = "panels.sqlite") {
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate() {
    this.db.run(`
  CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  )
`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id INTEGER PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )
`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS admins (
    tg_id INTEGER PRIMARY KEY,
    added_by INTEGER,
    added_at INTEGER NOT NULL
  )
`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

    const userCols = this.db
      .query(`PRAGMA table_info(users)`)
      .all() as { name: string }[];
    const userNames = new Set(userCols.map((column) => column.name));
    if (!userNames.has("first_name")) this.db.run(`ALTER TABLE users ADD COLUMN first_name TEXT`);
    if (!userNames.has("username")) this.db.run(`ALTER TABLE users ADD COLUMN username TEXT`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    tg_name TEXT NOT NULL DEFAULT '',
    tg_username TEXT,
    type TEXT NOT NULL DEFAULT 'buy',
    plan_id TEXT NOT NULL DEFAULT '',
    volume_gb INTEGER NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    config_email TEXT,
    receipt_file_id TEXT,
    receipt_kind TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    target_uuid TEXT,
    target_inbound_id INTEGER,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by INTEGER
  )
`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_orders_tg ON orders(tg_id)`);

    // Lightweight migrations for DBs created before these columns existed.
    const cols = this.db
      .query(`PRAGMA table_info(orders)`)
      .all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    const add = (sql: string) => {
      try {
        this.db.run(sql);
      } catch {
        /* column already exists */
      }
    };
    if (!names.has("tg_name")) add(`ALTER TABLE orders ADD COLUMN tg_name TEXT NOT NULL DEFAULT ''`);
    if (!names.has("tg_username")) add(`ALTER TABLE orders ADD COLUMN tg_username TEXT`);
    if (!names.has("type")) add(`ALTER TABLE orders ADD COLUMN type TEXT NOT NULL DEFAULT 'buy'`);
    if (!names.has("plan_id")) add(`ALTER TABLE orders ADD COLUMN plan_id TEXT NOT NULL DEFAULT ''`);
    if (!names.has("volume_gb")) add(`ALTER TABLE orders ADD COLUMN volume_gb INTEGER NOT NULL DEFAULT 0`);
    if (!names.has("duration_days")) add(`ALTER TABLE orders ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0`);
    if (!names.has("price")) add(`ALTER TABLE orders ADD COLUMN price INTEGER NOT NULL DEFAULT 0`);
    if (!names.has("config_email")) add(`ALTER TABLE orders ADD COLUMN config_email TEXT`);
    if (!names.has("receipt_file_id")) add(`ALTER TABLE orders ADD COLUMN receipt_file_id TEXT`);
    if (!names.has("receipt_kind")) add(`ALTER TABLE orders ADD COLUMN receipt_kind TEXT`);
    if (!names.has("status")) add(`ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'`);
    if (!names.has("target_uuid")) add(`ALTER TABLE orders ADD COLUMN target_uuid TEXT`);
    if (!names.has("target_inbound_id")) add(`ALTER TABLE orders ADD COLUMN target_inbound_id INTEGER`);
    if (!names.has("created_at")) add(`ALTER TABLE orders ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`);
    if (!names.has("decided_at")) add(`ALTER TABLE orders ADD COLUMN decided_at INTEGER`);
    if (!names.has("decided_by")) add(`ALTER TABLE orders ADD COLUMN decided_by INTEGER`);

    // Column sets are cached so methods can adapt to pre-existing (legacy FoxNG) tables.
    this.usersCols = this.columnsOf("users");
    this.adminsCols = this.columnsOf("admins");
  }

  private usersCols: Set<string> = new Set();
  private adminsCols: Set<string> = new Set();

  private columnsOf(table: string): Set<string> {
    try {
      const cols = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      return new Set(cols.map((c) => c.name));
    } catch {
      return new Set();
    }
  }

  private tableExists(table: string): boolean {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { name: string } | null;
    return !!row;
  }

  /** Bonus traffic (GB) granted to a panel client, when the legacy FoxNG table exists. */
  getBonusGB(uuid: string): number {
    if (!this.tableExists("client_bonus")) return 0;
    try {
      const row = this.db
        .query("SELECT bonus_gb FROM client_bonus WHERE uuid = ?")
        .get(uuid) as { bonus_gb: number } | null;
      return row?.bonus_gb ?? 0;
    } catch {
      return 0;
    }
  }

  addPanel(url: string, name: string, username: string, password: string) {
    const stmt = this.db.prepare(
      "INSERT INTO credentials (url, name, username, password) VALUES (?, ?, ?, ?)",
    );
    try {
      url = url.endsWith("/") ? url.slice(0, -1) : url;
      stmt.run(url, name, username, password);
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        console.log("no no no");
      }
    }
  }

  deletePanelByName(name: string): boolean {
    const stmt = this.db.prepare("DELETE FROM credentials WHERE name = ?");

    const result = stmt.run(name);

    // result.changes === number of rows affected
    const deleted = result.changes > 0;

    if (deleted) {
      console.log(`Deleted credential for name: ${name}`);
    }

    return deleted;
  }

  /**
   * Replaces an existing panel (matched by its current name) with new credentials
   * in place, so anything referencing the panel keeps a single row to point at.
   * Returns "ok", "not_found" when no panel had that name, or "duplicate" when the
   * new url/name collide with another panel (UNIQUE constraint).
   */
  replacePanel(
    oldName: string,
    url: string,
    name: string,
    username: string,
    password: string,
  ): "ok" | "not_found" | "duplicate" {
    url = url.endsWith("/") ? url.slice(0, -1) : url;
    try {
      const res = this.db
        .prepare(
          "UPDATE credentials SET url = ?, name = ?, username = ?, password = ? WHERE name = ?",
        )
        .run(url, name, username, password, oldName);
      return res.changes > 0 ? "ok" : "not_found";
    } catch (error) {
      if (String(error).includes("UNIQUE")) return "duplicate";
      throw error;
    }
  }

  getPanels() {
    const creds = this.db
      .query("SELECT * FROM credentials")
      .all() as Credential[];
    return creds;
  }

  getDiscountPercent(): number {
    const row = this.db
      .query("SELECT value FROM app_settings WHERE key = 'global_discount_percent'")
      .get() as { value: string } | null;
    const value = Number(row?.value ?? 0);
    return Number.isFinite(value) && value >= 1 && value <= 100 ? value : 0;
  }

  getSetting(key: string, fallback: string): string {
    const row = this.db
      .query("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as { value: string } | null;
    return row?.value ?? fallback;
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  setDiscountPercent(percent: number | null): void {
    if (percent === null || percent <= 0) {
      this.db.run("DELETE FROM app_settings WHERE key = 'global_discount_percent'");
      return;
    }
    this.db.run(
      "INSERT INTO app_settings (key, value) VALUES ('global_discount_percent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(percent)],
    );
  }

  /**
   * Records that a Telegram user started/used the bot.
   * Works against both the new schema (first_name/username/started_at/last_seen_at)
   * and the legacy FoxNG schema (first_seen/last_seen only).
   */
  upsertUser(tgId: number, firstName?: string | null, username?: string | null) {
    const now = Date.now();
    const cols = this.usersCols;
    const existing = this.db
      .query("SELECT tg_id FROM users WHERE tg_id = ?")
      .get(tgId) as { tg_id: number } | null;

    if (existing) {
      const sets: string[] = [];
      const vals: (number | string | null)[] = [];
      if (cols.has("last_seen_at")) {
        sets.push("last_seen_at = ?");
        vals.push(now);
      }
      if (cols.has("last_seen")) {
        sets.push("last_seen = ?");
        vals.push(now);
      }
      if (cols.has("first_name")) {
        sets.push("first_name = ?");
        vals.push(firstName ?? null);
      }
      if (cols.has("username")) {
        sets.push("username = ?");
        vals.push(username ?? null);
      }
      if (sets.length > 0) {
        this.db.run(`UPDATE users SET ${sets.join(", ")} WHERE tg_id = ?`, [...vals, tgId]);
      }
      return;
    }

    const names: string[] = ["tg_id"];
    const vals: (number | string | null)[] = [tgId];
    const push = (col: string, value: number | string | null) => {
      if (cols.has(col)) {
        names.push(col);
        vals.push(value);
      }
    };
    push("first_name", firstName ?? null);
    push("username", username ?? null);
    push("started_at", now);
    push("first_seen", now);
    push("last_seen_at", now);
    push("last_seen", now);

    const placeholders = names.map(() => "?").join(", ");
    this.db.run(`INSERT INTO users (${names.join(", ")}) VALUES (${placeholders})`, vals);
  }

  getAllUsers(): BotUser[] {
    const cols = this.usersCols;
    const nameCols: string[] = ["tg_id"];
    if (cols.has("first_name")) nameCols.push("first_name");
    if (cols.has("username")) nameCols.push("username");
    return this.db
      .query(`SELECT ${nameCols.join(", ")} FROM users ORDER BY tg_id ASC`)
      .all() as BotUser[];
  }

  getUserCount(): number {
    const row = this.db.query("SELECT COUNT(*) as c FROM users").get() as { c: number };
    return row?.c ?? 0;
  }

  hasUser(tgId: number): boolean {
    const row = this.db.query("SELECT tg_id FROM users WHERE tg_id = ?").get(tgId) as
      | { tg_id: number }
      | null;
    return !!row;
  }

  isAdmin(tgId: number): boolean {
    const row = this.db
      .query("SELECT tg_id FROM admins WHERE tg_id = ?")
      .get(tgId) as { tg_id: number } | null;
    return !!row;
  }

  addAdmin(tgId: number, addedBy: number | null): boolean {
    try {
      // `added_by` only exists in the new schema; the legacy FoxNG table has tg_id + added_at.
      if (this.adminsCols.has("added_by")) {
        this.db.run("INSERT INTO admins (tg_id, added_by, added_at) VALUES (?, ?, ?)", [
          tgId,
          addedBy,
          Date.now(),
        ]);
      } else {
        this.db.run("INSERT INTO admins (tg_id, added_at) VALUES (?, ?)", [tgId, Date.now()]);
      }
      return true;
    } catch {
      return false;
    }
  }

  removeAdmin(tgId: number): boolean {
    const res = this.db.run("DELETE FROM admins WHERE tg_id = ?", [tgId]);
    return res.changes > 0;
  }

  getAdmins(): BotAdmin[] {
    const cols: string[] = ["tg_id", "added_at"];
    if (this.adminsCols.has("added_by")) cols.splice(1, 0, "added_by");
    return this.db
      .query(`SELECT ${cols.join(", ")} FROM admins ORDER BY added_at ASC`)
      .all() as BotAdmin[];
  }

  createOrder(input: {
    tgId: number;
    tgName: string;
    tgUsername?: string | null;
    type: OrderType;
    planId: string;
    volumeGB: number;
    durationDays: number;
    price: number;
    configEmail?: string | null;
    targetUUID?: string | null;
    targetInboundId?: number | null;
  }): number {
    const res = this.db.run(
      `INSERT INTO orders (tg_id, tg_name, tg_username, type, plan_id, volume_gb, duration_days, price, config_email, status, target_uuid, target_inbound_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [
        input.tgId,
        input.tgName,
        input.tgUsername ?? null,
        input.type,
        input.planId,
        input.volumeGB,
        input.durationDays,
        input.price,
        input.configEmail ?? null,
        input.targetUUID ?? null,
        input.targetInboundId ?? null,
        Date.now(),
      ],
    );
    return Number(res.lastInsertRowid);
  }

  attachReceipt(orderId: number, fileId: string, kind: string) {
    this.db.run("UPDATE orders SET receipt_file_id = ?, receipt_kind = ? WHERE id = ?", [
      fileId,
      kind,
      orderId,
    ]);
  }

  clearOrderConfigEmail(orderId: number) {
    this.db.run("UPDATE orders SET config_email = NULL WHERE id = ?", [orderId]);
  }

  clearOrders(): number {
    const count = this.db
      .query("SELECT COUNT(*) AS count FROM orders")
      .get() as { count: number };
    this.db.run("DELETE FROM orders");
    return count.count;
  }

  getOrderById(orderId: number): Order | null {
    return (this.db.query("SELECT * FROM orders WHERE id = ?").get(orderId) as Order | null) ?? null;
  }

  getPendingOrders(limit = 20): Order[] {
    return this.db
      .query("SELECT * FROM orders WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Order[];
  }

  getPendingOrderCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM orders WHERE status = 'PENDING'")
      .get() as { c: number };
    return row?.c ?? 0;
  }

  getPendingOrderIdForUser(tgId: number): number | null {
    const row = this.db
      .query(
        "SELECT id FROM orders WHERE tg_id = ? AND status = 'PENDING' AND receipt_file_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(tgId) as { id: number } | null;
    return row?.id ?? null;
  }

  /** Atomically claim a PENDING order so two admins cannot process it twice. */
  claimOrder(orderId: number, decidedBy: number, status: "APPROVED" | "REJECTED"): boolean {
    const res = this.db.run(
      "UPDATE orders SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'PENDING'",
      [status, Date.now(), decidedBy, orderId],
    );
    return res.changes > 0;
  }

  /**
   * Puts an APPROVED order back to PENDING so the reviewer can retry after a
   * transient failure (e.g. panel login failed before anything was applied).
   */
  revertOrderToPending(orderId: number): boolean {
    const res = this.db.run(
      "UPDATE orders SET status = 'PENDING', decided_at = NULL, decided_by = NULL WHERE id = ? AND status = 'APPROVED'",
      [orderId],
    );
    return res.changes > 0;
  }

  cancelPendingOrdersForUser(tgId: number) {
    this.db.run("UPDATE orders SET status = 'CANCELLED', decided_at = ? WHERE tg_id = ? AND status = 'PENDING'", [
      Date.now(),
      tgId,
    ]);
  }

  /**
   * Consistent SQLite snapshot (safe while the bot keeps writing to the live DB).
   * `VACUUM INTO` writes a fully-formed database file from the current state.
   */
  backupTo(targetPath: string): void {
    this.db.run("VACUUM INTO ?", [targetPath]);
  }
}
