// server.js
import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
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
  beginDraftBattle,
  simulateDraftSegment,
  finalizeDraftBattle,
  getDraftLeaderboard,
  beginSquadBattle,
  getSquadBattleState,
  buySquadBattleEnergy,
  finalizeSquadBattle,
  getSquadBattleLeaderboard,
  payoutDraftTopIfNeeded,
  getBattlePassState,
  claimBattlePassReward,
  claimBattlePassBonusGoldPack,
  buyBattlePass,
  BATTLE_PASS_PRICE_STARS,
  getDraftTokenBalance,
  spendDraftTokens,
  createBetEvent,
  closeBetEvent,
  openBetEvent,
  deleteBetEvent,
  resolveBetEvent,
  updateBetOptionPercent,
  getAdminBetEvents,
  getVisibleBetEvents,
  placeBet,
  getMyBets,
  exchangeStarsToSlive,
  getAllUserIds,
  STARS_TO_SLIVE_RATE,
  DB_PATH,
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
// common и mythic добавлены, чтобы расширить линейку паков и в дешёвый, и
// в дорогой край (см. фильтр "Дешёвые"/"Дорогие" в табе ПАКИ на клиенте):
// common — самый дешёвый вход (дешевле bronze), mythic — топ дорогого
// сегмента (дороже legend). Обычный (не стартовый бесплатный) common-пак
// всё ещё существует как платная опция — стартовый набор при онбординге
// это ОТДЕЛЬНАЯ разовая выдача (см. claimStarterPackIfNeeded в db.js), она
// не расходует эти цены и не идёт через /api/buy-pack.
const GAME_PACKS = {
  common: { price: 20, currency: 'stars' },
  bronze: { price: 50, currency: 'stars' },
  silver: { price: 100, currency: 'stars' },
  gold: { price: 400, currency: 'stars' },
  legend: { price: 1000, currency: 'stars' },
  mythic: { price: 3000, currency: 'stars' },
};

// Паки за внутриигровую валюту $SLive — те же паки, но с ценой в SLive.
// Цены в SLive подняты ещё раз относительно Stars-цен (SLive легче фармить
// пассивно, чем купить Stars, так что цену в SLive держим ощутимо выше).
const GAME_PACKS_SLIVE = {
  common: 500,
  bronze: 1500,
  silver: 7500,
  gold: 30000,
  legend: 150000,
  mythic: 600000,
};

// Цена VIP-статуса в Stars (разовая покупка, см. /api/buy-vip).
const VIP_PRICE_STARS = 300;

// ---------- Драфт (отдельный от основного Клуба режим: 5 случайных карт + PvP) ----------
// Вход за $SLive — раз в сутки (лимит проверяется в db.js через
// canUseFreeDraftEntry/last_free_entry_day, не на клиенте). Вход за Stars —
// без ограничений, можно пересобирать состав сколько угодно раз в день.
const DRAFT_ENTRY_SLIVE = 1000;
const DRAFT_ENTRY_STARS = 100;
// Вход за жетоны Драфта — валюта, которую выдаёт ТОЛЬКО Батл Пасс (см.
// battlepass_users.draft_tokens в db.js). Без дневного лимита: жетоны сами по
// себе дефицитны (зарабатываются только уровнями Батл Пасса), так что
// дополнительный лимит не нужен — сколько накопил, столько входов и есть.
const DRAFT_ENTRY_TOKENS = 3;
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
// Возвращает true/false — рассылке (см. /api/admin/broadcast) нужно знать,
// сколько сообщений реально доставлено.
async function notifyUser(telegramId, text) {
  try {
    const resp = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' }),
    });
    const data = await resp.json();
    return Boolean(data.ok);
  } catch (err) {
    console.error('notifyUser failed', err);
    return false;
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
  res.json({ user, isAdmin, starsToSliveRate: STARS_TO_SLIVE_RATE });
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

// ---------- Обмен Stars -> $SLive ----------
// Курс фиксированный (см. STARS_TO_SLIVE_RATE в db.js). Обратного обмена
// ($SLive -> Stars, вывод) пока нет — см. плашку "Вывод" на клиенте.
app.post('/api/exchange-stars', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { amount } = req.body;

  const result = await exchangeStarsToSlive({ telegramId, starsAmount: amount });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason, balance: result.balance });
  }

  res.json({ ok: true, starsBalance: result.starsBalance, sliveBalance: result.sliveBalance, gained: result.gained });
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

  const card = addPlayerToInventory({ telegramId, playerId, source: 'market' });
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
  const draftTokens = getDraftTokenBalance(telegramId);
  res.json({ ...state, draftTokens, entryPrices: { slive: DRAFT_ENTRY_SLIVE, stars: DRAFT_ENTRY_STARS, tokens: DRAFT_ENTRY_TOKENS } });
});

