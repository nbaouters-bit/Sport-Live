  // db.js
// Вся денежная и игровая экономика живёт только тут (SQLite через better-sqlite3).
// Клиент никогда напрямую не пишет в баланс — только через функции этого файла,
// вызванные из server.js после проверки initData.
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { PLAYERS_BY_ID, getSellPrice } from './players-data.js';

const db = new Database(process.env.DB_PATH || 'sportlive.db');
db.pragma('journal_mode = WAL');

// Награда рефереру за каждого друга, который впервые открыл приложение по его ссылке.
const REFERRAL_REWARD_SLIVE = 1000;
// Максимум энергии в сутки (см. refreshEnergyIfNeeded) — 1 клик = 1 единица энергии.
const DAILY_ENERGY = 1000;
// Не даём одним запросом /api/tap списать больше, чем можно нафармить за
// разумное окно (защита от руками собранного запроса с гигантским count).
const MAX_TAP_PER_REQUEST = 50;

// ---------- Драфт: константы наград/очков ----------
// Награда $SLive за одну победу в PvP-бою драфта.
const DRAFT_WIN_REWARD_SLIVE = 300;
// Очки в лидерборд драфта за победу — копятся весь "карьерный" срок игрока,
// не обнуляются между сериями (обнуляется только wins текущей серии).
const DRAFT_WIN_POINTS = 3;
// Шкала ELO-подобной формулы шанса победы: чем МЕНЬШЕ значение, тем сильнее
// разница в рейтинге решает исход (меньше шансов на апсет). При равных
// рейтингах шанс всегда 50/50.
const DRAFT_ELO_SCALE = 12;
// Ежедневная награда игроку №1 в лидерборде драфта (по total_points).
const DRAFT_TOP_REWARD_SLIVE = 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id     TEXT PRIMARY KEY,
    username        TEXT,
    tg_stars        INTEGER NOT NULL DEFAULT 0,
    slive_tokens    INTEGER NOT NULL DEFAULT 1000,
    squad           TEXT NOT NULL DEFAULT '{}',
    is_vip          INTEGER NOT NULL DEFAULT 0,
    energy          INTEGER NOT NULL DEFAULT 1000,
    energy_day      INTEGER NOT NULL DEFAULT 0,
    referred_by     TEXT,
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

  -- Драфт: отдельный от основного Клуба состав из 5 карт. Не пересекается с
  -- inventory/squad — карты драфта нельзя поставить в обычный состав или продать.
  CREATE TABLE IF NOT EXISTS draft_squads (
    telegram_id          TEXT PRIMARY KEY,
    players              TEXT NOT NULL,             -- JSON-массив из 5 id игроков (players-data.js)
    rating               INTEGER NOT NULL,           -- сумма OVR состава
    active               INTEGER NOT NULL DEFAULT 1, -- 0 = серия закончена (было поражение), нужен новый вход
    wins                 INTEGER NOT NULL DEFAULT 0, -- побед в ТЕКУЩЕЙ серии (обнуляется при новом входе)
    total_points         INTEGER NOT NULL DEFAULT 0, -- очки лидерборда — накопительно, никогда не обнуляются
    last_free_entry_day  INTEGER NOT NULL DEFAULT -1,-- dayIndex() последнего входа ЗА $SLIVE (для лимита 1/сутки)
    drafted_at           INTEGER NOT NULL
  );

  -- Служебная таблица из одной строки — отслеживает, за какие сутки уже
  -- выплачена ежедневная награда лидеру драфт-рейтинга (чтобы не задвоить
  -- выплату при перезапуске сервера или при нескольких проверках подряд).
  CREATE TABLE IF NOT EXISTS draft_meta (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    last_payout_day   INTEGER NOT NULL DEFAULT -1
  );
