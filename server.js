// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { validateInitData } from './telegramAuth.js';
import {
  ensureUser,
  getUser,
  creditStarsFromPayment,
  spendStars,
  spendSlive,
  tap,
  buyVip,
  getReferralInfo,
  requestReferralAccess,
  getPendingReferralRequests,
  approveReferralRequest,
  rejectReferralRequest,
  getReferralChannelLink,
  setReferralChannelLink,
  addPlayerToInventory,
  sellCard,
  saveUserState,
  listUsers,
  getStats,
  adjustStarsAdmin,
  adjustSliveAdmin,
  getLeaderboard,
  canUseFreeDraftEntry,
  startDraft,
  getDraftState,
  playDraftBattle,
  getDraftLeaderboard,
  payoutDraftTopIfNeeded,
} from './db.js';
import { getRandomPlayer, PLAYERS_BY_ID, MARKET_PRICE, SELL_RATE } from './players-data.js';

const { BOT_TOKEN, WEBHOOK_SECRET, ADMIN_TELEGRAM_ID, BOT_USERNAME, MINI_APP_URL, PORT = 3000 } = process.env;

if (!ADMIN_TELEGRAM_ID) {
  console.warn(
    'ADMIN_TELEGRAM_ID не задан в .env — админ-панель будет недоступна никому. ' +
    'Узнайте свой Telegram ID через бота @userinfobot и впишите его в .env.'
  );
}

if (!BOT_USERNAME) {
  console.warn(
    'BOT_USERNAME не задан в .env — реферальные ссылки не будут формироваться. ' +
    'Впишите username бота без @ (например BOT_USERNAME=sportlivefc_bot).'
  );
}

