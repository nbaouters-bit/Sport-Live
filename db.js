// db.js
// Вся денежная и игровая экономика живёт только тут (SQLite через better-sqlite3).
// Клиент никогда напрямую не пишет в баланс — только через функции этого файла,
// вызванные из server.js после проверки initData.
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { PLAYERS_BY_ID, getSellPrice } from './players-data.js';

export const DB_PATH = process.env.DB_PATH || 'sportlive.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ВАЖНО: раньше здесь была функция checkpointForBackup(), которая перед
// бэкапом в Telegram форсировала wal_checkpoint(TRUNCATE). Если в проекте
// используется Litestream (см. litestream.yml/start.sh) — так делать нельзя:
// Litestream сам вычитывает WAL-журнал по частям, чтобы стримить изменения
// в R2, а принудительный TRUNCATE обрезает журнал раньше, чем Litestream
// успевает забрать самые свежие записи (это и было причиной пропажи
// недавно созданных ивентов со ставками после редеплоя). Функцию убрали —
// копия файла для Telegram-бэкапа теперь читается как есть, без вмешательства
// в WAL; Litestream остаётся единственным, кто управляет чекпоинтами.

// Награда рефереру за каждого друга, который впервые открыл приложение по его ссылке.
const REFERRAL_REWARD_SLIVE = 1000;
// Курс обмена Telegram Stars -> $SLive (кнопка "Обменять" в плашке пополнения).
// Ориентировался на цену бронзового пака (20 ⭐️ = 500 $SLive = 25 $SLive за 1 ⭐️),
// чтобы обмен не был ни выгоднее, ни хуже покупки паков напрямую за звёзды.
export const STARS_TO_SLIVE_RATE = 25;
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

