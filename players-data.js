// players-data.js
// Единый источник правды по картам игроков. Клиент больше не решает, кто выпал
// из пака — он только красиво показывает то, что вернул сервер.
// Если меняете состав паков — меняйте ТОЛЬКО здесь, клиентский PLAYER_POOL
// в index.html можно оставить как справочник для верстки, но игровой логики
// он больше не определяет.

// income — доход карты в $SLive В ДЕНЬ (пассивный фарм состава начисляется
// раз в сутки-эквивалент офлайн-времени, см. computeFarmRate/applyOfflineFarm
// в db.js). Раньше это поле трактовалось как SLive/СЕКУНДУ — из-за этого
// легенда с income=50 приносила бы 50 SLive КАЖДУЮ секунду (можно было
// окупить пак за 15 минут). Шкала пересчитана (x10 от старых значений,
// пропорции между редкостями сохранены), чтобы набрать на легенду занимало
// не меньше месяца активного фарма — см. подробности в README/PR.
export const PLAYER_POOL = {
  bronze: [
    { id: 'b1', name: 'Zinchenko', rating: 79, pos: 'DEF', nation: 'UKR', type: 'bronze', income: 10 },
    { id: 'b2', name: 'Mudryk', rating: 77, pos: 'FWD', nation: 'UKR', type: 'bronze', income: 10 },
    { id: 'b3', name: 'Pickford', rating: 81, pos: 'GK', nation: 'ENG', type: 'bronze', income: 10 },
    { id: 'b4', name: 'Maguire', rating: 79, pos: 'DEF', nation: 'ENG', type: 'bronze', income: 10 },
    { id: 'b5', name: 'Timber', rating: 80, pos: 'DEF', nation: 'NED', type: 'bronze', income: 10 },
    { id: 'b6', name: 'Malen', rating: 78, pos: 'FWD', nation: 'NED', type: 'bronze', income: 10 },
    { id: 'b7', name: 'Konate', rating: 80, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b8', name: 'Doku', rating: 79, pos: 'FWD', nation: 'BEL', type: 'bronze', income: 10 },
    { id: 'b9', name: 'Wharton', rating: 76, pos: 'MID', nation: 'ENG', type: 'bronze', income: 10 },
    { id: 'b10', name: 'Trubin', rating: 80, pos: 'GK', nation: 'UKR', type: 'bronze', income: 20 },
  ],
  silver: [
    { id: 's1', name: 'Dovbyk', rating: 83, pos: 'FWD', nation: 'UKR', type: 'silver', income: 30 },
    { id: 's2', name: 'Cucurella', rating: 82, pos: 'DEF', nation: 'ESP', type: 'silver', income: 30 },
    { id: 's3', name: 'Gallagher', rating: 80, pos: 'MID', nation: 'ENG', type: 'silver', income: 30 },
    { id: 's4', name: 'Tchouameni', rating: 84, pos: 'MID', nation: 'FRA', type: 'silver', income: 40 },
    { id: 's5', name: 'Havertz', rating: 85, pos: 'FWD', nation: 'GER', type: 'silver', income: 40 },
    { id: 's6', name: 'Musiala', rating: 86, pos: 'MID', nation: 'GER', type: 'silver', income: 50 },
    { id: 's7', name: 'Zaire-Emery', rating: 82, pos: 'MID', nation: 'FRA', type: 'silver', income: 30 },
    { id: 's8', name: 'Frimpong', rating: 81, pos: 'DEF', nation: 'NED', type: 'silver', income: 30 },
    { id: 's9', name: 'Sudakov', rating: 82, pos: 'MID', nation: 'UKR', type: 'silver', income: 30 },
    { id: 's10', name: 'Olise', rating: 84, pos: 'FWD', nation: 'FRA', type: 'silver', income: 40 },
  ],
  gold: [
    { id: 'g1', name: 'L. Messi', rating: 92, pos: 'FWD', nation: 'ARG', type: 'gold', income: 150 },
    { id: 'g2', name: 'Lamine Yamal', rating: 88, pos: 'FWD', nation: 'ESP', type: 'gold', income: 100 },
    { id: 'g3', name: 'Rodri', rating: 91, pos: 'MID', nation: 'ESP', type: 'gold', income: 120 },
    { id: 'g4', name: 'Bellingham', rating: 90, pos: 'MID', nation: 'ENG', type: 'gold', income: 120 },
    { id: 'g5', name: 'Mbappe', rating: 93, pos: 'FWD', nation: 'FRA', type: 'gold', income: 160 },
    { id: 'g6', name: 'Vinicius Jr', rating: 89, pos: 'FWD', nation: 'BRA', type: 'gold', income: 110 },
    { id: 'g7', name: 'Haaland', rating: 91, pos: 'FWD', nation: 'NOR', type: 'gold', income: 140 },
    { id: 'g8', name: 'De Bruyne', rating: 90, pos: 'MID', nation: 'BEL', type: 'gold', income: 120 },
  ],
  legend: [
    { id: 'l1', name: 'Z. Zidane', rating: 96, pos: 'MID', nation: 'FRA', type: 'legend', income: 500 },
    { id: 'l2', name: 'Ronaldinho', rating: 95, pos: 'FWD', nation: 'BRA', type: 'legend', income: 450 },
    { id: 'l3', name: 'Ronaldo R9', rating: 97, pos: 'FWD', nation: 'BRA', type: 'legend', income: 550 },
    { id: 'l4', name: 'Maradona', rating: 98, pos: 'MID', nation: 'ARG', type: 'legend', income: 600 },
    { id: 'l5', name: 'Pele', rating: 99, pos: 'FWD', nation: 'BRA', type: 'legend', income: 650 },
    { id: 'l6', name: 'C. Ronaldo', rating: 96, pos: 'FWD', nation: 'POR', type: 'legend', income: 520 },
  ],
};

// Плоский индекс id -> карточка, удобно для инвентаря/состава.
export const PLAYERS_BY_ID = Object.values(PLAYER_POOL)
  .flat()
  .reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

// Фиксированная цена ГАРАНТИРОВАННОЙ покупки конкретной карточки в Маркете
// (в отличие от пака, где выдаётся случайная карта этой редкости). Выше цены
// самого пака этой редкости — потому что тут нет элемента случайности.
export const MARKET_PRICE = {
  bronze: { stars: 75, slive: 2100 },
  silver: { stars: 180, slive: 10500 },
  gold: { stars: 750, slive: 45000 },
  legend: { stars: 3600, slive: 210000 },
};

// Доля от гарантированной цены Маркета (в SLive), которую игрок получает при
// продаже ЛИШНЕЙ (дублирующейся) карты. Продать можно только если у игрока
// есть 2+ экземпляра одного и того же игрока — единственную копию продать
// нельзя (см. sellCard в db.js, там же проверка "не продать карту из состава").
export const SELL_RATE = 0.4;

export function getSellPrice(playerId) {
  const meta = PLAYERS_BY_ID[playerId];
  if (!meta) return 0;
  const price = MARKET_PRICE[meta.type];
  if (!price) return 0;
  return Math.floor(price.slive * SELL_RATE);
}

/**
 * Случайный игрок из пака заданной редкости.
 * Опционально принимает веса (chance) на карту — если у карты нет
 * поля chance, все карты в паке считаются равновероятными.
 */
export function getRandomPlayer(packType) {
  const pool = PLAYER_POOL[packType];
  if (!pool || pool.length === 0) {
    throw new Error(`unknown_pack_type:${packType}`);
  }

  const weights = pool.map(p => (typeof p.chance === 'number' ? p.chance : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;

  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1]; // защита от ошибок округления
}