`);
db.prepare('INSERT OR IGNORE INTO draft_meta (id, last_payout_day) VALUES (1, -1)').run();

// Миграция для БД, созданных до появления VIP/энергии/рефералки —
// ALTER TABLE ADD COLUMN не поддерживает IF NOT EXISTS, поэтому просто
// глушим ошибку "duplicate column name", если колонка уже есть.
function tryAlter(sql) {
  try {
    db.exec(sql);
  } catch (e) {
    if (!String(e.message).includes('duplicate column name')) throw e;
  }
}
tryAlter('ALTER TABLE users ADD COLUMN is_vip INTEGER NOT NULL DEFAULT 0');
tryAlter('ALTER TABLE users ADD COLUMN energy INTEGER NOT NULL DEFAULT 1000');
tryAlter('ALTER TABLE users ADD COLUMN energy_day INTEGER NOT NULL DEFAULT 0');
tryAlter('ALTER TABLE users ADD COLUMN referred_by TEXT');

// ---------- helpers ----------

function now() {
  return Date.now();
}

// Номер календарных суток (UTC) — используется, чтобы понять, наступил ли
// новый день и пора ли выдать игроку свежие 1000 энергии.
function dayIndex(ts = now()) {
  return Math.floor(ts / 86400000);
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

// Если наступили новые сутки (по UTC) — обнуляем энергию до DAILY_ENERGY.
// Вызывается на каждый запрос, который читает энергию, так что не важно,
// когда именно игрок зайдёт в течение дня — лимит применится один раз в сутки.
function refreshEnergyIfNeeded(telegramId) {
  const user = db.prepare('SELECT energy, energy_day FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return;
  const today = dayIndex();
  if (user.energy_day !== today) {
    db.prepare('UPDATE users SET energy = ?, energy_day = ? WHERE telegram_id = ?').run(DAILY_ENERGY, today, telegramId);
  }
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

// referrerId — telegram_id пригласившего (из start_param мини-аппы). Награда
// начисляется рефереру только один раз, в момент ПЕРВОГО создания записи
// приглашённого — переписать referred_by задним числом нельзя.
export async function ensureUser(telegramId, username = null, referrerId = null) {
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    const referrerRow = referrerId && referrerId !== telegramId
      ? db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').get(referrerId)
      : null;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (telegram_id, username, tg_stars, slive_tokens, squad, is_vip, energy, energy_day, referred_by, last_update_at, created_at)
         VALUES (?, ?, 0, 1000, '{}', 0, ?, ?, ?, ?, ?)`
      ).run(telegramId, username, DAILY_ENERGY, dayIndex(), referrerRow ? referrerId : null, now(), now());

      if (referrerRow) {
        db.prepare('UPDATE users SET slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
          .run(REFERRAL_REWARD_SLIVE, referrerId);
      }
    });
    tx();
  } else if (username && username !== existing.username) {
    db.prepare('UPDATE users SET username = ? WHERE telegram_id = ?').run(username, telegramId);
  }
  return getUser(telegramId);
}