// ---------- Ставки: константы ----------
const MIN_BET_AMOUNT = 10;
const MAX_BET_AMOUNT = 1_000_000;
const MIN_OPTION_PERCENT = 1;
const MAX_OPTION_PERCENT = 95; // не даём поставить 100% — тогда коэффициент был бы x1, ставка не имела бы смысла

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

  -- Ставки за $SLive (раздел "СТАВКИ") — полностью управляются админом:
  -- он создаёт ивент с вариантами исхода и процентом (шансом) на каждый,
  -- игроки ставят $SLive на вариант, админ подтверждает исход вручную.
  CREATE TABLE IF NOT EXISTS bet_events (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'open', -- open | closed | resolved
    resolved_option_id  TEXT,
    created_at          INTEGER NOT NULL,
    closes_at           INTEGER,
    resolved_at         INTEGER
  );

  -- percent — шанс/вероятность в %, который вручную задаёт админ при
  -- создании ивента (как в Binance/Fanton — процентная полоса на каждый
  -- исход). Коэффициент выплаты считается как 100/percent и ФИКСИРУЕТСЯ
  -- в ставке (bets.multiplier) в момент, когда игрок ставит — так более
  -- поздние ставки или правки процентов админом не задним числом меняют
  -- выплату по уже сделанным ставкам.
  CREATE TABLE IF NOT EXISTS bet_options (
    id           TEXT PRIMARY KEY,
    event_id     TEXT NOT NULL,
    label        TEXT NOT NULL,
    percent      REAL NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_bet_options_event ON bet_options(event_id);

  CREATE TABLE IF NOT EXISTS bets (
    id           TEXT PRIMARY KEY,
    event_id     TEXT NOT NULL,
    option_id    TEXT NOT NULL,
    telegram_id  TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    multiplier   REAL NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | won | lost
    payout       INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bets_event ON bets(event_id);
  CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(telegram_id);
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
// Дробный "хвост" пассивного фарма, который ещё не набежал на целый $SLive
// (см. applyOfflineFarm) — без него дробная часть терялась бы при каждом
// вызове applyOfflineFarm, а он вызывается ОЧЕНЬ часто (на каждый тап,
// каждое действие, и even просто при просмотре списка игроков в админке).
tryAlter('ALTER TABLE users ADD COLUMN slive_farm_remainder REAL NOT NULL DEFAULT 0');
// referral_unlocked: устаревшее поле старой (авто-открывающейся) версии
// рефералки, оставлено ради обратной совместимости со старыми БД, но больше
// не используется — теперь статус хранится в referral_status.
tryAlter('ALTER TABLE users ADD COLUMN referral_unlocked INTEGER NOT NULL DEFAULT 0');
// Новый флоу заявок на рефералку: 'none' | 'pending' | 'approved'.
tryAlter("ALTER TABLE users ADD COLUMN referral_status TEXT NOT NULL DEFAULT 'none'");
// Ссылку сюда вручную вписывает админ при подтверждении заявки (см.
// approveReferralRequest) — не обязательно t.me/bot?startapp=id.
tryAlter('ALTER TABLE users ADD COLUMN referral_link TEXT');
tryAlter('ALTER TABLE users ADD COLUMN referral_requested_at INTEGER');

// Служебная таблица key/value для настроек, которые задаёт админ из панели
// (сейчас — ссылка на канал/чат, на который нужно подписаться перед тем как
// стать рефералом). Не хардкодим в .env, чтобы админ мог менять её на лету,
// не передеплоивая сервер.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
  );
`);

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

const REFERRAL_CHANNEL_LINK_KEY = 'referral_channel_link';

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

// Ставка фарма в SLive/СУТКИ — сумма income карт в составе, с той же бустной
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

  // ВАЖНО: farmRate — это SLive/СУТКИ (см. комментарий в players-data.js и
  // computeFarmRate ниже), а не SLive/секунду. Раньше earned считался как
  // deltaSeconds * farmRate напрямую — то есть карта с income=500/сутки в
  // составе приносила бы 500 SLive КАЖДУЮ секунду (легенду можно было
  // окупить быстрее, чем открывался следующий пак). Здесь мы явно переводим
  // прошедшее время в долю суток, прежде чем умножать на суточную ставку —
  // это единственное место в игре, где начисляется реальный (не визуальный)
  // баланс, поэтому именно тут должна жить правильная единица измерения.
  const farmRate = computeFarmRate(telegramId, squad, inventoryByInstId); // SLive/сутки
  const t = now();
  const deltaSeconds = Math.max(0, (t - user.last_update_at) / 1000);

  // БАГ, который чинит remainder: applyOfflineFarm вызывается на КАЖДЫЙ тап,
  // каждую покупку, каждое открытие вкладки — то есть очень часто, с очень
  // маленькими deltaSeconds между вызовами. Если дробную часть заработанного
  // просто отбрасывать (как было раньше — Math.floor(...) без остатка), то
  // при активной игре почти весь пассивный доход стирается в ноль ещё до
  // того, как накопится хотя бы 1 целый $SLive: заработанное "сгорает"
  // между вызовами, а не копится. Игрок видел рост баланса только за счёт
  // визуального тикера на клиенте — а после ближайшей синхронизации с
  // сервером (раз в 30 сек или после любого действия) баланс откатывался
  // на настоящее, сильно меньшее серверное значение — выглядело так, будто
  // "очки пропадают". Здесь мы явно копим дробный остаток в
  // slive_farm_remainder и переносим его в следующий вызов, а не теряем.
  const rawEarned = (deltaSeconds / 86400) * farmRate + user.slive_farm_remainder;
  const earned = Math.floor(rawEarned);
  const remainder = rawEarned - earned;

  if (earned > 0 || remainder !== user.slive_farm_remainder || t !== user.last_update_at) {
    db.prepare(
      'UPDATE users SET slive_tokens = slive_tokens + ?, slive_farm_remainder = ?, last_update_at = ? WHERE telegram_id = ?'
    ).run(earned, remainder, t, telegramId);
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

// Обмен Telegram Stars -> $SLive по фиксированному курсу STARS_TO_SLIVE_RATE.
// Обратного обмена ($SLive -> Stars, вывод) пока НЕТ — кнопка "Обменять" в
// блоке "Вывод" на клиенте намеренно задизейблена ("Скоро"), здесь для неё
// сознательно нет функции, чтобы не создавать видимость рабочего API.
export async function exchangeStarsToSlive({ telegramId, starsAmount }) {
  const numStars = Math.floor(Number(starsAmount));
  if (!Number.isFinite(numStars) || numStars <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  applyOfflineFarm(telegramId); // фиксируем накапавшее ДО того, как баланс поменяется от обмена

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT tg_stars, slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user' };
    if (user.tg_stars < numStars) return { ok: false, reason: 'insufficient_funds', balance: user.tg_stars };

    const gained = numStars * STARS_TO_SLIVE_RATE;
    db.prepare('UPDATE users SET tg_stars = tg_stars - ?, slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
      .run(numStars, gained, telegramId);
    db.prepare('INSERT INTO star_ledger (telegram_id, delta, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(telegramId, -numStars, 'exchange_to_slive', now());

    const updated = db.prepare('SELECT tg_stars, slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, starsBalance: updated.tg_stars, sliveBalance: updated.slive_tokens, gained };
  });

  return tx();
}

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
// Флоу теперь трёхстадийный:
//   none     — игрок ещё не запрашивал ссылку (видит канал для подписки + кнопку запроса)
//   pending  — запрос отправлен, ждёт подтверждения админом ("Ожидай подтверждения")
//   approved — админ вставил ссылку и подтвердил, игрок видит её (и получает уведомление от бота)
// referral_link — САМА ссылка, которую вручную вписывает админ при подтверждении
// (см. approveReferralRequest) — это НЕ обязательно t.me/bot?startapp=id,
// админ может вписать любую нужную ссылку.

export async function getReferralInfo(telegramId) {
  const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE referred_by = ?').get(telegramId);
  const user = db
    .prepare('SELECT referral_status, referral_link FROM users WHERE telegram_id = ?')
    .get(telegramId);
  return {
    invited: cnt,
    rewardPerFriend: REFERRAL_REWARD_SLIVE,
    status: user?.referral_status || 'none',
    link: user?.referral_status === 'approved' ? (user.referral_link || null) : null,
    channelLink: getSetting(REFERRAL_CHANNEL_LINK_KEY) || null,
  };
}

// Игрок отправляет заявку на получение реферальной ссылки (обычно после
// того, как подписался на канал из channelLink). Переводит статус в
// 'pending' — саму ссылку выдаёт только админ через approveReferralRequest.
// Идемпотентно: повторный запрос уже одобренной заявки ничего не ломает.
export async function requestReferralAccess(telegramId) {
  const existing = db.prepare('SELECT referral_status FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) return { ok: false, reason: 'no_user' };
  if (existing.referral_status === 'approved') return { ok: true, status: 'approved' };
  if (existing.referral_status === 'pending') return { ok: true, status: 'pending' };

  db.prepare('UPDATE users SET referral_status = ?, referral_requested_at = ? WHERE telegram_id = ?')
    .run('pending', now(), telegramId);
  return { ok: true, status: 'pending' };
}

// ---------- Админка: заявки на рефералку ----------

// Список заявок, ожидающих подтверждения — показывается в админ-панели.
export async function getPendingReferralRequests() {
  return db
    .prepare(
      `SELECT telegram_id AS telegramId, username, referral_requested_at AS requestedAt
       FROM users
       WHERE referral_status = 'pending'
       ORDER BY referral_requested_at ASC`
    )
    .all();
}

// Админ вписывает ссылку и подтверждает заявку — только после этого у игрока
// в интерфейсе появляется ссылка (см. server.js: после успешного вызова этой
// функции сервер ещё и шлёт игроку уведомление ботом).
export async function approveReferralRequest({ telegramId, link }) {
  const user = db.prepare('SELECT referral_status FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return { ok: false, reason: 'no_user' };
  if (user.referral_status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (!link) return { ok: false, reason: 'invalid_link' };

  db.prepare('UPDATE users SET referral_status = ?, referral_link = ? WHERE telegram_id = ?')
    .run('approved', link, telegramId);
  return { ok: true };
}

// Отклонить заявку — статус возвращается в 'none', игрок может запросить снова.
export async function rejectReferralRequest(telegramId) {
  const user = db.prepare('SELECT referral_status FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return { ok: false, reason: 'no_user' };
  db.prepare('UPDATE users SET referral_status = ? WHERE telegram_id = ?').run('none', telegramId);
  return { ok: true };
}

// ---------- Настройки (админка) ----------

export async function getReferralChannelLink() {
  return getSetting(REFERRAL_CHANNEL_LINK_KEY) || null;
}

export async function setReferralChannelLink(link) {
  setSetting(REFERRAL_CHANNEL_LINK_KEY, link || '');
  return { ok: true, link: link || '' };
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

// "База игроков" для админки — не просто баланс, а полный прогресс каждого:
// пассивный доход состава (farmRate), сила всего клуба (сумма рейтингов ВСЕХ
// купленных карт, как в getUser) и разбивка инвентаря по редкости. offline-farm
// применяется через тот же remainder-safe applyOfflineFarm, что и везде —
// значит открытие этого списка больше не может "съесть" дробный прогресс
// игроков (см. slive_farm_remainder).
export async function listUsers() {
  const rows = db.prepare('SELECT telegram_id FROM users').all();
  for (const r of rows) {
    applyOfflineFarm(r.telegram_id);
    refreshEnergyIfNeeded(r.telegram_id);
  }

  const baseRows = db
    .prepare(
      `SELECT u.telegram_id AS telegramId, u.username, u.tg_stars AS tgStars, u.slive_tokens AS sliveTokens,
              u.is_vip AS isVip, u.energy AS energy, u.squad AS squadJson,
              (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.telegram_id) AS invited
       FROM users u ORDER BY u.tg_stars DESC`
    )
    .all();

  return baseRows.map(u => {
    const inventory = getInventory(u.telegramId);
    const squad = JSON.parse(u.squadJson || '{}');
    const inventoryByInstId = new Map(inventory.map(p => [p.instId, { telegram_id: u.telegramId, player_id: p.id }]));
    const farmRate = computeFarmRate(u.telegramId, squad, inventoryByInstId); // SLive/сутки
    const clubPower = inventory.reduce((sum, p) => sum + p.rating, 0);
    const rarityCounts = inventory.reduce((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    }, {});

    return {
      telegramId: u.telegramId,
      username: u.username,
      tgStars: u.tgStars,
      sliveTokens: u.sliveTokens,
      isVip: Boolean(u.isVip),
      energy: u.energy,
      invited: u.invited,
      farmRate,
      clubPower,
      cardsTotal: inventory.length,
      rarityCounts,
    };
  });
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

// ---------- Ставки за $SLive ----------
// Полностью управляются админом: он создаёт ивент с 2+ вариантами исхода,
// на каждый вариант вручную задаёт процент (шанс) — как полосы в
// Binance/Fanton. Игроки ставят $SLive на понравившийся вариант, коэффициент
// выплаты (100/percent) фиксируется в bets.multiplier в момент ставки.
// Когда ивент реально заканчивается, админ вручную выбирает исход — деньги
// проигравших НЕ возвращаются (они уже списаны в момент ставки), победители
// получают amount * multiplier.

function rowToBetEvent(eventRow, optionRows, poolByOption) {
  const totalPool = optionRows.reduce((sum, o) => sum + (poolByOption.get(o.id)?.total || 0), 0);
  return {
    id: eventRow.id,
    title: eventRow.title,
    description: eventRow.description,
    status: eventRow.status,
    resolvedOptionId: eventRow.resolved_option_id,
    createdAt: eventRow.created_at,
    closesAt: eventRow.closes_at,
    resolvedAt: eventRow.resolved_at,
    totalPool,
    options: optionRows.map(o => ({
      id: o.id,
      label: o.label,
      percent: o.percent,
      multiplier: Math.round((100 / o.percent) * 100) / 100,
      pool: poolByOption.get(o.id)?.total || 0,
      betsCount: poolByOption.get(o.id)?.count || 0,
    })),
  };
}

function getBetEventFull(eventId) {
  const eventRow = db.prepare('SELECT * FROM bet_events WHERE id = ?').get(eventId);
  if (!eventRow) return null;
  const optionRows = db
    .prepare('SELECT * FROM bet_options WHERE event_id = ? ORDER BY sort_order ASC')
    .all(eventId);
  const poolRows = db
    .prepare('SELECT option_id, SUM(amount) AS total, COUNT(*) AS count FROM bets WHERE event_id = ? GROUP BY option_id')
    .all(eventId);
  const poolByOption = new Map(poolRows.map(r => [r.option_id, r]));
  return rowToBetEvent(eventRow, optionRows, poolByOption);
}

// ---------- Админка: создание/управление ивентами ----------

// options: [{ label, percent }, ...] — минимум 2 варианта, percent у каждого
// в диапазоне (MIN_OPTION_PERCENT..MAX_OPTION_PERCENT].
export async function createBetEvent({ title, description, options, closesAt }) {
  if (!title || !Array.isArray(options) || options.length < 2) {
    return { ok: false, reason: 'invalid_input' };
  }
  for (const opt of options) {
    if (!opt.label || typeof opt.percent !== 'number') return { ok: false, reason: 'invalid_option' };
    if (opt.percent < MIN_OPTION_PERCENT || opt.percent > MAX_OPTION_PERCENT) {
      return { ok: false, reason: 'invalid_percent' };
    }
  }

  const eventId = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO bet_events (id, title, description, status, created_at, closes_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).run(eventId, title, description || null, now(), closesAt || null);

    options.forEach((opt, i) => {
      db.prepare(
        `INSERT INTO bet_options (id, event_id, label, percent, sort_order) VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), eventId, opt.label, opt.percent, i);
    });
  });
  tx();

  return { ok: true, event: getBetEventFull(eventId) };
}

