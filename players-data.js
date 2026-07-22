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
  // Самая дешёвая редкость — ниже bronze. Изначально введена для
  // онбординга: ВСЕ игроки (и новые, и уже играющие) при входе получают
  // один бесплатный стартовый набор из ВСЕХ 11 карт этого пула разом (см.
  // claimStarterPackIfNeeded в db.js) — поэтому здесь ровно 11 карт, по
  // одной на каждую позицию будущего состава из 11 футболистов. Income
  // нарочно ниже bronze, чтобы бесплатный набор не обесценивал экономику
  // платных паков.
  common: [
    { id: 'c1', name: 'Trafford', rating: 68, pos: 'GK', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c2', name: 'Colwill', rating: 67, pos: 'DEF', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c3', name: 'Estupinan', rating: 69, pos: 'DEF', nation: 'ESP', type: 'common', income: 5 },
    { id: 'c4', name: 'Yarmoliuk', rating: 65, pos: 'MID', nation: 'UKR', type: 'common', income: 5 },
    { id: 'c5', name: 'Veerman', rating: 66, pos: 'MID', nation: 'NED', type: 'common', income: 5 },
    { id: 'c6', name: 'Doue', rating: 66, pos: 'MID', nation: 'FRA', type: 'common', income: 5 },
    { id: 'c7', name: 'Alarcon', rating: 64, pos: 'MID', nation: 'ARG', type: 'common', income: 5 },
    { id: 'c8', name: 'Kayky', rating: 63, pos: 'FWD', nation: 'BRA', type: 'common', income: 5 },
    { id: 'c9', name: 'Bynoe-Gittens', rating: 68, pos: 'FWD', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c10', name: 'Nmecha', rating: 65, pos: 'FWD', nation: 'GER', type: 'common', income: 5 },
    { id: 'c11', name: 'Lukebakio', rating: 68, pos: 'FWD', nation: 'BEL', type: 'common', income: 6 },
  ],
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
  // Редкость ВЫШЕ legend — топ дорогого сегмента паков (см. GAME_PACKS в
  // server.js). Добавлена вместе с common, чтобы расширить и дешёвый, и
  // дорогой края линейки паков (см. вкладку "Паки" — теперь есть фильтр
  // "Дешёвые"/"Дорогие").
  mythic: [
    { id: 'm1', name: 'J. Cruyff', rating: 97, pos: 'MID', nation: 'NED', type: 'mythic', income: 800 },
    { id: 'm2', name: 'F. Beckenbauer', rating: 96, pos: 'DEF', nation: 'GER', type: 'mythic', income: 780 },
    { id: 'm3', name: 'A. Di Stefano', rating: 98, pos: 'FWD', nation: 'ESP', type: 'mythic', income: 850 },
    { id: 'm4', name: 'Eusebio', rating: 97, pos: 'FWD', nation: 'POR', type: 'mythic', income: 830 },
    { id: 'm5', name: 'M. Platini', rating: 96, pos: 'MID', nation: 'FRA', type: 'mythic', income: 800 },
    { id: 'm6', name: 'Romario', rating: 97, pos: 'FWD', nation: 'BRA', type: 'mythic', income: 840 },
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
  common: { stars: 10, slive: 300 },
  bronze: { stars: 25, slive: 700 },
  silver: { stars: 60, slive: 3500 },
  gold: { stars: 250, slive: 15000 },
  legend: { stars: 1200, slive: 70000 },
  mythic: { stars: 2500, slive: 300000 },
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