if (!BOT_TOKEN || BOT_TOKEN.includes('PUT_YOUR_NEW_TOKEN_HERE')) {
  console.error('BOT_TOKEN не задан в .env — заполните его перед запуском (см. .env.example).');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Каталог покупаемых пакетов звёзд (готовые пресеты для быстрого пополнения).
// Кроме них клиент может прислать packageId: 'custom' + customAmount — тогда
// сумму задаёт сам игрок (см. /api/create-invoice).
const STAR_PACKAGES = {
  pack_100: { amount: 100, title: '100 Stars', description: 'Пополнение баланса на 100 ⭐️' },
  pack_500: { amount: 500, title: '500 Stars', description: 'Пополнение баланса на 500 ⭐️' },
  pack_1000: { amount: 1000, title: '1000 Stars', description: 'Пополнение баланса на 1000 ⭐️' },
};
const MIN_CUSTOM_STARS = 50;
const MAX_CUSTOM_STARS = 100000;

// Внутриигровые паки ("Драфт"), которые покупаются за уже пополненный баланс.
// ВАЖНО: цены здесь были рассинхронизированы с ценами, нарисованными на
// кнопках в index.html (сервер считал silver=150/gold=400/legend=900,
// а кнопки показывали 50/200/1000) — из-за этого buy-pack иногда списывал
// не ту сумму, которую видел игрок, и Telegram/клиент ругался на несостыковку.
// Цены ниже — единственный источник правды, ПОДГОНЯЙТЕ КНОПКИ В index.html ПОД НИХ,
// а не наоборот.
const GAME_PACKS = {
  bronze: { price: 20, currency: 'stars' },
  silver: { price: 50, currency: 'stars' },
  gold: { price: 200, currency: 'stars' },
  legend: { price: 1000, currency: 'stars' },
};

// Паки за внутриигровую валюту $SLive — те же паки, но с ценой в SLive.
const GAME_PACKS_SLIVE = {
  bronze: 500,
  silver: 2500,
  gold: 10000,
  legend: 50000,
};

// Цена VIP-статуса в Stars (разовая покупка, см. /api/buy-vip).
const VIP_PRICE_STARS = 300;

// ---------- Драфт (отдельный от основного Клуба режим: 5 случайных карт + PvP) ----------
// Вход за $SLive — раз в сутки (лимит проверяется в db.js через
// canUseFreeDraftEntry/last_free_entry_day, не на клиенте). Вход за Stars —
// без ограничений, можно пересобирать состав сколько угодно раз в день.
const DRAFT_ENTRY_SLIVE = 1000;
const DRAFT_ENTRY_STARS = 100;
// Прогрессия паков для 5 карт драфт-состава (по одной карте на шаг) —
// используем ту же getRandomPlayer(), что и обычные паки, но повыше рангом,
// потому что это отдельная платная активность.
const DRAFT_PACK_SEQUENCE = ['silver', 'silver', 'gold', 'gold', 'legend'];

const app = express();
// Мини-приложение (index.html) отдаётся не с этого же домена, а из Telegram
// (или GitHub Pages / другого хостинга), поэтому без CORS браузер молча
// блокирует все fetch() к API — это тоже выглядело бы как "не удалось списать Stars".
app.use(cors());
app.use(express.json());

// Лёгкий эндпоинт для внешнего keep-alive пинга (см. инструкцию по cron-job.org).
// Не трогает БД, отвечает мгновенно — идеален, чтобы Render Free не засыпал.
app.get('/health', (req, res) => res.status(200).send('ok'));

// ---------- Auth middleware ----------
function requireTelegramAuth(req, res, next) {
  const initData = req.body.initData || req.query.initData;
  const result = validateInitData(initData, BOT_TOKEN);
  if (!result.valid) {
    return res.status(401).json({ error: 'unauthorized', reason: result.reason });
  }
  req.telegramUser = result.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TELEGRAM_ID) {
    return res.status(403).json({ error: 'admin_not_configured' });
  }
  if (String(req.telegramUser.id) !== String(ADMIN_TELEGRAM_ID)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// Отправка уведомления игроку в личку бота. Не роняем запрос, если бот не
// смог написать (например, юзер ни разу не жал /start) — это не критично.
async function notifyUser(telegramId, text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('notifyUser failed', err);
  }
}

// Приветственное сообщение с краткой инструкцией — отправляется по команде
// /start (см. обработку update.message в /webhook ниже). Если задан
// MINI_APP_URL — добавляем кнопку, которая сразу открывает мини-приложение
// (тип web_app), иначе просто просим воспользоваться кнопкой меню бота.
async function sendWelcomeMessage(chatId) {
  const text =
    '👋 <b>Добро пожаловать в Sport Live FC!</b>\n\n' +
    'Это футбольный клуб-менеджер прямо в Telegram:\n' +
    '⚽️ <b>Тапай</b> — зарабатывай $SLive за каждый клик (энергия обновляется раз в сутки).\n' +
    '🎁 <b>Открывай паки</b> — получай карточки игроков от бронзы до легенды.\n' +
    '🧩 <b>Собирай состав</b> — карточки в составе приносят пассивный доход, игроки одной национальности дают бонус к доходу (химия).\n' +
    '🛒 <b>Маркет</b> — покупай конкретного игрока напрямую или продавай дубликаты карт.\n' +
    '⚔️ <b>Драфт</b> — собери состав из 5 карт и бейся с другими игроками за очки и награды.\n' +
    '🏆 <b>Топ</b> — соревнуйся в лидерборде по балансу и по очкам Драфта.\n' +
    '👥 <b>Реферальная программа</b> — приглашай друзей и получай награду за каждого.\n\n' +
    'Жми кнопку ниже (или кнопку меню), чтобы открыть игру 👇';

  const replyMarkup = MINI_APP_URL
    ? { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: MINI_APP_URL } }]] }
    : undefined;

  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    console.error('sendWelcomeMessage failed', err);
  }
}