// Живое изменение кэфа админом: правит percent конкретного варианта у
// ОТКРЫТОГО ивента. Это безопасно для уже сделанных ставок — их multiplier
// зафиксирован в момент ставки (см. placeBet) и не пересчитывается задним
// числом. Новый percent действует только для ставок, сделанных ПОСЛЕ правки.
// Нельзя менять кэф у закрытого/подтверждённого ивента — там ставки уже не
// принимаются либо итог уже подведён.
export async function updateBetOptionPercent({ eventId, optionId, percent }) {
  const numPercent = Number(percent);
  if (!Number.isFinite(numPercent) || numPercent < MIN_OPTION_PERCENT || numPercent > MAX_OPTION_PERCENT) {
    return { ok: false, reason: 'invalid_percent' };
  }

  const event = db.prepare('SELECT * FROM bet_events WHERE id = ?').get(eventId);
  if (!event) return { ok: false, reason: 'no_event' };
  if (event.status !== 'open') return { ok: false, reason: 'event_not_open' };

  const option = db.prepare('SELECT * FROM bet_options WHERE id = ? AND event_id = ?').get(optionId, eventId);
  if (!option) return { ok: false, reason: 'invalid_option' };

  db.prepare('UPDATE bet_options SET percent = ? WHERE id = ?').run(numPercent, optionId);
  return { ok: true, event: getBetEventFull(eventId) };
}

