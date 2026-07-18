#!/usr/bin/env bash
# start.sh
# Точка входа для Render вместо "node server.js" напрямую.
# 1. Если в R2-бакете уже есть реплика базы (т.е. это не первый запуск) —
#    скачивает свежую версию sportlive.db ПЕРЕД стартом сервера.
# 2. Дальше запускает "litestream replicate", который держит сервер живым
#    (-exec) и параллельно непрерывно стримит изменения базы в R2.
# Если DB_PATH/R2_* переменные не заданы — просто запускает сервер как
# раньше, без репликации (удобно для локальной разработки).
set -e

# Litestream ставится в build command в ./bin/litestream (не в системный PATH —
# на Render build-шаг не может писать в /usr/local/bin), поэтому добавляем
# папку проекта в PATH здесь.
export PATH="$PWD/bin:$PATH"
chmod +x bin/litestream 2>/dev/null || true

if [ -z "$R2_BUCKET" ] || [ -z "$R2_ENDPOINT" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
  echo "[start.sh] R2_* переменные не заданы — запускаю сервер БЕЗ репликации базы (только для локальной разработки!)"
  exec node server.js
fi

export DB_PATH="${DB_PATH:-data/sportlive.db}"
mkdir -p "$(dirname "$DB_PATH")"

echo "[start.sh] Восстанавливаю базу из R2 (если реплика уже существует)..."
litestream restore -if-replica-exists -config litestream.yml "$DB_PATH"

echo "[start.sh] Запускаю сервер под непрерывной репликацией в R2..."
exec litestream replicate -config litestream.yml -exec "node server.js"
