// db.js
// Вся денежная и игровая экономика живёт только тут (SQLite через better-sqlite3).
// Клиент никогда напрямую не пишет в баланс — только через функции этого файла,
// вызванные из server.js после проверки initData.
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { PLAYERS_BY_ID } from './players-data.js';

const db = new Database(process.env.DB_PATH || 'sportlive.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id     TEXT PRIMARY KEY,
    username        TEXT,
    tg_stars        INTEGER NOT NULL DEFAULT 0,
    slive_tokens    INTEGER NOT NULL DEFAULT 1000,
    squad           TEXT NOT NULL DEFAULT '{}',
    last_update_at  INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    inst_id      TEXT PRIMARY KEY,
    telegram_id  TEXT NOT NULL,
    player_id    TEXT NOT NULL,
    acquired_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(telegram_id);

  CREATE TABLE IF NOT EXISTS payments (
    charge_id    TEXT PRIMARY KEY,
    telegram_id  TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS star_ledger (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  TEXT NOT NULL,
    delta        INTEGER NOT NULL,
    reason       TEXT,
    created_at   INTEGER NOT NULL
  );
`);

// ---------- helpers ----------

function now() {
  return Date.now();
}

function rowToPlayer(instRow) {
  const meta = PLAYERS_BY_ID[instRow.player_id];
  if (!meta) return null; // на случай если карта была удалена из players-data.js
  return { ...meta, instId: instRow.inst_id, acquiredAt: instRow.acquired_at };
}

function getInventory(telegramId) {
  const rows = db
    .prepare('SELECT * FROM inventory WHERE telegram_id = ? ORDER BY acquired_at ASC')
    .all(telegramId);
  return rows.map(rowToPlayer).filter(Boolean);
}

// Ставка фарма в SLive/сек — сумма income карт в составе, с той же бустной
// "химией" за одинаковую nation, что и в клиентском renderSquad() (иначе
// офлайн-начисление на сервере тихо не совпадало бы с тем, что игрок видит
// на экране, пока приложение открыто). Состав валидируется против
// инвентаря: клиент присылает только instId, а не income/rating, поэтому
// подделать ставку фарма нельзя.
function computeFarmRate(telegramId, squad, inventoryByInstId) {
  let baseIncome = 0;
  const nationsCount = {};

  for (const instId of Object.values(squad || {})) {
    if (!instId) continue;
    const inst = inventoryByInstId.get(instId);
    if (!inst || inst.telegram_id !== telegramId) continue; // не своя карта — игнорируем
    const meta = PLAYERS_BY_ID[inst.player_id];
    if (!meta) continue;
    baseIncome += meta.income;
    nationsCount[meta.nation] = (nationsCount[meta.nation] || 0) + 1;
  }

  const maxSameNation = Math.max(0, ...Object.values(nationsCount));
  const chemMultiplier = maxSameNation > 1 ? 1 + maxSameNation * 0.1 : 1;

  return Math.floor(baseIncome * chemMultiplier);
}

// Применяет офлайн-фарм: сколько SLive накапало с last_update_at по сейчас,
// исходя из ставки фарма ТЕКУЩЕГО состава. Вызывается на каждый запрос,
// который читает или меняет баланс/состав, так что баланс в БД всегда актуален.
function applyOfflineFarm(telegramId) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return null;

  const squad = JSON.parse(user.squad || '{}');
  const instIds = Object.values(squad).filter(Boolean);
  let inventoryByInstId = new Map();
  if (instIds.length) {
    const placeholders = instIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM inventory WHERE inst_id IN (${placeholders})`)
      .all(...instIds);
    inventoryByInstId = new Map(rows.map(r => [r.inst_id, r]));
  }

  const farmRate = computeFarmRate(telegramId, squad, inventoryByInstId); // SLive/сек
  const t = now();
  const deltaSeconds = Math.max(0, (t - user.last_update_at) / 1000);
  const earned = Math.floor(deltaSeconds * farmRate);

  if (earned > 0 || t !== user.last_update_at) {
    db.prepare('UPDATE users SET slive_tokens = slive_tokens + ?, last_update_at = ? WHERE telegram_id = ?')
      .run(earned, t, telegramId);
  }

  return { farmRate, earned };
}

// ---------- public API ----------