// Останавливает приём новых ставок, не подводя итог — используется, если
// админу нужно "заморозить" ивент перед тем, как объявить исход.
export async function closeBetEvent(eventId) {
  const event = db.prepare('SELECT status FROM bet_events WHERE id = ?').get(eventId);
  if (!event) return { ok: false, reason: 'no_event' };
  if (event.status === 'resolved') return { ok: false, reason: 'already_resolved' };
  db.prepare("UPDATE bet_events SET status = 'closed' WHERE id = ?").run(eventId);
  return { ok: true, event: getBetEventFull(eventId) };
}

// Подтверждение исхода. Возвращает список победителей (telegramId + payout),
// чтобы server.js разослал уведомления ботом.
export async function resolveBetEvent({ eventId, winningOptionId }) {
  const event = db.prepare('SELECT * FROM bet_events WHERE id = ?').get(eventId);
  if (!event) return { ok: false, reason: 'no_event' };
  if (event.status === 'resolved') return { ok: false, reason: 'already_resolved' };

  const option = db.prepare('SELECT * FROM bet_options WHERE id = ? AND event_id = ?').get(winningOptionId, eventId);
  if (!option) return { ok: false, reason: 'invalid_option' };

  const winners = [];
  const tx = db.transaction(() => {
    const allBets = db.prepare('SELECT * FROM bets WHERE event_id = ?').all(eventId);
    for (const bet of allBets) {
      if (bet.option_id === winningOptionId) {
        const payout = Math.floor(bet.amount * bet.multiplier);
        db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(payout, bet.id);
        db.prepare('UPDATE users SET slive_tokens = slive_tokens + ? WHERE telegram_id = ?')
          .run(payout, bet.telegram_id);
        winners.push({ telegramId: bet.telegram_id, payout, amount: bet.amount });
      } else {
        db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(bet.id);
      }
    }
    db.prepare(
      "UPDATE bet_events SET status = 'resolved', resolved_option_id = ?, resolved_at = ? WHERE id = ?"
    ).run(winningOptionId, now(), eventId);
  });
  tx();

  return { ok: true, event: getBetEventFull(eventId), winningLabel: option.label, winners };
}