// Вход в драфт: собирает НОВЫЙ состав из 5 карт (по прогрессии
// DRAFT_PACK_SEQUENCE) и полностью заменяет предыдущий, если он был.
// currency: 'slive' (1000 🪙, лимит 1/сутки), 'stars' (100 ⭐️, без лимита)
// или 'tokens' (3 🎟️ жетона Драфта — валюта из наград Батл Пасса, без лимита).
app.post('/api/draft/start', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { currency = 'stars' } = req.body;

  if (!['slive', 'stars', 'tokens'].includes(currency)) {
    return res.status(400).json({ error: 'invalid_currency' });
  }

  if (currency === 'slive') {
    const canFree = await canUseFreeDraftEntry(telegramId);
    if (!canFree) {
      return res.status(409).json({ error: 'daily_entry_used' });
    }
  }

  const price = currency === 'slive' ? DRAFT_ENTRY_SLIVE : currency === 'stars' ? DRAFT_ENTRY_STARS : DRAFT_ENTRY_TOKENS;
  let spendResult;
  if (currency === 'slive') {
    spendResult = await spendSlive({ telegramId, amount: price });
  } else if (currency === 'stars') {
    spendResult = await spendStars({ telegramId, amount: price });
  } else {
    spendResult = await spendDraftTokens({ telegramId, amount: price });
  }

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

// ---------- ДРАФТ: интерактивный матч ----------
// Матч разыгрывается в 3 сегментах по 3 опасных момента (см.
// simulateDraftSegment в db.js). После 1-го и 2-го сегмента игрок выбирает
// тактику на следующий отрезок — это и есть "реальное игровое решение" в
// бою, а не мгновенный бросок кубика. Состояние боя между запросами живёт
// в памяти процесса (не в БД — это одноразовое эфемерное состояние ровно
// одного текущего боя), с TTL на случай, если игрок бросил бой на середине.
const draftMatchSessions = new Map();
const DRAFT_SESSION_TTL_MS = 10 * 60 * 1000; // 10 минут на "зависший" бой
setInterval(() => {
  const cutoff = Date.now() - DRAFT_SESSION_TTL_MS;
  for (const [matchId, session] of draftMatchSessions) {
    if (session.createdAt < cutoff) draftMatchSessions.delete(matchId);
  }
}, 60 * 1000).unref();

// 4 отрезка вместо 3 — матч стал заметно длиннее (12 моментов вместо 9 +
// доп. время) и решений у игрока теперь 3 (после 1, 2 и 3 отрезков), а не 2.
const DRAFT_SEGMENT_RANGES = [[1, 22], [23, 45], [46, 68], [69, 90]];
const DRAFT_TOTAL_SEGMENTS = DRAFT_SEGMENT_RANGES.length;

// Тактика влияет на ЭТОТ сегмент по двум независимым осям:
//  ratingBoost — сдвигает "долю моментов" в твою пользу (сколько из 3
//    моментов сегмента достанутся тебе, а не сопернику);
//  scoreChance — "открытость" игры: с какой вероятностью КАЖДЫЙ момент (не
//    важно, чей) превращается в гол. Чем выше — тем более обменный, дёрганый
//    футбол (может влететь и тебе, и сопернику), чем ниже — тем более вязкая,
//    закрытая игра почти в ноль.
// Раньше выбор сводился к 4 вариантам (атака/оборона/контратака/замена).
// Теперь у игрока 9 обычных стилей на каждое решение — они реально разные
// по профилю риска, а не просто "сильнее/слабее" одного и того же вектора:
//  attack      — давим по всей ширине поля, игра открытая в обе стороны
//  gegenpress  — экстремальный прессинг: моментов ещё больше, чем в attack,
//                и хаоса тоже больше — ва-банк, когда горим по счёту
//  press       — умеренный прессинг: чуть больше своих моментов, умеренный хаос
//  wings       — атака через фланги: промежуточный вариант между press и attack
//  possession  — контроль мяча: моментов у тебя больше, но игра при этом
//                аккуратная и низкая по хаосу (терпеливый розыгрыш, а не обмен)
//  normal      — играть как играли, без изменений
//  long_ball   — игра вторым темпом: отдаём часть контроля, зато каждый
//                момент — что твой, что соперника — острый и часто голевой
//  counter     — сознательно отдаём инициативу, зато реализуем свои редкие
//                моменты почти без промаха
//  defend      — компактный средний блок, надёжно, но почти без своих атак
//  park_bus    — автобус у ворот: почти все моменты у соперника, но игра
//                топится в ноль — не забивает почти никто
// Плюс два разовых спецрешения (по одному использованию за матч каждое —
// независимо друг от друга, можно применить оба в разные сегменты):
//  substitute  — не меняет характер ЭТОГО сегмента, зато даёт ПОСТОЯННУЮ
//                прибавку к рейтингу до конца матча — вклад в долгую
//  motivate    — речь в раздевалке: не трогает долю моментов, но резко
//                поднимает реализацию ТОЛЬКО в этом сегменте — ставка на один
//                решающий отрезок здесь и сейчас
function tacticModifiers(action, used = {}) {
  switch (action) {
    case 'attack': return { ratingBoost: 16, scoreChance: 0.62 };
    case 'gegenpress': return { ratingBoost: 22, scoreChance: 0.70 };
    case 'press': return { ratingBoost: 9, scoreChance: 0.52 };
    case 'wings': return { ratingBoost: 12, scoreChance: 0.56 };
    case 'possession': return { ratingBoost: 7, scoreChance: 0.34 };
    case 'long_ball': return { ratingBoost: -6, scoreChance: 0.58 };
    case 'counter': return { ratingBoost: -14, scoreChance: 0.72 };
    case 'defend': return { ratingBoost: -10, scoreChance: 0.26 };
    case 'park_bus': return { ratingBoost: -20, scoreChance: 0.14 };
    case 'substitute':
      if (used.substitute) return null;
      return { ratingBoost: 0, scoreChance: 0.45, consumesSpecial: 'substitute', permanentBoost: 12 };
    case 'motivate':
      if (used.motivate) return null;
      return { ratingBoost: 0, scoreChance: 0.82, consumesSpecial: 'motivate' };
    default:
      return { ratingBoost: 0, scoreChance: 0.45 };
  }
}

// Начинает бой: подбирает соперника и разыгрывает 1-й сегмент (без решения —
// матч всегда открывается обычной игрой). Дальше клиент показывает эти
// события и предлагает выбрать тактику на 2-й сегмент через /decide.
app.post('/api/draft/battle/start', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const begin = await beginDraftBattle({ telegramId });
  if (!begin.ok) {
    return res.status(409).json({ error: begin.reason });
  }

  const [minuteFrom, minuteTo] = DRAFT_SEGMENT_RANGES[0];
  const segment = simulateDraftSegment({
    attackerRating: begin.attackerRating,
    defenderRating: begin.defenderRating,
    minuteFrom,
    minuteTo,
  });

  const matchId = randomUUID();
  draftMatchSessions.set(matchId, {
    telegramId,
    attackerRating: begin.attackerRating,
    defenderRating: begin.defenderRating,
    opponent: begin.opponent,
    segmentsPlayed: 1,
    permanentBoost: 0,
    usedSpecials: { substitute: false, motivate: false },
    attackerGoals: segment.attackerGoals,
    defenderGoals: segment.defenderGoals,
    createdAt: Date.now(),
  });

  res.json({
    ok: true,
    matchId,
    events: segment.events,
    score: { attacker: segment.attackerGoals, defender: segment.defenderGoals },
    opponent: begin.opponent,
    defenderRating: begin.defenderRating,
    finished: false,
    decisionRequired: true,
    canSubstitute: true,
    canMotivate: true,
    segmentsPlayed: 1,
  });
});