export async function getUser(telegramId) {
  applyOfflineFarm(telegramId);
  refreshEnergyIfNeeded(telegramId);
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
    isVip: Boolean(row.is_vip),
    energy: row.energy,
    dailyEnergy: DAILY_ENERGY,
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

// ---------- Тапалка (1 клик = 1 энергия = 1 $SLive) ----------
// Прогресс кликов теперь считается и хранится на сервере, а не только в
// localStorage браузера — клиент присылает пачку накопленных тапов
// (см. flushTaps() в index.html), сервер сам проверяет остаток энергии на
// сегодня и не даст списать больше, чем реально есть.
export async function tap({ telegramId, count = 1 }) {
  applyOfflineFarm(telegramId);
  refreshEnergyIfNeeded(telegramId);

  const safeCount = Math.max(1, Math.min(MAX_TAP_PER_REQUEST, Math.floor(Number(count)) || 1));

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT energy, slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user', energy: 0, balance: 0 };

    const spend = Math.min(safeCount, user.energy);
    if (spend <= 0) {
      return { ok: false, reason: 'no_energy', energy: user.energy, balance: user.slive_tokens };
    }

    db.prepare('UPDATE users SET energy = energy - ?, slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
      .run(spend, spend, telegramId);
    const updated = db.prepare('SELECT energy, slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, gained: spend, energy: updated.energy, balance: updated.slive_tokens };
  });
  return tx();
}

// ---------- VIP-статус (разовая покупка за Stars) ----------

export async function buyVip({ telegramId, amount }) {
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT tg_stars, is_vip FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user', balance: 0 };
    if (user.is_vip) return { ok: false, reason: 'already_vip', balance: user.tg_stars };
    if (user.tg_stars < amount) return { ok: false, reason: 'insufficient_funds', balance: user.tg_stars };

    db.prepare('UPDATE users SET tg_stars = tg_stars - ?, is_vip = 1 WHERE telegram_id = ?').run(amount, telegramId);
    db.prepare('INSERT INTO star_ledger (telegram_id, delta, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(telegramId, -amount, 'vip_purchase', now());
    const updated = db.prepare('SELECT tg_stars FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.tg_stars };
  });
  return tx();
}

// ---------- Рефералка ----------

export async function getReferralInfo(telegramId) {
  const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE referred_by = ?').get(telegramId);
  return { invited: cnt, rewardPerFriend: REFERRAL_REWARD_SLIVE };
}

// ---------- Инвентарь / драфт ----------

export function addPlayerToInventory({ telegramId, playerId }) {
  const instId = randomUUID();
  db.prepare('INSERT INTO inventory (inst_id, telegram_id, player_id, acquired_at) VALUES (?, ?, ?, ?)')
    .run(instId, telegramId, playerId, now());
  return { instId, ...PLAYERS_BY_ID[playerId] };
}

// Продажа ЛИШНЕЙ (дублирующейся) карты за фиксированную долю цены Маркета
// (см. SELL_RATE/getSellPrice в players-data.js). Все проверки — только тут,
// на сервере, клиент (sellDuplicate в index.html) их не может обойти:
//   - not_owned      — карта не найдена в инвентаре ИМЕННО этого игрока
//   - card_equipped  — карта прямо сейчас стоит в составе (squad), продавать нельзя
//   - last_copy      — это единственный экземпляр игрока, продавать нельзя
export async function sellCard({ telegramId, instId }) {
  applyOfflineFarm(telegramId); // сначала фиксируем то, что накапало, потом уже меняем баланс

  const tx = db.transaction(() => {
    const inst = db.prepare('SELECT * FROM inventory WHERE inst_id = ?').get(instId);
    if (!inst || inst.telegram_id !== telegramId) return { ok: false, reason: 'not_owned' };

    const user = db.prepare('SELECT squad FROM users WHERE telegram_id = ?').get(telegramId);
    const squad = JSON.parse(user?.squad || '{}');
    const isEquipped = Object.values(squad).some(slotInstId => slotInstId === instId);
    if (isEquipped) return { ok: false, reason: 'card_equipped' };

    const { copies } = db
      .prepare('SELECT COUNT(*) AS copies FROM inventory WHERE telegram_id = ? AND player_id = ?')
      .get(telegramId, inst.player_id);
    if (copies <= 1) return { ok: false, reason: 'last_copy' };

    const gained = getSellPrice(inst.player_id);
    db.prepare('DELETE FROM inventory WHERE inst_id = ?').run(instId);
    db.prepare('UPDATE users SET slive_tokens = slive_tokens + ? WHERE telegram_id = ?').run(gained, telegramId);

    const updated = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.slive_tokens, gained };
  });

  return tx();
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
    .prepare(
      `SELECT telegram_id AS telegramId, username, slive_tokens AS balance, is_vip AS isVip
       FROM users ORDER BY slive_tokens DESC LIMIT ?`
    )
    .all(limit)
    .map(r => ({ ...r, isVip: Boolean(r.isVip) }));
}

// ---------- Админка ----------

export async function listUsers() {
  const rows = db.prepare('SELECT telegram_id FROM users').all();
  for (const r of rows) {
    applyOfflineFarm(r.telegram_id);
    refreshEnergyIfNeeded(r.telegram_id);
  }
  return db
    .prepare(
      `SELECT u.telegram_id AS telegramId, u.username, u.tg_stars AS tgStars, u.slive_tokens AS sliveTokens,
              u.is_vip AS isVip, u.energy AS energy,
              (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.telegram_id) AS invited
       FROM users u ORDER BY u.tg_stars DESC`
    )
    .all()
    .map(u => ({ ...u, isVip: Boolean(u.isVip) }));
}

