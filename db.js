// db.js
// Простейшее файловое хранилище — достаточно, чтобы прототип реально работал
// и баланс нельзя было подделать из браузера.

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const DB_PATH = new URL('./data.json', import.meta.url);

let writeChain = Promise.resolve();

async function readDb() {
  if (!existsSync(DB_PATH)) {
    return { users: {}, processedPayments: {} };
  }
  const raw = await readFile(DB_PATH, 'utf-8');
  return raw.trim() ? JSON.parse(raw) : { users: {}, processedPayments: {} };
}

async function writeDb(data) {
  await writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function withWriteLock(fn) {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {});
  return result;
}

function defaultUser(telegramId) {
  return {
    telegramId,
    sliveTokens: 0,
    tgStars: 0,
    isVip: false,
    squad: {},
    myClub: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function getUser(telegramId) {
  const db = await readDb();
  return db.users[telegramId] || defaultUser(telegramId);
}

export async function ensureUser(telegramId) {
  return withWriteLock(async () => {
    const db = await readDb();
    if (!db.users[telegramId]) {
      db.users[telegramId] = defaultUser(telegramId);
      await writeDb(db);
    }
    return db.users[telegramId];
  });
}

export async function creditStarsFromPayment({ telegramId, amount, paymentChargeId }) {
  return withWriteLock(async () => {
    const db = await readDb();

    if (db.processedPayments[paymentChargeId]) {
      return { alreadyProcessed: true, balance: db.users[telegramId]?.tgStars ?? 0 };
    }

    if (!db.users[telegramId]) {
      db.users[telegramId] = defaultUser(telegramId);
    }

    db.users[telegramId].tgStars += amount;
    db.users[telegramId].updatedAt = Date.now();
    db.processedPayments[paymentChargeId] = {
      telegramId,
      amount,
      at: Date.now(),
    };

    await writeDb(db);
    return { alreadyProcessed: false, balance: db.users[telegramId].tgStars };
  });
}

export async function spendStars({ telegramId, amount }) {
  return withWriteLock(async () => {
    const db = await readDb();
    const user = db.users[telegramId] || defaultUser(telegramId);

    if (user.tgStars < amount) {
      return { ok: false, reason: 'insufficient_funds', balance: user.tgStars };
    }

    user.tgStars -= amount;
    user.updatedAt = Date.now();
    db.users[telegramId] = user;
    await writeDb(db);
    return { ok: true, balance: user.tgStars };
  });
}

export async function saveUserState({ telegramId, patch }) {
  return withWriteLock(async () => {
    const db = await readDb();
    const user = db.users[telegramId] || defaultUser(telegramId);
    Object.assign(user, patch, { updatedAt: Date.now() });
    db.users[telegramId] = user;
    await writeDb(db);
    return user;
  });
}

export async function listUsers() {
  const db = await readDb();
  return Object.values(db.users).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getStats() {
  const db = await readDb();
  const users = Object.values(db.users);
  const totalUsers = users.length;
  const totalStarsBalance = users.reduce((sum, u) => sum + (u.tgStars || 0), 0);
  const totalSliveBalance = users.reduce((sum, u) => sum + (u.sliveTokens || 0), 0);
  const vipUsers = users.filter(u => u.isVip).length;
  const payments = Object.values(db.processedPayments);
  const totalPaymentsCount = payments.length;
  return {
    totalUsers,
    totalStarsBalance,
    totalSliveBalance,
    vipUsers,
    totalPaymentsCount,
  };
}

export async function adjustStarsAdmin({ telegramId, amount, reason }) {
  return withWriteLock(async () => {
    const db = await readDb();
    const user = db.users[telegramId] || defaultUser(telegramId);

    const before = user.tgStars;
    user.tgStars = Math.max(0, user.tgStars + amount);
    user.updatedAt = Date.now();
    db.users[telegramId] = user;

    if (!db.adminLog) db.adminLog = [];
    db.adminLog.push({
      telegramId,
      amountRequested: amount,
      balanceBefore: before,
      balanceAfter: user.tgStars,
      reason: reason || null,
      at: Date.now(),
    });

    await writeDb(db);
    return { ok: true, balance: user.tgStars };
  });
}