// Применяет выбранную тактику и разыгрывает следующий сегмент. Если это был
// последний (3-й) сегмент — сразу подводит итог боя через finalizeDraftBattle
// (начисляет награду/очки или завершает серию при поражении).
// Доп. время: если после всех обычных сегментов счёт равный, разыгрываем ещё
// один короткий отрезок (91-120', 2 момента, без тактики — "открытый футбол"
// в дополнительное время) прежде чем отдавать судьбу серии пенальти. Общая
// логика для Драфта и Битв составами — обе используют одинаковую структуру
// сессии (attackerGoals/defenderGoals/permanentBoost).
const EXTRA_TIME_RANGE = [91, 120];
const EXTRA_TIME_MOMENTS = 2;

function maybePlayExtraTime(session) {
  if (session.attackerGoals !== session.defenderGoals) return [];
  const [minuteFrom, minuteTo] = EXTRA_TIME_RANGE;
  const extra = simulateDraftSegment({
    attackerRating: session.attackerRating + session.permanentBoost,
    defenderRating: session.defenderRating,
    minuteFrom,
    minuteTo,
    moments: EXTRA_TIME_MOMENTS,
  });
  session.attackerGoals += extra.attackerGoals;
  session.defenderGoals += extra.defenderGoals;
  return extra.events;
}