export async function getStats() {
  const { totalUsers } = db.prepare('SELECT COUNT(*) AS totalUsers FROM users').get();
  const { totalStarsBalance } = db.prepare('SELECT COALESCE(SUM(tg_stars),0) AS totalStarsBalance FROM users').get();
  const { totalSliveBalance } = db.prepare('SELECT COALESCE(SUM(slive_tokens),0) AS totalSliveBalance FROM users').get();
  const { vipUsers } = db.prepare('SELECT COUNT(*) AS vipUsers FROM users WHERE is_vip = 1').get();
  const { totalPaymentsCount } = db.prepare('SELECT COUNT(*) AS totalPaymentsCount FROM payments').get();
  return { totalUsers, totalStarsBalance, totalSliveBalance, vipUsers, totalPaymentsCount };
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

export async function adjustSliveAdmin({ telegramId, amount, reason }) {
  const tx = db.transaction(() => {
    ensureUserSync(telegramId);
    applyOfflineFarm(telegramId);
    db.prepare('UPDATE users SET slive_tokens = MAX(0, slive_tokens + ?) WHERE telegram_id = ?').run(amount, telegramId);
    const updated = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updated.slive_tokens, reason };
  });
  return tx();
}

function ensureUserSync(telegramId) {
  const existing = db.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (telegram_id, username, tg_stars, slive_tokens, squad, is_vip, energy, energy_day, referred_by, last_update_at, created_at)
       VALUES (?, NULL, 0, 1000, '{}', 0, ?, ?, NULL, ?, ?)`
    ).run(telegramId, DAILY_ENERGY, dayIndex(), now(), now());
  }
}

// ---------- Драфт (отдельный PvP-режим: 5 случайных карт + бои) ----------

function rowToDraftSquad(row) {
  if (!row) return null;
  const playerIds = JSON.parse(row.players || '[]');
  const players = playerIds.map(id => PLAYERS_BY_ID[id]).filter(Boolean);
  return {
    players,
    rating: row.rating,
    active: Boolean(row.active),
    wins: row.wins,
    totalPoints: row.total_points,
    draftedAt: row.drafted_at,
  };
}

// Бесплатный (за $SLive) вход разрешён только РАЗ В СУТКИ — проверяем это
// здесь, а не на клиенте, иначе игрок мог бы просто не показывать таймер.
export async function canUseFreeDraftEntry(telegramId) {
  const row = db.prepare('SELECT last_free_entry_day FROM draft_squads WHERE telegram_id = ?').get(telegramId);
  if (!row) return true;
  return row.last_free_entry_day !== dayIndex();
}

export async function getDraftState(telegramId) {
  const row = db.prepare('SELECT * FROM draft_squads WHERE telegram_id = ?').get(telegramId);
  const canFreeEntry = !row || row.last_free_entry_day !== dayIndex();
  return { squad: rowToDraftSquad(row), canFreeEntry };
}

// currency: 'slive' (лимит 1/сутки, проверяется снаружи через canUseFreeDraftEntry
// ДО списания денег) или 'stars' (без лимита). Каждый новый вход полностью
// заменяет предыдущий состав драфта и обнуляет wins/active текущей серии —
// total_points (лидерборд) при этом НЕ трогаем, он накопительный.
export async function startDraft({ telegramId, playerIds, currency }) {
  const rating = playerIds.reduce((sum, id) => sum + (PLAYERS_BY_ID[id]?.rating || 0), 0);
  const today = dayIndex();
  const freeEntryValueForInsert = currency === 'slive' ? today : -1;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO draft_squads (telegram_id, players, rating, active, wins, total_points, last_free_entry_day, drafted_at)
       VALUES (?, ?, ?, 1, 0, 0, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         players = excluded.players,
         rating = excluded.rating,
         active = 1,
         wins = 0,
         last_free_entry_day = CASE WHEN ? = 'slive' THEN ? ELSE draft_squads.last_free_entry_day END,
         drafted_at = excluded.drafted_at`
    ).run(telegramId, JSON.stringify(playerIds), rating, freeEntryValueForInsert, now(), currency, today);
  });
  tx();

  const row = db.prepare('SELECT * FROM draft_squads WHERE telegram_id = ?').get(telegramId);
  return { squad: rowToDraftSquad(row) };
}

