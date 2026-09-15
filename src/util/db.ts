import { Database } from "bun:sqlite";

export class DB {
  db: Database;
  constructor() {
    this.db = new Database("panels.sqlite");

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
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )
`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS client_bonus (
    uuid TEXT PRIMARY KEY,
    bonus_gb INTEGER NOT NULL
  )
`);

    this.db.run(`
  CREATE TABLE IF NOT EXISTS admins (
    tg_id INTEGER PRIMARY KEY,
    added_at INTEGER NOT NULL
  )
`);
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

  getPanels() {
    const creds = this.db
      .query("SELECT * FROM credentials")
      .all() as Credential[];
    return creds;
  }

  upsertUser(tgId: number) {
    const now = Date.now();
    this.db.run(
      `INSERT INTO users (tg_id, first_seen, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(tg_id) DO UPDATE SET last_seen = excluded.last_seen`,
      [tgId, now, now],
    );
  }

  getUserIds(): number[] {
    const rows = this.db
      .query("SELECT tg_id FROM users ORDER BY tg_id")
      .all() as { tg_id: number }[];
    return rows.map((r) => r.tg_id);
  }

  getUserCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS count FROM users")
      .get() as { count: number };
    return row.count;
  }

  /** Display bonus (title GB minus granted GB, accumulated over renewals). */
  getClientBonus(uuid: string): number | null {
    const row = this.db
      .query("SELECT bonus_gb AS bonus FROM client_bonus WHERE uuid = ?")
      .get(uuid) as { bonus: number } | null;
    return row ? row.bonus : null;
  }

  setClientBonus(uuid: string, bonusGB: number) {
    this.db.run(
      `INSERT INTO client_bonus (uuid, bonus_gb) VALUES (?, ?)
       ON CONFLICT(uuid) DO UPDATE SET bonus_gb = excluded.bonus_gb`,
      [uuid, bonusGB],
    );
  }

  /** Sub-admins (added by the owner via telegram ID). Owner is NOT stored here. */
  addAdmin(tgId: number): boolean {
    try {
      this.db.run(`INSERT INTO admins (tg_id, added_at) VALUES (?, ?)`, [
        tgId,
        Date.now(),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  removeAdmin(tgId: number): boolean {
    const result = this.db.run(`DELETE FROM admins WHERE tg_id = ?`, [tgId]);
    return result.changes > 0;
  }

  isAdmin(tgId: number): boolean {
    const row = this.db
      .query(`SELECT 1 AS ok FROM admins WHERE tg_id = ?`)
      .get(tgId) as { ok: number } | null;
    return !!row;
  }

  getAdmins(): number[] {
    const rows = this.db
      .query(`SELECT tg_id FROM admins ORDER BY tg_id`)
      .all() as { tg_id: number }[];
    return rows.map((r) => r.tg_id);
  }
}