app.post('/api/draft/battle/decide', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { matchId, action } = req.body;

  const session = draftMatchSessions.get(matchId);
  if (!session || session.telegramId !== telegramId) {
    return res.status(409).json({ error: 'no_active_match' });
  }
  if (session.segmentsPlayed >= DRAFT_TOTAL_SEGMENTS) {
    draftMatchSessions.delete(matchId);
    return res.status(409).json({ error: 'match_already_finished' });
  }

  const mod = tacticModifiers(action, session.usedSpecials);
  if (!mod) {
    return res.status(409).json({ error: `${action}_already_used` });
  }
  if (mod.consumesSpecial) {
    session.usedSpecials[mod.consumesSpecial] = true;
    if (mod.permanentBoost) session.permanentBoost += mod.permanentBoost;
  }

  const [minuteFrom, minuteTo] = DRAFT_SEGMENT_RANGES[session.segmentsPlayed];
  const segment = simulateDraftSegment({
    attackerRating: session.attackerRating + session.permanentBoost,
    defenderRating: session.defenderRating,
    minuteFrom,
    minuteTo,
    ratingBoost: mod.ratingBoost,
    scoreChance: mod.scoreChance,
  });
  session.attackerGoals += segment.attackerGoals;
  session.defenderGoals += segment.defenderGoals;
  session.segmentsPlayed += 1;

  const finished = session.segmentsPlayed >= DRAFT_TOTAL_SEGMENTS;
  let allEvents = segment.events;

  if (!finished) {
    return res.json({
      ok: true,
      matchId,
      events: allEvents,
      score: { attacker: session.attackerGoals, defender: session.defenderGoals },
      finished: false,
      decisionRequired: true,
      canSubstitute: !session.usedSpecials.substitute,
      canMotivate: !session.usedSpecials.motivate,
      segmentsPlayed: session.segmentsPlayed,
    });
  }

  const extraEvents = maybePlayExtraTime(session);
  if (extraEvents.length) allEvents = allEvents.concat(extraEvents);

  const result = await finalizeDraftBattle({
    telegramId,
    attackerGoals: session.attackerGoals,
    defenderGoals: session.defenderGoals,
  });
  draftMatchSessions.delete(matchId);

  if (result.won) {
    const opponentLabel = session.opponent.username ? `@${session.opponent.username}` : 'соперника';
    notifyUser(telegramId, `⚔️ Победа в Драфт-битве против ${opponentLabel}! +${result.reward} 🪙 SLive.`);
  }

  res.json({
    ok: true,
    matchId,
    events: allEvents,
    score: { attacker: session.attackerGoals, defender: session.defenderGoals },
    finished: true,
    decisionRequired: false,
    wentToPenalties: result.wentToPenalties,
    wentToExtraTime: extraEvents.length > 0,
    won: result.won,
    reward: result.reward,
    pointsGained: result.pointsGained,
    opponent: session.opponent,
    defenderRating: session.defenderRating,
    squad: result.squad,
  });
});