// Список ВСЕХ ивентов (любого статуса) для админ-панели, свежие сверху.
export async function getAdminBetEvents() {
  const rows = db.prepare('SELECT id FROM bet_events ORDER BY created_at DESC').all();
  return rows.map(r => getBetEventFull(r.id));
}

// ---------- Игрок: просмотр ивентов и ставки ----------

// Открытые (можно ставить) + недавно завершённые (последние 10, чтобы видеть
// исход) — закрытые-без-резолва тоже показываем как "приём ставок окончен".
export async function getVisibleBetEvents() {
  const openIds = db.prepare("SELECT id FROM bet_events WHERE status IN ('open','closed') ORDER BY created_at DESC").all();
  const resolvedIds = db
    .prepare("SELECT id FROM bet_events WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 10")
    .all();
  return [...openIds, ...resolvedIds].map(r => getBetEventFull(r.id));
}

export async function placeBet({ telegramId, eventId, optionId, amount }) {
  const numAmount = Math.floor(Number(amount));
  if (!Number.isFinite(numAmount) || numAmount < MIN_BET_AMOUNT || numAmount > MAX_BET_AMOUNT) {
    return { ok: false, reason: 'invalid_amount' };
  }

  // Фиксируем то, что накапало от пассивного фарма, ПЕРЕД тем как списывать
  // ставку — иначе можно было бы поставить на несуществующий ещё баланс.
  applyOfflineFarm(telegramId);

  const tx = db.transaction(() => {
    const event = db.prepare('SELECT * FROM bet_events WHERE id = ?').get(eventId);
    if (!event) return { ok: false, reason: 'no_event' };
    if (event.status !== 'open') return { ok: false, reason: 'betting_closed' };

    const option = db.prepare('SELECT * FROM bet_options WHERE id = ? AND event_id = ?').get(optionId, eventId);
    if (!option) return { ok: false, reason: 'invalid_option' };

    const user = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, reason: 'no_user' };
    if (user.slive_tokens < numAmount) return { ok: false, reason: 'insufficient_funds', balance: user.slive_tokens };

    const multiplier = Math.round((100 / option.percent) * 100) / 100;
    const betId = randomUUID();
    db.prepare(
      `INSERT INTO bets (id, event_id, option_id, telegram_id, amount, multiplier, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(betId, eventId, optionId, telegramId, numAmount, multiplier, now());
    db.prepare('UPDATE users SET slive_tokens = slive_tokens - ? WHERE telegram_id = ?').run(numAmount, telegramId);

    const updatedUser = db.prepare('SELECT slive_tokens FROM users WHERE telegram_id = ?').get(telegramId);
    return { ok: true, balance: updatedUser.slive_tokens, betId, multiplier };
  });

  const result = tx();
  if (!result.ok) return result;
  return { ...result, event: getBetEventFull(eventId) };
}

// История ставок игрока (последние 30), с названием ивента/варианта — для
// вкладки "Мои ставки".
export async function getMyBets(telegramId) {
  const rows = db
    .prepare(
      `SELECT b.id, b.amount, b.multiplier, b.status, b.payout, b.created_at AS createdAt,
              e.title AS eventTitle, e.status AS eventStatus,
              o.label AS optionLabel
       FROM bets b
       JOIN bet_events e ON e.id = b.event_id
       JOIN bet_options o ON o.id = b.option_id
       WHERE b.telegram_id = ?
       ORDER BY b.created_at DESC
       LIMIT 30`
    )
    .all(telegramId);
  return rows;
}

export default db;

