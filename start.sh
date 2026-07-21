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

# Диагностика без Shell (бесплатный тариф Render не даёт Shell, зато Logs —
# бесплатны всегда): печатаем список генераций и снапшотов реплики ДО
# восстановления. Если restore ниже упадёт (например "decode page N: EOF" —
# повреждённая/недокачанная генерация в R2), этот список в логах покажет,
# на какую генерацию/момент времени откатиться.
echo "[start.sh] Генерации реплики в R2:"
litestream generations -config litestream.yml "$DB_PATH" || echo "[start.sh]   (не удалось получить список генераций)"
echo "[start.sh] Снапшоты реплики в R2:"
litestream snapshots -config litestream.yml "$DB_PATH" || echo "[start.sh]   (не удалось получить список снапшотов)"

# Точечное восстановление задаётся переменными окружения (Render -> Environment,
# без Shell): RESTORE_GENERATION=<id из списка выше> или
# RESTORE_TIMESTAMP=2026-07-20T20:00:00Z. Без них — обычное поведение
# (последняя генерация, если реплика существует).
RESTORE_ARGS=(-if-replica-exists -config litestream.yml)
if [ -n "$RESTORE_GENERATION" ]; then
  echo "[start.sh] RESTORE_GENERATION задан — восстанавливаю генерацию $RESTORE_GENERATION"
  RESTORE_ARGS=(-config litestream.yml -generation "$RESTORE_GENERATION")
elif [ -n "$RESTORE_TIMESTAMP" ]; then
  echo "[start.sh] RESTORE_TIMESTAMP задан — восстанавливаю на момент $RESTORE_TIMESTAMP"
  RESTORE_ARGS=(-config litestream.yml -timestamp "$RESTORE_TIMESTAMP")
fi

echo "[start.sh] Восстанавливаю базу из R2..."
if ! litestream restore "${RESTORE_ARGS[@]}" "$DB_PATH"; then
  echo "[start.sh] ВОССТАНОВЛЕНИЕ НЕ УДАЛОСЬ."
  rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
  if [ "$ALLOW_FRESH_START_ON_RESTORE_FAILURE" = "1" ]; then
    echo "[start.sh] ALLOW_FRESH_START_ON_RESTORE_FAILURE=1 — стартую с ПУСТОЙ базой. ДАННЫЕ ИГРОКОВ БУДУТ ПОТЕРЯНЫ."
  else
    echo "[start.sh] Останавливаюсь, чтобы не потерять данные молча."
    echo "[start.sh] Смотри списки генераций/снапшотов выше в логах и задай RESTORE_GENERATION или RESTORE_TIMESTAMP в Render -> Environment, затем передеплой."
    echo "[start.sh] Либо, если данные не жалко/их нет — поставь ALLOW_FRESH_START_ON_RESTORE_FAILURE=1 и передеплой."
    exit 1
  fi
fi

echo "[start.sh] Запускаю сервер под непрерывной репликацией в R2..."
exec litestream replicate -config litestream.yml -exec "node server.js"