// ---------- Каталог маркета (публичный, для отрисовки витрины) ----------
app.get('/api/market-catalog', async (req, res) => {
  const sellPrices = Object.fromEntries(
    Object.entries(MARKET_PRICE).map(([type, price]) => [type, Math.floor(price.slive * SELL_RATE)])
  );
  res.json({ players: Object.values(PLAYERS_BY_ID), prices: MARKET_PRICE, sellPrices, vipPriceStars: VIP_PRICE_STARS });
});

// ---------- Профиль / баланс ----------
// Каждый вызов пересчитывает офлайн-фарм и суточную энергию внутри
// getUser/ensureUser — клиент просто читает готовые актуальные цифры.
// startParam — это start_param мини-аппы (Telegram.WebApp.initDataUnsafe.start_param):
// если это telegram_id другого игрока, засчитываем реферальную привязку
// (см. ensureUser в db.js — сработает только для НОВОГО пользователя).
app.post('/api/me', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const startParam = req.body.startParam;
  const referrerId = startParam && /^\d+$/.test(String(startParam)) && String(startParam) !== telegramId
    ? String(startParam)
    : null;

  const user = await ensureUser(telegramId, req.telegramUser.username || null, referrerId);
  const isAdmin = Boolean(ADMIN_TELEGRAM_ID) && telegramId === String(ADMIN_TELEGRAM_ID);
  res.json({ user, isAdmin });
});

// ---------- Тапалка ----------
// Клиент батчит клики и присылает их пачкой (см. flushTaps() в index.html).
// Сервер сам решает, сколько энергии реально можно списать сегодня — это
// единственное место, где прогресс тапалки надёжно сохраняется между сессиями.
app.post('/api/tap', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { count = 1 } = req.body;

  const result = await tap({ telegramId, count });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason, energy: result.energy, balance: result.balance });
  }
  res.json({ ok: true, gained: result.gained, energy: result.energy, balance: result.balance });
});

// ---------- VIP-статус ----------
app.post('/api/buy-vip', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await buyVip({ telegramId, amount: VIP_PRICE_STARS });

  if (!result.ok) {
    if (result.reason === 'insufficient_funds') {
      return res.status(402).json({ error: result.reason, balance: result.balance, required: VIP_PRICE_STARS - result.balance });
    }
    return res.status(409).json({ error: result.reason, balance: result.balance });
  }

  notifyUser(telegramId, `🏆 Поздравляем! Ты получил VIP-статус за ${VIP_PRICE_STARS} ⭐️!`);
  res.json({ ok: true, balance: result.balance, price: VIP_PRICE_STARS });
});

// ---------- Рефералка ----------
// Отдаёт invited/rewardPerFriend/status/link/channelLink. status: 'none' —
// заявки не было, 'pending' — ждёт подтверждения админом, 'approved' —
// ссылка (link) вписана админом и видна игроку (см. /api/referral-request
// и /api/admin/referral-approve).
app.post('/api/referral-info', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const info = await getReferralInfo(telegramId);
  res.json({ ...info, telegramId, botUsername: BOT_USERNAME || null });
});

// Игрок отправляет заявку на реферальную ссылку (обычно после того, как
// увидел ссылку на канал в channelLink и подписался на него). Статус сразу
// становится 'pending' — саму ссылку выдаёт только админ через
// /api/admin/referral-approve, до этого клиент показывает "Ожидай подтверждения".
app.post('/api/referral-request', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await requestReferralAccess(telegramId);
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }
  const info = await getReferralInfo(telegramId);
  res.json({ ok: true, ...info, telegramId, botUsername: BOT_USERNAME || null });
});

