import crypto from 'crypto';

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function validateInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, reason: 'missing_init_data' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { valid: false, reason: 'missing_hash' };
  }
  params.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { valid: false, reason: 'bad_signature' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > MAX_AUTH_AGE_SECONDS) {
    return { valid: false, reason: 'stale_auth_date' };
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }

  if (!user || !user.id) {
    return { valid: false, reason: 'missing_user' };
  }

  return { valid: true, user };
}