// Лидерборд драфта (по накопительным очкам total_points) — отдельный от
// лидерборда по балансу $SLive, показывается сверху вкладки "Топ".
app.post('/api/draft/leaderboard', requireTelegramAuth, async (req, res) => {
  const leaderboard = await getDraftLeaderboard(10);
  res.json({ leaderboard });
});

// ---------- БАТЛ ПАСС ----------
// 14-дневный сезон, общий на всех игроков. Прогресс дневных заданий
// (тапы/паки/бои) двигается автоматически из db.js (см. advanceBattlePassTask,
// вызывается изнутри tap()/addPlayerToInventory()/finalizeDraftBattle()/
// finalizeSquadBattle()) — тут только чтение состояния и клейм наград.
app.post('/api/battlepass/state', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const state = await getBattlePassState(telegramId);
  res.json(state);
});

app.post('/api/battlepass/claim', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { level, track } = req.body;
  if (!level || !track) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const result = await claimBattlePassReward({ telegramId, level: Number(level), track });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }
  res.json(result);
});

app.post('/api/battlepass/claim-bonus-pack', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await claimBattlePassBonusGoldPack({ telegramId });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason });
  }
  notifyUser(telegramId, `🎁 Бонусный золотой пак принёс <b>${result.card.name}</b> (${result.card.rating} OVR)!`);
  res.json(result);
});

app.post('/api/battlepass/buy', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await buyBattlePass({ telegramId, amount: BATTLE_PASS_PRICE_STARS });
  if (!result.ok) {
    const extra = result.reason === 'insufficient_funds' ? { required: BATTLE_PASS_PRICE_STARS - result.balance } : {};
    return res.status(402).json({ error: result.reason, ...extra });
  }
  notifyUser(telegramId, `🎫 Батл Пасс активирован! Премиум-награды сезона открыты.`);
  res.json(result);
});

// ---------- БИТВЫ СОСТАВАМИ ----------
// Отдельный от Драфта режим: бьётся ОБЫЧНЫЙ состав "Мой клуб" (вкладка
// СОСТАВ) — те же карты, что фармят $SLive пассивно. В отличие от Драфта тут
// нет "жизни серии": проигрыш просто идёт в статистику побед/поражений, а
// между боями — перезарядка (см. SQUAD_BATTLE_COOLDOWN_MS в db.js), чтобы
// нельзя было фармить награду бесконечно. Механика самого матча (сегменты,
// тактика, замена, доп. время) — точно та же, что в Драфте, через общие
// simulateDraftSegment/maybePlayExtraTime.
const squadBattleSessions = new Map();

app.post('/api/battles/state', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const state = await getSquadBattleState({ telegramId });
  res.json(state);
});

// Докупка полного бака энергии за Stars — можно жать в любой момент, когда
// заряды не полные, не обязательно ждать нуля.
app.post('/api/battles/buy-energy', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const result = await buySquadBattleEnergy({ telegramId });
  if (!result.ok) {
    return res.status(402).json({ error: result.reason, balance: result.balance, required: result.required });
  }
  res.json(result);
});