export async function ensureUser(telegramId, username = null) {
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (telegram_id, username, tg_stars, slive_tokens, squad, last_update_at, created_at)
       VALUES (?, ?, 0, 1000, '{}', ?, ?)`
    ).run(telegramId, username, now(), now());
  } else if (username && username !== existing.username) {
    db.prepare('UPDATE users SET username = ? WHERE telegram_id = ?').run(username, telegramId);
  }
  return getUser(telegramId);
}

export async function getUser(telegramId) {
  applyOfflineFarm(telegramId);
  const row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!row) return null;

  const myClub = getInventory(telegramId);
  const squad = JSON.parse(row.squad || '{}');
  const squadPower = myClub.reduce((sum, p) => sum + p.rating, 0); // сумма рейтингов ВСЕХ купленных карт
  const inventoryByInstId = new Map(myClub.map(p => [p.instId, { telegram_id: telegramId, player_id: p.id }]));
  const farmRate = computeFarmRate(telegramId, squad, inventoryByInstId);

  return {
    telegramId: row.telegram_id,
    username: row.username,
    tgStars: row.tg_stars,
    sliveTokens: row.slive_tokens,
    squad,
    myClub,
    farmRate,
    squadPower,
  };
}

// ---------- Stars (реальные деньги) ----------

export async function creditStarsFromPayment({ telegramId, amount, paymentChargeId }) {
  // Идемпотентность: telegram_payment_charge_id уникален для каждого платежа.
  const already = db.prepare('SELECT 1 FROM payments WHERE charge_id = ?').get(paymentChargeId);
  if (already) return { ok: true, duplicate: true };

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO payments (charge_id, telegram_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(paymentChargeId, telegramId, amount, now());
    db.prepare('UPDATE users SET tg_stars = tg_stars + ? WHERE telegram_id = ?').run(amount, telegramId);
    db.prepare('INSERT INTO star_ledger (telegram_id, delta, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(telegramId, amount, 'topup:' + paymentChargeId, now());
  });
  tx();
  return { ok: true, duplicate: false };
}

export async function spendStars({ telegramId, amount }) {
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT tg_stars FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user', balance: 0 };
    if (user.tg_stars < amount) return { ok: false, reason: 'insufficient_funds', balance: user.tg_stars };

    db.prepare('UPDATE users SET tg_stars = tg_stars - ? WHERE telegram_id = ?').run(amount, telegramId);
    db.prepare('INSERT INTO star_ledger (telegram_id, delta, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(telegramId, -amount, 'spend', now());
    const updated = db.prepare('SELECT tg_stars FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.tg_stars };
  });
  return tx();
}

// ---------- $SLive (внутриигровая валюта) ----------

export async function spendSlive({ telegramId, amount }) {
  applyOfflineFarm(telegramId); // сначала зачисляем то, что накапало, потом списываем
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user', balance: 0 };
    if (user.slive_tokens < amount) return { ok: false, reason: 'insufficient_funds', balance: user.slive_tokens };

    db.prepare('UPDATE users SET slive_tokens = slive_tokens - ? WHERE telegram_id = ?').run(amount, telegramId);
    const updated = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.slive_tokens };
  });
  return tx();
}

// ---------- Инвентарь / драфт ----------

export function addPlayerToInventory({ telegramId, playerId }) {
  const instId = randomUUID();
  db.prepare('INSERT INTO inventory (inst_id, telegram_id, player_id, acquired_at) VALUES (?, ?, ?, ?)')
    .run(instId, telegramId, playerId, now());
  return { instId, ...PLAYERS_BY_ID[playerId] };
}

// ---------- Состав ----------

export async function saveUserState({ telegramId, patch }) {
  // Сначала фиксируем офлайн-фарм по СТАРОМУ составу, потом уже применяем новый —
  // иначе смена состава задним числом могла бы задним числом поднять ставку фарма.
  applyOfflineFarm(telegramId);

  if (patch.squad) {
    const inventory = getInventory(telegramId);
    const ownedInstIds = new Set(inventory.map(p => p.instId));
    const cleanSquad = {};
    for (const [slot, instId] of Object.entries(patch.squad)) {
      // Игнорируем слоты с картами, которых у игрока на самом деле нет —
      // так клиент не может "телепортировать" в состав чужую/несуществующую карту.
      cleanSquad[slot] = instId && ownedInstIds.has(instId) ? instId : null;
    }
    db.prepare('UPDATE users SET squad = ? WHERE telegram_id = ?').run(JSON.stringify(cleanSquad), telegramId);
  }

  return getUser(telegramId);
}

// ---------- Лидерборд / сила состава ----------

export async function getLeaderboard(limit = 10) {
  const rows = db.prepare('SELECT telegram_id FROM users').all();
  // Прогоняем офлайн-фарм по каждому, чтобы топ был честным на момент запроса.
  for (const r of rows) applyOfflineFarm(r.telegram_id);

  return db
    .prepare('SELECT telegram_id AS telegramId, username, slive_tokens AS balance FROM users ORDER BY slive_tokens DESC LIMIT ?')
    .all(limit);
}

// ---------- Админка ----------

export async function listUsers() {
  const rows = db.prepare('SELECT telegram_id FROM users').all();
  for (const r of rows) applyOfflineFarm(r.telegram_id);
  return db
    .prepare('SELECT telegram_id AS telegramId, username, tg_stars AS tgStars, slive_tokens AS sliveTokens FROM users ORDER BY tg_stars DESC')
    .all();
}

export async function getStats() {
  const { users } = db.prepare('SELECT COUNT(*) AS users FROM users').get();
  const { totalStars } = db.prepare('SELECT COALESCE(SUM(tg_stars),0) AS totalStars FROM users').get();
  const { totalSlive } = db.prepare('SELECT COALESCE(SUM(slive_tokens),0) AS totalSlive FROM users').get();
  const { totalCards } = db.prepare('SELECT COUNT(*) AS totalCards FROM inventory').get();
  const { totalPurchases } = db.prepare('SELECT COUNT(*) AS totalPurchases FROM payments').get();
  return { users, totalStars, totalSlive, totalCards, totalPurchases };
}

export async function adjustStarsAdmin({ telegramId, amount, reason }) {
  const tx = db.transaction(() => {
    ensureUserSync(telegramId);
    db.prepare('UPDATE users SET tg_stars = MAX(0, tg_stars + ?) WHERE telegram_id = ?').run(amount, telegramId);
    db.prepare('INSERT INTO star_ledger (telegram_id, delta, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(telegramId, amount, 'admin:' + (reason || ''), now());
    const updated = db.prepare('SELECT tg_stars FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.tg_stars };
  });
  return tx();
}

function ensureUserSync(telegramId) {
  const existing = db.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (telegram_id, username, tg_stars, slive_tokens, squad, last_update_at, created_at)
       VALUES (?, NULL, 0, 1000, '{}', ?, ?)`
    ).run(telegramId, now(), now());
  }
}

export default db;
