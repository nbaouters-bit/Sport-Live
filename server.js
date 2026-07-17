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
  addPlayerToInventory,
  saveUserState,
  listUsers,
  getStats,
  adjustStarsAdmin,
  getLeaderboard,
} from './db.js';
import { getRandomPlayer, PLAYERS_BY_ID, MARKET_PRICE } from './players-data.js';

const { BOT_TOKEN, WEBHOOK_SECRET, ADMIN_TELEGRAM_ID, PORT = 3000 } = process.env;

if (!ADMIN_TELEGRAM_ID) {
  console.warn(
    'ADMIN_TELEGRAM_ID не задан в .env — админ-панель будет недоступна никому. ' +
    'Узнайте свой Telegram ID через бота @userinfobot и впишите его в .env.'
  );
}

if (!BOT_TOKEN || BOT_TOKEN.includes('PUT_YOUR_NEW_TOKEN_HERE')) {
  console.error('BOT_TOKEN не задан в .env — заполните его перед запуском (см. .env.example).');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Каталог покупаемых пакетов звёзд. Цена = amount, задаётся В ЗВЁЗДАХ (XTR),
// у Stars нет дробных единиц, provider_token для XTR всегда пустая строка.
const STAR_PACKAGES = {
  pack_100: { amount: 100, title: '100 Stars', description: 'Пополнение баланса на 100 ⭐️' },
  pack_500: { amount: 500, title: '500 Stars', description: 'Пополнение баланса на 500 ⭐️' },
  pack_1000: { amount: 1000, title: '1000 Stars', description: 'Пополнение баланса на 1000 ⭐️' },
};

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

// ---------- Каталог маркета (публичный, для отрисовки витрины) ----------
app.get('/api/market-catalog', async (req, res) => {
  res.json({ players: Object.values(PLAYERS_BY_ID), prices: MARKET_PRICE });
});

// ---------- Профиль / баланс ----------
// Каждый вызов пересчитывает офлайн-фарм (delta * farm_rate текущего состава)
// внутри getUser/ensureUser — клиент просто читает готовый актуальный баланс.
app.post('/api/me', requireTelegramAuth, async (req, res) => {
  const user = await ensureUser(String(req.telegramUser.id), req.telegramUser.username || null);
  const isAdmin = Boolean(ADMIN_TELEGRAM_ID) && String(req.telegramUser.id) === String(ADMIN_TELEGRAM_ID);
  res.json({ user, isAdmin });
});

// ---------- Создание счёта на пополнение Stars ----------
app.post('/api/create-invoice', requireTelegramAuth, async (req, res) => {
  const { packageId } = req.body;
  const pack = STAR_PACKAGES[packageId];
  if (!pack) {
    return res.status(400).json({ error: 'unknown_package' });
  }

  const telegramId = String(req.telegramUser.id);
  const payload = JSON.stringify({ telegramId, packageId, ts: Date.now() });

  try {
    const tgRes = await fetch(`${TG_API}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: pack.title,
        description: pack.description,
        payload,
        provider_token: '', // для Telegram Stars всегда пусто
        currency: 'XTR',
        prices: [{ label: pack.title, amount: pack.amount }],
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
  if (currency === 'slive') {
    const price = GAME_PACKS_SLIVE[packType];
    spendResult = await spendSlive({ telegramId, amount: price });
  } else {
    const price = GAME_PACKS[packType].price;
    spendResult = await spendStars({ telegramId, amount: price });
  }

  if (!spendResult.ok) {
    return res.status(402).json({ error: spendResult.reason, balance: spendResult.balance });
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
    return res.status(402).json({ error: spendResult.reason, balance: spendResult.balance });
  }

  const card = addPlayerToInventory({ telegramId, playerId });
  notifyUser(telegramId, `🛒 Куплен <b>${card.name}</b> (${card.rating} OVR) за ${currency === 'slive' ? price.slive + ' 🪙' : price.stars + ' ⭐️'}!`);

  res.json({ ok: true, balance: spendResult.balance, currency, card });
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

// ---------- Лидерборд ----------
app.post('/api/leaderboard', requireTelegramAuth, async (req, res) => {
  const leaderboard = await getLeaderboard(10);
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

// ---------- Webhook от Telegram ----------
app.post('/webhook', async (req, res) => {
  const secretHeader = req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secretHeader !== WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const update = req.body;

  try {
    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      let ok = true;
      let errorMessage;
      try {
        const payload = JSON.parse(pcq.invoice_payload);
        const pack = STAR_PACKAGES[payload.packageId];
        // Дополнительно сверяем сумму счёта с нашим каталогом — на случай если
        // payload когда-нибудь начнёт приходить не от нашего /api/create-invoice.
        ok = Boolean(pack) && pack.amount === pcq.total_amount && pcq.currency === 'XTR';
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
      const pack = STAR_PACKAGES[payload.packageId];

      if (pack) {
        await creditStarsFromPayment({
          telegramId: payload.telegramId,
          amount: pack.amount,
          paymentChargeId: payment.telegram_payment_charge_id,
        });
        notifyUser(payload.telegramId, `✅ Баланс пополнен на ${pack.amount} ⭐️!`);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('webhook handling failed', err);
    res.status(200).end();
  }
});

app.listen(PORT, () => {
  console.log(`Sport Live FC backend listening on :${PORT}`);
});