app.post('/api/battles/start', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const begin = await beginSquadBattle({ telegramId });
  if (!begin.ok) {
    const extra = begin.reason === 'cooldown'
      ? { retryInMs: begin.retryInMs }
      : begin.reason === 'insufficient_funds'
        ? { balance: begin.balance, required: begin.required }
        : begin.reason === 'no_energy'
          ? { energyRefillCost: begin.energyRefillCost }
          : {};
    return res.status(409).json({ error: begin.reason, ...extra });
  }

  const [minuteFrom, minuteTo] = DRAFT_SEGMENT_RANGES[0];
  const segment = simulateDraftSegment({
    attackerRating: begin.attackerRating,
    defenderRating: begin.defenderRating,
    minuteFrom,
    minuteTo,
  });

  const matchId = randomUUID();
  squadBattleSessions.set(matchId, {
    telegramId,
    attackerRating: begin.attackerRating,
    defenderRating: begin.defenderRating,
    opponent: begin.opponent,
    segmentsPlayed: 1,
    permanentBoost: 0,
    usedSpecials: { substitute: false, motivate: false },
    attackerGoals: segment.attackerGoals,
    defenderGoals: segment.defenderGoals,
    createdAt: Date.now(),
  });

  res.json({
    ok: true,
    matchId,
    events: segment.events,
    score: { attacker: segment.attackerGoals, defender: segment.defenderGoals },
    opponent: begin.opponent,
    defenderRating: begin.defenderRating,
    entryCost: begin.entryCost,
    energy: begin.energy,
    energyMax: begin.energyMax,
    finished: false,
    decisionRequired: true,
    canSubstitute: true,
    canMotivate: true,
    segmentsPlayed: 1,
  });
});

app.post('/api/battles/decide', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { matchId, action } = req.body;

  const session = squadBattleSessions.get(matchId);
  if (!session || session.telegramId !== telegramId) {
    return res.status(409).json({ error: 'no_active_match' });
  }
  if (session.segmentsPlayed >= DRAFT_TOTAL_SEGMENTS) {
    squadBattleSessions.delete(matchId);
    return res.status(409).json({ error: 'match_already_finished' });
  }

  const mod = tacticModifiers(action, session.usedSpecials);
  if (!mod) {
    return res.status(409).json({ error: `${action}_already_used` });
  }
  if (mod.consumesSpecial) {
    session.usedSpecials[mod.consumesSpecial] = true;
    if (mod.permanentBoost) session.permanentBoost += mod.permanentBoost;
  }

  const [minuteFrom, minuteTo] = DRAFT_SEGMENT_RANGES[session.segmentsPlayed];
  const segment = simulateDraftSegment({
    attackerRating: session.attackerRating + session.permanentBoost,
    defenderRating: session.defenderRating,
    minuteFrom,
    minuteTo,
    ratingBoost: mod.ratingBoost,
    scoreChance: mod.scoreChance,
  });
  session.attackerGoals += segment.attackerGoals;
  session.defenderGoals += segment.defenderGoals;
  session.segmentsPlayed += 1;

  const finished = session.segmentsPlayed >= DRAFT_TOTAL_SEGMENTS;
  let allEvents = segment.events;

  if (!finished) {
    return res.json({
      ok: true,
      matchId,
      events: allEvents,
      score: { attacker: session.attackerGoals, defender: session.defenderGoals },
      finished: false,
      decisionRequired: true,
      canSubstitute: !session.usedSpecials.substitute,
      canMotivate: !session.usedSpecials.motivate,
      segmentsPlayed: session.segmentsPlayed,
    });
  }

  const extraEvents = maybePlayExtraTime(session);
  if (extraEvents.length) allEvents = allEvents.concat(extraEvents);

  const result = await finalizeSquadBattle({
    telegramId,
    attackerGoals: session.attackerGoals,
    defenderGoals: session.defenderGoals,
  });
  squadBattleSessions.delete(matchId);

  if (result.won) {
    const opponentLabel = session.opponent.username ? `@${session.opponent.username}` : 'соперника';
    notifyUser(telegramId, `🏆 Победа в Битве составами против ${opponentLabel}! +${result.reward} 🪙 SLive.`);
  }

  res.json({
    ok: true,
    matchId,
    events: allEvents,
    score: { attacker: session.attackerGoals, defender: session.defenderGoals },
    finished: true,
    decisionRequired: false,
    wentToPenalties: result.wentToPenalties,
    wentToExtraTime: extraEvents.length > 0,
    won: result.won,
    reward: result.reward,
    wins: result.wins,
    losses: result.losses,
    opponent: session.opponent,
    defenderRating: session.defenderRating,
  });
});