// ---------- Создание счёта на пополнение Stars ----------
// packageId: один из готовых пресетов STAR_PACKAGES, либо 'custom' — тогда
// сумму задаёт customAmount (число от MIN_CUSTOM_STARS до MAX_CUSTOM_STARS).
app.post('/api/create-invoice', requireTelegramAuth, async (req, res) => {
  const { packageId, customAmount } = req.body;

  let amount, title, description;
  if (packageId === 'custom') {
    amount = Math.floor(Number(customAmount));
    if (!Number.isFinite(amount) || amount < MIN_CUSTOM_STARS || amount > MAX_CUSTOM_STARS) {
      return res.status(400).json({ error: 'invalid_amount', min: MIN_CUSTOM_STARS, max: MAX_CUSTOM_STARS });
    }
    title = `${amount} Stars`;
    description = `Пополнение баланса на ${amount} ⭐️`;
  } else {
    const pack = STAR_PACKAGES[packageId];
    if (!pack) {
      return res.status(400).json({ error: 'unknown_package' });
    }
    amount = pack.amount;
    title = pack.title;
    description = pack.description;
  }

  const telegramId = String(req.telegramUser.id);
  // Сумма кладётся прямо в payload — так вебхуку не нужно повторно смотреть
  // в STAR_PACKAGES (что раньше ломалось бы для кастомных сумм).
  const payload = JSON.stringify({ telegramId, amount, ts: Date.now() });

  try {
    const tgRes = await fetch(`${TG_API}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        payload,
        provider_token: '', // для Telegram Stars всегда пусто
        currency: 'XTR',
        prices: [{ label: title, amount }],
      }),
    });
    const data = await tgRes.json();
    if (!data.ok) {
      return res.status(502).json({ error: 'telegram_api_error', details: data.description });
    }
    res.json({ invoiceLink: data.result });
  } catch (err) {
    console.error('createInvoiceLink failed', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------- Покупка пака / "Драфт" ----------
// Раньше клиент сам выбирал случайного игрока из PLAYER_POOL и просто просил
// сервер списать звёзды — то есть рандом и выдача карты не были доверены
// серверу вообще. Теперь:
//   1) сервер списывает цену (Stars или $SLive) атомарно на своей стороне,
//   2) сервер сам тянет случайного игрока (getRandomPlayer) и кладёт его в
//      инвентарь игрока в БД,
//   3) бот присылает уведомление в личку,
//   4) клиенту возвращается уже выданная карта — рисовать её самому не нужно.
app.post('/api/buy-pack', requireTelegramAuth, async (req, res) => {
  const { packType, currency = 'stars' } = req.body;
  const telegramId = String(req.telegramUser.id);

  if (!GAME_PACKS[packType]) {
    return res.status(400).json({ error: 'unknown_pack' });
  }

  let spendResult;
  let price;
  if (currency === 'slive') {
    price = GAME_PACKS_SLIVE[packType];
    spendResult = await spendSlive({ telegramId, amount: price });
  } else {
    price = GAME_PACKS[packType].price;
    spendResult = await spendStars({ telegramId, amount: price });
  }

  if (!spendResult.ok) {
    const extra = currency !== 'slive' && spendResult.reason === 'insufficient_funds'
      ? { required: price - spendResult.balance }
      : {};
    return res.status(402).json({ error: spendResult.reason, balance: spendResult.balance, ...extra });
  }

  const drawn = getRandomPlayer(packType);
  const card = addPlayerToInventory({ telegramId, playerId: drawn.id });

  notifyUser(telegramId, `🎉 Вам выпал <b>${card.name}</b> (${card.rating} OVR, ${card.type})!`);

  res.json({
    ok: true,
    balance: spendResult.balance,
    currency,
    card,
  });
});

// ---------- Маркет: покупка КОНКРЕТНОЙ карточки (без рандома) ----------
// В отличие от /api/buy-pack (там случайная карта нужной редкости), тут
// игрок выбирает точного игрока и платит фиксированную цену MARKET_PRICE
// за его редкость. Та же схема защиты: сумма списывается на сервере,
// карта добавляется в инвентарь на сервере, клиент только показывает результат.
app.post('/api/buy-player', requireTelegramAuth, async (req, res) => {
  const { playerId, currency = 'stars' } = req.body;
  const telegramId = String(req.telegramUser.id);

  const meta = PLAYERS_BY_ID[playerId];
  if (!meta) {
    return res.status(400).json({ error: 'unknown_player' });
  }

  const price = MARKET_PRICE[meta.type];
  let spendResult;
  if (currency === 'slive') {
    spendResult = await spendSlive({ telegramId, amount: price.slive });
  } else {
    spendResult = await spendStars({ telegramId, amount: price.stars });
  }

  if (!spendResult.ok) {
    const extra = currency !== 'slive' && spendResult.reason === 'insufficient_funds'
      ? { required: price.stars - spendResult.balance }
      : {};
    return res.status(402).json({ error: spendResult.reason, balance: spendResult.balance, ...extra });
  }

  const card = addPlayerToInventory({ telegramId, playerId });
  notifyUser(telegramId, `🛒 Куплен <b>${card.name}</b> (${card.rating} OVR) за ${currency === 'slive' ? price.slive + ' 🪙' : price.stars + ' ⭐️'}!`);

  res.json({ ok: true, balance: spendResult.balance, currency, card });
});

// ---------- Продажа дубликата карты ----------
// Продать можно только карту, которой у игрока 2+ экземпляра, и только если
// она сейчас не стоит в составе — см. все проверки в sellCard (db.js).
// Цена — фиксированная доля от гарантированной цены в Маркете (SELL_RATE).
app.post('/api/sell-player', requireTelegramAuth, async (req, res) => {
  const { instId } = req.body;
  const telegramId = String(req.telegramUser.id);

  if (!instId) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const result = await sellCard({ telegramId, instId });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }

  res.json({ ok: true, balance: result.balance, gained: result.gained, instId });
});

// ---------- Сохранение состава ----------
// Состав теперь хранит только instId карт из инвентаря игрока — сервер сам
// проверяет владение картой (см. saveUserState в db.js) и пересчитывает
// ставку фарма из своих собственных данных о картах, а не из того, что
// прислал клиент. Полные объекты карт (myClub) клиенту отдаёт /api/me.
app.post('/api/save-state', requireTelegramAuth, async (req, res) => {
  const { squad } = req.body;
  const telegramId = String(req.telegramUser.id);
  const user = await saveUserState({ telegramId, patch: { squad } });
  res.json({ ok: true, user });
});

// ---------- Лидерборд ($SLive) ----------
app.post('/api/leaderboard', requireTelegramAuth, async (req, res) => {
  const leaderboard = await getLeaderboard(10);
  res.json({ leaderboard });
});

// ---------- ДРАФТ ----------
// Текущее состояние драфт-состава игрока + доступна ли ещё сегодня
// бесплатная (за $SLive) попытка входа.
app.post('/api/draft/state', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const state = await getDraftState(telegramId);
  res.json({ ...state, entryPrices: { slive: DRAFT_ENTRY_SLIVE, stars: DRAFT_ENTRY_STARS } });
});

// Вход в драфт: собирает НОВЫЙ состав из 5 карт (по прогрессии
// DRAFT_PACK_SEQUENCE) и полностью заменяет предыдущий, если он был.
// currency: 'slive' (1000 🪙, лимит 1/сутки) или 'stars' (100 ⭐️, без лимита).
app.post('/api/draft/start', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { currency = 'stars' } = req.body;

  if (currency !== 'slive' && currency !== 'stars') {
    return res.status(400).json({ error: 'invalid_currency' });
  }

  if (currency === 'slive') {
    const canFree = await canUseFreeDraftEntry(telegramId);
    if (!canFree) {
      return res.status(409).json({ error: 'daily_entry_used' });
    }
  }

  const price = currency === 'slive' ? DRAFT_ENTRY_SLIVE : DRAFT_ENTRY_STARS;
  const spendResult = currency === 'slive'
    ? await spendSlive({ telegramId, amount: price })
    : await spendStars({ telegramId, amount: price });

  if (!spendResult.ok) {
    const extra = currency === 'stars' && spendResult.reason === 'insufficient_funds'
      ? { required: price - spendResult.balance }
      : {};
    return res.status(402).json({ error: spendResult.reason, balance: spendResult.balance, ...extra });
  }

  const drawnPlayers = DRAFT_PACK_SEQUENCE.map(tier => getRandomPlayer(tier));
  const result = await startDraft({ telegramId, playerIds: drawnPlayers.map(p => p.id), currency });

  notifyUser(telegramId, `🎯 Драфт собран! Рейтинг состава: ${result.squad.rating} OVR. Одно поражение — и серия закончится, бейся с умом!`);

  res.json({ ok: true, balance: spendResult.balance, currency, ...result });
});

// Один PvP-бой против случайного соперника с готовым драфт-составом. Победа
// даёт награду и очки в лидерборд драфта; поражение сразу завершает серию —
// новый бой потребует новый вход через /api/draft/start.
app.post('/api/draft/battle', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await playDraftBattle({ telegramId });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }
  if (result.won) {
    const opponentLabel = result.opponent.username ? `@${result.opponent.username}` : 'соперника';
    notifyUser(telegramId, `⚔️ Победа в Драфт-битве против ${opponentLabel}! +${result.reward} 🪙 SLive.`);
  }
  res.json(result);
});

// Лидерборд драфта (по накопительным очкам total_points) — отдельный от
// лидерборда по балансу $SLive, показывается сверху вкладки "Топ".
app.post('/api/draft/leaderboard', requireTelegramAuth, async (req, res) => {
  const leaderboard = await getDraftLeaderboard(10);
  res.json({ leaderboard });
});

// ---------- АДМИН-ПАНЕЛЬ ----------
app.post('/api/admin/stats', requireTelegramAuth, requireAdmin, async (req, res) => {
  const stats = await getStats();
  res.json({ stats });
});

app.post('/api/admin/users', requireTelegramAuth, requireAdmin, async (req, res) => {
  const users = await listUsers();
  res.json({ users });
});

app.post('/api/admin/adjust-stars', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { telegramId, amount, reason } = req.body;
  const numAmount = Number(amount);

  if (!telegramId || !Number.isFinite(numAmount) || numAmount === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const result = await adjustStarsAdmin({ telegramId: String(telegramId), amount: numAmount, reason });
  res.json(result);
});

app.post('/api/admin/adjust-slive', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { telegramId, amount, reason } = req.body;
  const numAmount = Number(amount);

  if (!telegramId || !Number.isFinite(numAmount) || numAmount === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const result = await adjustSliveAdmin({ telegramId: String(telegramId), amount: numAmount, reason });
  res.json(result);
});

// Ссылка на канал/чат для подписки перед тем, как стать рефералом. Хранится
// в БД (settings), а не в .env — так админ может поменять её без передеплоя.
app.post('/api/admin/referral-channel', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { link } = req.body;
  const result = await setReferralChannelLink(typeof link === 'string' ? link.trim() : '');
  res.json(result);
});

app.post('/api/admin/referral-channel/get', requireTelegramAuth, requireAdmin, async (req, res) => {
  const link = await getReferralChannelLink();
  res.json({ link: link || '' });
});

// Список заявок игроков, ожидающих подтверждения (см. /api/referral-request).
// Заодно подсказываем админу дефолтную ссылку вида t.me/bot?startapp=id —
// её можно поправить перед подтверждением, если нужна другая ссылка.
app.post('/api/admin/referral-requests', requireTelegramAuth, requireAdmin, async (req, res) => {
  const requests = await getPendingReferralRequests();
  const withSuggestion = requests.map(r => ({
    ...r,
    suggestedLink: BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?startapp=${r.telegramId}` : '',
  }));
  res.json({ requests: withSuggestion });
});