// PvP-бой: соперник — случайный игрок с готовым драфт-составом (не обязательно
// "активным" — можно атаковать даже того, чья серия уже закончилась, у него
// всё равно есть сохранённый rating). Победа определяется рейтингом + шансом
// на апсет (логистическая формула по шкале DRAFT_ELO_SCALE). Поражение сразу
// завершает СЕРИЮ атакующего (active = 0) — новый бой потребует новый вход.
// На соперника-защитника результат боя не влияет (асинхронный PvP).
export async function playDraftBattle({ telegramId }) {
  const attackerRow = db.prepare('SELECT * FROM draft_squads WHERE telegram_id = ?').get(telegramId);
  if (!attackerRow) return { ok: false, reason: 'no_draft_squad' };
  if (!attackerRow.active) return { ok: false, reason: 'draft_ended' };

  const opponentRow = db
    .prepare('SELECT * FROM draft_squads WHERE telegram_id != ? ORDER BY RANDOM() LIMIT 1')
    .get(telegramId);
  if (!opponentRow) return { ok: false, reason: 'no_opponents' };

  const attackerRating = attackerRow.rating;
  const defenderRating = opponentRow.rating;
  const winProb = 1 / (1 + Math.pow(10, (defenderRating - attackerRating) / DRAFT_ELO_SCALE));
  const won = Math.random() < winProb;

  const opponentUser = db.prepare('SELECT username FROM users WHERE telegram_id = ?').get(opponentRow.telegram_id);

  const tx = db.transaction(() => {
    if (won) {
      db.prepare('UPDATE draft_squads SET wins = wins + 1, total_points = total_points + ? WHERE telegram_id = ?')
        .run(DRAFT_WIN_POINTS, telegramId);
      db.prepare('UPDATE users SET slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
        .run(DRAFT_WIN_REWARD_SLIVE, telegramId);
    } else {
      db.prepare('UPDATE draft_squads SET active = 0 WHERE telegram_id = ?').run(telegramId);
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM draft_squads WHERE telegram_id = ?').get(telegramId);

  return {
    ok: true,
    won,
    attackerRating,
    defenderRating,
    reward: won ? DRAFT_WIN_REWARD_SLIVE : 0,
    pointsGained: won ? DRAFT_WIN_POINTS : 0,
    opponent: { username: opponentUser?.username || null, rating: defenderRating },
    squad: rowToDraftSquad(updated),
  };
}

export async function getDraftLeaderboard(limit = 10) {
  return db
    .prepare(
      `SELECT ds.telegram_id AS telegramId, u.username, ds.rating, ds.wins,
              ds.total_points AS totalPoints, ds.active
       FROM draft_squads ds
       JOIN users u ON u.telegram_id = ds.telegram_id
       ORDER BY ds.total_points DESC, ds.wins DESC, ds.rating DESC
       LIMIT ?`
    )
    .all(limit)
    .map(r => ({ ...r, active: Boolean(r.active) }));
}

// Раз в календарные сутки (UTC) начисляет 1000 $SLive лидеру драфт-рейтинга
// (по total_points). Идемпотентно: draft_meta.last_payout_day гарантирует,
// что при повторном вызове в те же сутки (или после рестарта сервера)
// выплата не задвоится. Вызывается по таймеру из server.js, а не от
// конкретного запроса игрока — так награда не зависит от того, зайдёт ли
// вообще кто-то в лидерборд в этот день.
export async function payoutDraftTopIfNeeded() {
  const today = dayIndex();
  const meta = db.prepare('SELECT last_payout_day FROM draft_meta WHERE id = 1').get();
  if (meta && meta.last_payout_day === today) return null;

  const top = db
    .prepare('SELECT telegram_id, total_points FROM draft_squads WHERE total_points > 0 ORDER BY total_points DESC, wins DESC LIMIT 1')
    .get();

  const tx = db.transaction(() => {
    db.prepare('UPDATE draft_meta SET last_payout_day = ? WHERE id = 1').run(today);
    if (top) {
      db.prepare('UPDATE users SET slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
        .run(DRAFT_TOP_REWARD_SLIVE, top.telegram_id);
    }
  });
  tx();

  return top ? { telegramId: top.telegram_id, reward: DRAFT_TOP_REWARD_SLIVE } : null;
}

export default db;