// Таблица топа "Битв составами" по победам — показывается на вкладке "Топ"
// вместе с лидербордом Драфта и рейтингом по балансу $SLive.
app.post('/api/battles/leaderboard', requireTelegramAuth, async (req, res) => {
  const leaderboard = await getSquadBattleLeaderboard(10);
  res.json({ leaderboard });
});

// Чистим зависшие сессии Битв составами той же логикой TTL, что и Драфт.
setInterval(() => {
  const cutoff = Date.now() - DRAFT_SESSION_TTL_MS;
  for (const [matchId, session] of squadBattleSessions) {
    if (session.createdAt < cutoff) squadBattleSessions.delete(matchId);
  }
}, 60 * 1000).unref();

// ---------- Ставки за $SLive ----------
// Всё содержимое (ивенты, варианты, проценты/коэффициенты) полностью
// управляется админом — см. /api/admin/bets/* ниже. Игрок только смотрит
// открытые ивенты и ставит.
app.post('/api/bets/events', requireTelegramAuth, async (req, res) => {
  const events = await getVisibleBetEvents();
  res.json({ events });
});

app.post('/api/bets/place', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const { eventId, optionId, amount } = req.body;
  if (!eventId || !optionId) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const result = await placeBet({ telegramId, eventId, optionId, amount });
  if (!result.ok) {
    return res.status(409).json({ error: result.reason, balance: result.balance });
  }
  res.json(result);
});

app.post('/api/bets/mine', requireTelegramAuth, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const bets = await getMyBets(telegramId);
  res.json({ bets });
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

// ---------- Админка: ставки за $SLive ----------
// Ивент = заголовок + 2+ варианта исхода, у каждого варианта — процент
// (шанс), который вручную задаёт админ (как полосы в Binance/Fanton).
app.post('/api/admin/bets/create', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { title, description, options, closesAt } = req.body;
  const result = await createBetEvent({
    title: typeof title === 'string' ? title.trim() : '',
    description: typeof description === 'string' ? description.trim() : '',
    options: Array.isArray(options)
      ? options.map(o => ({ label: String(o.label || '').trim(), percent: Number(o.percent) }))
      : [],
    closesAt: closesAt ? Number(closesAt) : null,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.reason });
  }
  res.json(result);
});

app.post('/api/admin/bets/list', requireTelegramAuth, requireAdmin, async (req, res) => {
  const events = await getAdminBetEvents();
  res.json({ events });
});

// Живое изменение кэфа: правит процент/шанс конкретного варианта в открытом
// ивенте. Уже сделанные ставки не трогает — их коэффициент зафиксирован
// в момент ставки (см. db.js:placeBet), новый процент влияет только на
// ставки, сделанные после правки.
app.post('/api/admin/bets/update-odds', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { eventId, optionId, percent } = req.body;
  if (!eventId || !optionId || percent === undefined) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const result = await updateBetOptionPercent({ eventId, optionId, percent });
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json(result);
});

// Останавливает приём новых ставок без подведения итога.
app.post('/api/admin/bets/close', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'invalid_input' });
  const result = await closeBetEvent(eventId);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json(result);
});

// Возобновляет приём ставок у ранее остановленного ('closed') ивента.
app.post('/api/admin/bets/open', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'invalid_input' });
  const result = await openBetEvent(eventId);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json(result);
});

// Полностью удаляет ивент (нельзя для уже подтверждённых). Если по ивенту
// были незавершённые ставки — деньги игрокам возвращаются автоматически.
app.post('/api/admin/bets/delete', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'invalid_input' });
  const result = await deleteBetEvent(eventId);
  if (!result.ok) return res.status(409).json({ error: result.reason });

  for (const refund of result.refunds) {
    notifyUser(
      refund.telegramId,
      `↩️ Ивент "${result.title}" отменён админом. Твоя ставка ${refund.amount} 🪙 SLive возвращена на баланс.`
    );
  }

  res.json({ ok: true });
});