// Админ вписывает ссылку и подтверждает заявку — игроку сразу открывается
// ссылка в интерфейсе, и бот присылает ему уведомление в личку.
app.post('/api/admin/referral-approve', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { telegramId, link } = req.body;
  const trimmedLink = typeof link === 'string' ? link.trim() : '';

  if (!telegramId || !trimmedLink) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const result = await approveReferralRequest({ telegramId: String(telegramId), link: trimmedLink });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }

  notifyUser(
    String(telegramId),
    `✅ Твоя заявка на реферальную ссылку одобрена!\nТвоя ссылка: ${trimmedLink}`
  );

  res.json({ ok: true });
});

// Отклонить заявку — статус игрока возвращается в 'none', он сможет подать заявку заново.
app.post('/api/admin/referral-reject', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const result = await rejectReferralRequest(String(telegramId));
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }
  notifyUser(String(telegramId), '❌ Заявка на реферальную ссылку отклонена. Ты можешь подать её ещё раз.');
  res.json({ ok: true });
});

// ---------- Webhook от Telegram ----------
app.post('/webhook', async (req, res) => {
  const secretHeader = req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secretHeader !== WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const update = req.body;

  try {
    // Приветственное сообщение по команде /start (в т.ч. с реферальным
    // параметром вида "/start 12345" — payload нам не нужен, реферальная
    // привязка обрабатывается через start_param мини-аппы в /api/me).
    const text = update.message?.text;
    if (typeof text === 'string' && (text === '/start' || text.startsWith('/start '))) {
      await sendWelcomeMessage(update.message.chat.id);
    }

    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      let ok = true;
      let errorMessage;
      try {
        const payload = JSON.parse(pcq.invoice_payload);
        // Сверяем сумму счёта с тем, что мы сами положили в payload при
        // создании инвойса (см. /api/create-invoice) — работает как для
        // пресетов, так и для кастомной суммы.
        ok = Number.isFinite(payload.amount) && payload.amount === pcq.total_amount && pcq.currency === 'XTR';
        if (!ok) errorMessage = 'Пакет недоступен, попробуйте снова.';
      } catch {
        ok = false;
        errorMessage = 'Пакет недоступен, попробуйте снова.';
      }

      // answerPreCheckoutQuery ОБЯЗАН уйти в течение 10 секунд, иначе Telegram
      // считает платёж проваленным и клиент увидит "Не удалось списать Stars".
      // Тут нет ни одного await до этого вызова, кроме локального JSON.parse,
      // так что укладываемся в лимит с большим запасом.
      await fetch(`${TG_API}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: pcq.id,
          ok,
          ...(ok ? {} : { error_message: errorMessage }),
        }),
      });
    }

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const payload = JSON.parse(payment.invoice_payload);

      if (Number.isFinite(payload.amount)) {
        await creditStarsFromPayment({
          telegramId: payload.telegramId,
          amount: payload.amount,
          paymentChargeId: payment.telegram_payment_charge_id,
        });
        notifyUser(payload.telegramId, `✅ Баланс пополнен на ${payload.amount} ⭐️!`);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('webhook handling failed', err);
    res.status(200).end();
  }
});

// ---------- Ежедневная награда лидеру Драфт-рейтинга ----------
// Проверяем не по таймеру от момента старта процесса, а по фактической смене
// календарных суток (UTC, см. payoutDraftTopIfNeeded/draft_meta в db.js) —
// так рестарт сервера (Render) не приведёт ни к задвоению, ни к пропуску выплаты.
async function checkDraftTopPayout() {
  try {
    const result = await payoutDraftTopIfNeeded();
    if (result) {
      notifyUser(result.telegramId, `🏆 Ты — лидер Драфт-рейтинга дня! Начислено +${result.reward} 🪙 SLive.`);
    }
  } catch (err) {
    console.error('draft top payout check failed', err);
  }
}
checkDraftTopPayout();
setInterval(checkDraftTopPayout, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Sport Live FC backend listening on :${PORT}`);
});
