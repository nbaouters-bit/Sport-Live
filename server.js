import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { validateInitData } from './telegramAuth.js';
import {
  ensureUser,
  getUser,
  creditStarsFromPayment,
  spendStars,
  saveUserState,
  listUsers,
  getStats,
  adjustStarsAdmin,
} from './db.js';

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

const STAR_PACKAGES = {
  pack_100: { amount: 100, title: '100 Stars', description: 'Пополнение баланса на 100 ⭐️' },
  pack_500: { amount: 500, title: '500 Stars', description: 'Пополнение баланса на 500 ⭐️' },
  pack_1000: { amount: 1000, title: '1000 Stars', description: 'Пополнение баланса на 1000 ⭐️' },
};

const GAME_PACKS = {
  bronze: { price: 50 },
  silver: { price: 150 },
  gold: { price: 400 },
  legend: { price: 900 },
};

const app = express();
app.use(express.json());

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

app.post('/api/me', requireTelegramAuth, async (req, res) => {
  const user = await ensureUser(String(req.telegramUser.id));
  const isAdmin = Boolean(ADMIN_TELEGRAM_ID) && String(req.telegramUser.id) === String(ADMIN_TELEGRAM_ID);
  res.json({ user, isAdmin });
});

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
        provider_token: '',
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

app.post('/api/buy-pack', requireTelegramAuth, async (req, res) => {
  const { packType } = req.body;
  const pack = GAME_PACKS[packType];
  if (!pack) return res.status(400).json({ error: 'unknown_pack' });

  const telegramId = String(req.telegramUser.id);
  const result = await spendStars({ telegramId, amount: pack.price });
  if (!result.ok) {
    return res.status(402).json({ error: result.reason, balance: result.balance });
  }
  res.json({ ok: true, balance: result.balance });
});

app.post('/api/save-state', requireTelegramAuth, async (req, res) => {
  const { squad, myClub, sliveTokens } = req.body;
  const telegramId = String(req.telegramUser.id);
  const user = await saveUserState({ telegramId, patch: { squad, myClub, sliveTokens } });
  res.json({ ok: true, user });
});

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
      try {
        const payload = JSON.parse(pcq.invoice_payload);
        ok = Boolean(STAR_PACKAGES[payload.packageId]);
      } catch {
        ok = false;
      }

      await fetch(`${TG_API}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: pcq.id,
          ok,
          ...(ok ? {} : { error_message: 'Пакет недоступен, попробуйте снова.' }),
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