// Подтверждение исхода — выплачивает победителям и шлёт им уведомление ботом.
app.post('/api/admin/bets/resolve', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { eventId, winningOptionId } = req.body;
  if (!eventId || !winningOptionId) return res.status(400).json({ error: 'invalid_input' });

  const result = await resolveBetEvent({ eventId, winningOptionId });
  if (!result.ok) return res.status(409).json({ error: result.reason });

  for (const winner of result.winners) {
    notifyUser(
      winner.telegramId,
      `🎉 Ивент "${result.event.title}" завершён! Твой исход "${result.winningLabel}" сыграл — выигрыш +${winner.payout} 🪙 SLive.`
    );
  }

  res.json(result);
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

// ---------- Резервные копии базы данных ----------
// Подстраховка на случай, если DB_PATH ещё указывает на эфемерный диск
// (см. .env.example / инструкцию по Render Disks): бот сам присылает файл
// базы админу в личку по расписанию. Даже если диск сотрётся при передеплое,
// у админа всегда будет под рукой свежая копия для восстановления вручную.
// ГЛАВНЫЙ фикс всё равно — постоянный Disk на Render + DB_PATH на него,
// это лишь дополнительная сетка безопасности.
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // раз в 6 часов

async function sendDatabaseBackup(caption) {
  if (!ADMIN_TELEGRAM_ID) return { ok: false, reason: 'admin_not_configured' };
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.error('backup: DB_PATH не существует', DB_PATH);
      return { ok: false, reason: 'no_db_file' };
    }

    const buffer = fs.readFileSync(DB_PATH);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const form = new FormData();
    form.append('chat_id', String(ADMIN_TELEGRAM_ID));
    form.append('caption', caption || `Бэкап базы · ${new Date().toLocaleString('ru-RU')}`);
    form.append('document', new Blob([buffer]), `sportlive-backup-${stamp}.db`);

    const resp = await fetch(`${TG_API}/sendDocument`, { method: 'POST', body: form });
    const data = await resp.json();
    if (!data.ok) {
      console.error('backup: sendDocument failed', data);
      return { ok: false, reason: 'telegram_error' };
    }
    return { ok: true };
  } catch (err) {
    console.error('backup: failed', err);
    return { ok: false, reason: 'exception' };
  }
}

// Ручной бэкап по кнопке из админ-панели — например, прямо перед рискованной
// операцией (правка кэфов, массовая выплата и т.п.).
// Рассылка сообщения ВСЕМ игрокам в личку бота (объявления, анонсы новых
// паков/ивентов и т.п.). Отвечаем сразу с числом адресатов и рассылаем в
// фоне — при большой базе игроков синхронная отправка легко упёрлась бы в
// таймаут этого HTTP-запроса. Батчи по BATCH_SIZE с паузой между ними —
// Bot API рассчитан примерно на 30 сообщений/сек в разные чаты, берём запас.
// Когда рассылка закончится, админ получит сводку личным сообщением от бота.
app.post('/api/admin/broadcast', requireTelegramAuth, requireAdmin, async (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'empty_text' });
  }
  if (text.length > 4000) {
    return res.status(400).json({ error: 'text_too_long' });
  }

  const userIds = await getAllUserIds();
  const adminId = req.telegramUser.id;
  res.json({ ok: true, queued: userIds.length });

  const BATCH_SIZE = 20;
  const BATCH_DELAY_MS = 1100;
  (async () => {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(id => notifyUser(id, text)));
      for (const ok of results) {
        if (ok) sent++; else failed++;
      }
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
    notifyUser(
      adminId,
      `📣 Рассылка завершена.\nВсего адресатов: ${userIds.length}\nДоставлено: ${sent}\nНе доставлено: ${failed}`
    );
  })();
});

app.post('/api/admin/backup-now', requireTelegramAuth, requireAdmin, async (req, res) => {
  const result = await sendDatabaseBackup('Бэкап по запросу из админ-панели');
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

setTimeout(() => sendDatabaseBackup('Бэкап при старте сервера'), 30 * 1000);
setInterval(() => sendDatabaseBackup(), BACKUP_INTERVAL_MS);

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
