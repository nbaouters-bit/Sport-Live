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
  // Состав пула подобран РОВНО под 11 слотов состава (см. EMPTY_SQUAD в
  // index.html: GK, DEF1-4, MID1-3, FWD1-3, т.е. формация 4-3-3) — поэтому
  // здесь строго 1×GK, 4×DEF, 3×MID, 3×FWD. Так бесплатный стартовый набор
  // всегда закрывает КАЖДУЮ позицию состава ровно одной картой, без дыр и
  // без лишних дублей на одной позиции.
  common: [
    { id: 'c1', name: 'Trafford', rating: 68, pos: 'GK', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c2', name: 'Colwill', rating: 67, pos: 'DEF', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c3', name: 'Estupinan', rating: 69, pos: 'DEF', nation: 'ESP', type: 'common', income: 6 },
    { id: 'c4', name: 'Chalobah', rating: 66, pos: 'DEF', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c5', name: 'Wan-Bissaka', rating: 65, pos: 'DEF', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c6', name: 'Yarmoliuk', rating: 65, pos: 'MID', nation: 'UKR', type: 'common', income: 5 },
    { id: 'c7', name: 'Veerman', rating: 66, pos: 'MID', nation: 'NED', type: 'common', income: 5 },
    { id: 'c8', name: 'Doue', rating: 66, pos: 'MID', nation: 'FRA', type: 'common', income: 5 },
    { id: 'c9', name: 'Kayky', rating: 63, pos: 'FWD', nation: 'BRA', type: 'common', income: 5 },
    { id: 'c10', name: 'Bynoe-Gittens', rating: 68, pos: 'FWD', nation: 'ENG', type: 'common', income: 5 },
    { id: 'c11', name: 'Nmecha', rating: 65, pos: 'FWD', nation: 'GER', type: 'common', income: 5 },
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
    { id: 'b11', name: 'Kimmich', rating: 82, pos: 'MID', nation: 'GER', type: 'bronze', income: 12 },
    { id: 'b12', name: 'Kepa', rating: 78, pos: 'GK', nation: 'ESP', type: 'bronze', income: 10 },
    { id: 'b13', name: 'Digne', rating: 77, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b14', name: 'Adli', rating: 75, pos: 'MID', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b15', name: 'Danjuma', rating: 76, pos: 'FWD', nation: 'NED', type: 'bronze', income: 10 },
    { id: 'b16', name: 'Livakovic', rating: 79, pos: 'GK', nation: 'CRO', type: 'bronze', income: 10 },
    { id: 'b17', name: 'Ake', rating: 79, pos: 'DEF', nation: 'NED', type: 'bronze', income: 10 },
    { id: 'b18', name: 'Iwobi', rating: 77, pos: 'MID', nation: 'NGA', type: 'bronze', income: 10 },
    { id: 'b19', name: 'Larin', rating: 76, pos: 'FWD', nation: 'CAN', type: 'bronze', income: 10 },
    { id: 'b20', name: 'Kovacic', rating: 81, pos: 'MID', nation: 'CRO', type: 'bronze', income: 12 },
    { id: 'b21', name: 'Coman', rating: 82, pos: 'FWD', nation: 'FRA', type: 'bronze', income: 13 },
    { id: 'b22', name: 'Botman', rating: 80, pos: 'DEF', nation: 'NED', type: 'bronze', income: 10 },
    { id: 'b23', name: 'J. Lambert', rating: 73, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b24', name: 'M. Shevchenko', rating: 73, pos: 'FWD', nation: 'SRB', type: 'bronze', income: 10 },
    { id: 'b25', name: 'S. Diaz', rating: 73, pos: 'DEF', nation: 'URU', type: 'bronze', income: 10 },
    { id: 'b26', name: 'K. Marchand', rating: 73, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b27', name: 'B. Kim', rating: 74, pos: 'FWD', nation: 'KOR', type: 'bronze', income: 11 },
    { id: 'b28', name: 'S. Lambert', rating: 73, pos: 'FWD', nation: 'FRA', type: 'bronze', income: 10 },
    { id: 'b29', name: 'A. Toure', rating: 74, pos: 'GK', nation: 'MAR', type: 'bronze', income: 11 },
    { id: 'b30', name: 'M. Roche', rating: 74, pos: 'FWD', nation: 'FRA', type: 'bronze', income: 11 },
    { id: 'b31', name: 'V. Ferrari', rating: 74, pos: 'FWD', nation: 'ITA', type: 'bronze', income: 11 },
    { id: 'b32', name: 'L. Hughes', rating: 75, pos: 'DEF', nation: 'CAN', type: 'bronze', income: 11 },
    { id: 'b33', name: 'T. Nilsen', rating: 75, pos: 'DEF', nation: 'SWE', type: 'bronze', income: 11 },
    { id: 'b34', name: 'P. Smith', rating: 76, pos: 'DEF', nation: 'ENG', type: 'bronze', income: 12 },
    { id: 'b35', name: 'M. Alonso', rating: 76, pos: 'MID', nation: 'ESP', type: 'bronze', income: 12 },
    { id: 'b36', name: 'D. Nilsen', rating: 76, pos: 'FWD', nation: 'NOR', type: 'bronze', income: 12 },
    { id: 'b37', name: 'R. Maes', rating: 76, pos: 'MID', nation: 'NED', type: 'bronze', income: 12 },
    { id: 'b38', name: 'L. Silva', rating: 76, pos: 'GK', nation: 'ARG', type: 'bronze', income: 12 },
    { id: 'b39', name: 'M. Wilson', rating: 76, pos: 'DEF', nation: 'CAN', type: 'bronze', income: 12 },
    { id: 'b40', name: 'E. De Boer', rating: 76, pos: 'MID', nation: 'NED', type: 'bronze', income: 12 },
    { id: 'b41', name: 'E. Ito', rating: 76, pos: 'MID', nation: 'KOR', type: 'bronze', income: 12 },
    { id: 'b42', name: 'P. Rossi', rating: 77, pos: 'GK', nation: 'ITA', type: 'bronze', income: 13 },
    { id: 'b43', name: 'V. Oliveira', rating: 76, pos: 'DEF', nation: 'ESP', type: 'bronze', income: 12 },
    { id: 'b44', name: 'E. Hughes', rating: 78, pos: 'GK', nation: 'CAN', type: 'bronze', income: 13 },
    { id: 'b45', name: 'P. Roche', rating: 77, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 13 },
    { id: 'b46', name: 'L. Clarke', rating: 77, pos: 'DEF', nation: 'AUS', type: 'bronze', income: 13 },
    { id: 'b47', name: 'L. Toure', rating: 77, pos: 'GK', nation: 'ALG', type: 'bronze', income: 13 },
    { id: 'b48', name: 'B. Andersen', rating: 78, pos: 'MID', nation: 'DEN', type: 'bronze', income: 13 },
    { id: 'b49', name: 'J. Castillo', rating: 78, pos: 'MID', nation: 'CHI', type: 'bronze', income: 13 },
    { id: 'b50', name: 'D. Diallo', rating: 77, pos: 'MID', nation: 'GHA', type: 'bronze', income: 13 },
    { id: 'b51', name: 'D. Lopez', rating: 77, pos: 'MID', nation: 'ESP', type: 'bronze', income: 13 },
    { id: 'b52', name: 'A. Esposito', rating: 78, pos: 'DEF', nation: 'ITA', type: 'bronze', income: 13 },
    { id: 'b53', name: 'V. Walker', rating: 79, pos: 'DEF', nation: 'ENG', type: 'bronze', income: 14 },
    { id: 'b54', name: 'S. Mensah', rating: 79, pos: 'DEF', nation: 'SEN', type: 'bronze', income: 14 },
    { id: 'b55', name: 'A. Martinez', rating: 79, pos: 'FWD', nation: 'POR', type: 'bronze', income: 14 },
    { id: 'b56', name: 'V. Girard', rating: 79, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 14 },
    { id: 'b57', name: 'J. Navarro', rating: 80, pos: 'DEF', nation: 'ESP', type: 'bronze', income: 15 },
    { id: 'b58', name: 'S. Girard', rating: 80, pos: 'FWD', nation: 'FRA', type: 'bronze', income: 15 },
    { id: 'b59', name: 'N. Evans', rating: 80, pos: 'DEF', nation: 'AUS', type: 'bronze', income: 15 },
    { id: 'b60', name: 'J. Ferreira', rating: 79, pos: 'DEF', nation: 'POR', type: 'bronze', income: 14 },
    { id: 'b61', name: 'D. Bernard', rating: 80, pos: 'MID', nation: 'FRA', type: 'bronze', income: 15 },
    { id: 'b62', name: 'P. Conti', rating: 80, pos: 'MID', nation: 'ITA', type: 'bronze', income: 15 },
    { id: 'b63', name: 'D. Maes', rating: 80, pos: 'MID', nation: 'BEL', type: 'bronze', income: 15 },
    { id: 'b64', name: 'E. Conti', rating: 82, pos: 'FWD', nation: 'ITA', type: 'bronze', income: 16 },
    { id: 'b65', name: 'C. Diop', rating: 82, pos: 'DEF', nation: 'ALG', type: 'bronze', income: 16 },
    { id: 'b66', name: 'K. Weber', rating: 80, pos: 'FWD', nation: 'GER', type: 'bronze', income: 15 },
    { id: 'b67', name: 'E. Roche', rating: 82, pos: 'DEF', nation: 'FRA', type: 'bronze', income: 16 },
    { id: 'b68', name: 'A. Greco', rating: 82, pos: 'FWD', nation: 'ITA', type: 'bronze', income: 16 },
    { id: 'b69', name: 'V. Park', rating: 81, pos: 'MID', nation: 'JPN', type: 'bronze', income: 15 },
    { id: 'b70', name: 'M. Schneider', rating: 81, pos: 'FWD', nation: 'SUI', type: 'bronze', income: 15 },
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
    { id: 's11', name: 'Wirtz', rating: 86, pos: 'MID', nation: 'GER', type: 'silver', income: 50 },
    { id: 's12', name: 'Saka', rating: 87, pos: 'FWD', nation: 'ENG', type: 'silver', income: 55 },
    { id: 's13', name: 'Rice', rating: 85, pos: 'MID', nation: 'ENG', type: 'silver', income: 45 },
    { id: 's14', name: 'Grimaldo', rating: 83, pos: 'DEF', nation: 'ESP', type: 'silver', income: 35 },
    { id: 's15', name: 'Pedri', rating: 86, pos: 'MID', nation: 'ESP', type: 'silver', income: 50 },
    { id: 's16', name: 'Kvaratskhelia', rating: 87, pos: 'FWD', nation: 'GEO', type: 'silver', income: 55 },
    { id: 's17', name: 'Guler', rating: 82, pos: 'MID', nation: 'TUR', type: 'silver', income: 32 },
    { id: 's18', name: 'Skriniar', rating: 83, pos: 'DEF', nation: 'SVK', type: 'silver', income: 34 },
    { id: 's19', name: 'Fernandez', rating: 84, pos: 'MID', nation: 'ARG', type: 'silver', income: 40 },
    { id: 's20', name: 'Nunez', rating: 84, pos: 'FWD', nation: 'URU', type: 'silver', income: 42 },
    { id: 's21', name: 'Barella', rating: 85, pos: 'MID', nation: 'ITA', type: 'silver', income: 45 },
    { id: 's22', name: 'Van Dijk', rating: 86, pos: 'DEF', nation: 'NED', type: 'silver', income: 48 },
    { id: 's23', name: 'B. Wagner', rating: 79, pos: 'FWD', nation: 'AUT', type: 'silver', income: 30 },
    { id: 's24', name: 'P. Vidal', rating: 78, pos: 'GK', nation: 'COL', type: 'silver', income: 26 },
    { id: 's25', name: 'M. Balog', rating: 78, pos: 'DEF', nation: 'SRB', type: 'silver', income: 26 },
    { id: 's26', name: 'R. Benali', rating: 79, pos: 'MID', nation: 'MAR', type: 'silver', income: 30 },
    { id: 's27', name: 'A. Wilson', rating: 80, pos: 'DEF', nation: 'USA', type: 'silver', income: 33 },
    { id: 's28', name: 'R. Clarke', rating: 78, pos: 'GK', nation: 'IRL', type: 'silver', income: 26 },
    { id: 's29', name: 'M. Janssens', rating: 79, pos: 'MID', nation: 'NED', type: 'silver', income: 30 },
    { id: 's30', name: 'C. Zimmer', rating: 79, pos: 'MID', nation: 'SUI', type: 'silver', income: 30 },
    { id: 's31', name: 'R. Johansson', rating: 80, pos: 'FWD', nation: 'NOR', type: 'silver', income: 33 },
    { id: 's32', name: 'A. Fontaine', rating: 80, pos: 'FWD', nation: 'FRA', type: 'silver', income: 33 },
    { id: 's33', name: 'B. Shevchenko', rating: 79, pos: 'MID', nation: 'TUR', type: 'silver', income: 30 },
    { id: 's34', name: 'C. Dvorak', rating: 81, pos: 'FWD', nation: 'RUS', type: 'silver', income: 37 },
    { id: 's35', name: 'K. Rojas', rating: 80, pos: 'FWD', nation: 'COL', type: 'silver', income: 33 },
    { id: 's36', name: 'T. Schneider', rating: 81, pos: 'GK', nation: 'AUT', type: 'silver', income: 37 },
    { id: 's37', name: 'E. Martinez', rating: 81, pos: 'GK', nation: 'POR', type: 'silver', income: 37 },
    { id: 's38', name: 'J. Nilsen', rating: 81, pos: 'FWD', nation: 'DEN', type: 'silver', income: 37 },
    { id: 's39', name: 'M. Marino', rating: 82, pos: 'MID', nation: 'ITA', type: 'silver', income: 40 },
    { id: 's40', name: 'L. Kovalenko', rating: 81, pos: 'FWD', nation: 'SRB', type: 'silver', income: 37 },
    { id: 's41', name: 'A. Navarro', rating: 82, pos: 'DEF', nation: 'POR', type: 'silver', income: 40 },
    { id: 's42', name: 'J. Weber', rating: 82, pos: 'FWD', nation: 'SUI', type: 'silver', income: 40 },
    { id: 's43', name: 'L. Kim', rating: 81, pos: 'DEF', nation: 'JPN', type: 'silver', income: 37 },
    { id: 's44', name: 'B. Balog', rating: 81, pos: 'FWD', nation: 'HUN', type: 'silver', income: 37 },
    { id: 's45', name: 'E. Romano', rating: 81, pos: 'DEF', nation: 'ITA', type: 'silver', income: 37 },
    { id: 's46', name: 'K. Maes', rating: 82, pos: 'GK', nation: 'BEL', type: 'silver', income: 40 },
    { id: 's47', name: 'R. Osei', rating: 82, pos: 'FWD', nation: 'SEN', type: 'silver', income: 40 },
    { id: 's48', name: 'J. Choi', rating: 83, pos: 'FWD', nation: 'KOR', type: 'silver', income: 44 },
    { id: 's49', name: 'E. Nagy', rating: 84, pos: 'FWD', nation: 'TUR', type: 'silver', income: 47 },
    { id: 's50', name: 'R. Yoon', rating: 83, pos: 'FWD', nation: 'JPN', type: 'silver', income: 44 },
    { id: 's51', name: 'B. Balog', rating: 83, pos: 'DEF', nation: 'UKR', type: 'silver', income: 44 },
    { id: 's52', name: 'K. Hansen', rating: 83, pos: 'DEF', nation: 'SWE', type: 'silver', income: 44 },
    { id: 's53', name: 'C. Roche', rating: 85, pos: 'FWD', nation: 'FRA', type: 'silver', income: 51 },
    { id: 's54', name: 'V. Karlsson', rating: 85, pos: 'MID', nation: 'DEN', type: 'silver', income: 51 },
    { id: 's55', name: 'T. Diallo', rating: 83, pos: 'DEF', nation: 'ALG', type: 'silver', income: 44 },
    { id: 's56', name: 'B. Foster', rating: 85, pos: 'FWD', nation: 'ENG', type: 'silver', income: 51 },
    { id: 's57', name: 'T. Bakker', rating: 85, pos: 'MID', nation: 'NED', type: 'silver', income: 51 },
    { id: 's58', name: 'R. Shevchenko', rating: 84, pos: 'DEF', nation: 'GEO', type: 'silver', income: 47 },
    { id: 's59', name: 'A. Bakker', rating: 84, pos: 'FWD', nation: 'BEL', type: 'silver', income: 47 },
    { id: 's60', name: 'R. Diallo', rating: 84, pos: 'DEF', nation: 'CIV', type: 'silver', income: 47 },
    { id: 's61', name: 'E. Andersen', rating: 86, pos: 'DEF', nation: 'NOR', type: 'silver', income: 54 },
    { id: 's62', name: 'T. Berg', rating: 86, pos: 'GK', nation: 'NOR', type: 'silver', income: 54 },
    { id: 's63', name: 'B. Rousseau', rating: 85, pos: 'MID', nation: 'FRA', type: 'silver', income: 51 },
    { id: 's64', name: 'S. Oliveira', rating: 85, pos: 'FWD', nation: 'ESP', type: 'silver', income: 51 },
    { id: 's65', name: 'T. Torres', rating: 87, pos: 'FWD', nation: 'ARG', type: 'silver', income: 58 },
    { id: 's66', name: 'C. Schulz', rating: 86, pos: 'DEF', nation: 'SUI', type: 'silver', income: 54 },
    { id: 's67', name: 'A. Herrera', rating: 86, pos: 'FWD', nation: 'ARG', type: 'silver', income: 54 },
    { id: 's68', name: 'A. Bianchi', rating: 87, pos: 'FWD', nation: 'ITA', type: 'silver', income: 58 },
    { id: 's69', name: 'S. Zimmer', rating: 87, pos: 'FWD', nation: 'SUI', type: 'silver', income: 58 },
    { id: 's70', name: 'T. Hoffmann', rating: 87, pos: 'DEF', nation: 'AUT', type: 'silver', income: 58 },
  ],
  gold: [
    { id: 'g2', name: 'Lamine Yamal', rating: 88, pos: 'FWD', nation: 'ESP', type: 'gold', income: 100 },
    { id: 'g3', name: 'Rodri', rating: 91, pos: 'MID', nation: 'ESP', type: 'gold', income: 120 },
    { id: 'g4', name: 'Bellingham', rating: 90, pos: 'MID', nation: 'ENG', type: 'gold', income: 120 },
    { id: 'g5', name: 'Mbappe', rating: 93, pos: 'FWD', nation: 'FRA', type: 'gold', income: 160 },
    { id: 'g6', name: 'Vinicius Jr', rating: 89, pos: 'FWD', nation: 'BRA', type: 'gold', income: 110 },
    { id: 'g7', name: 'Haaland', rating: 91, pos: 'FWD', nation: 'NOR', type: 'gold', income: 140 },
    { id: 'g8', name: 'De Bruyne', rating: 90, pos: 'MID', nation: 'BEL', type: 'gold', income: 120 },
    { id: 'g9', name: 'Kane', rating: 90, pos: 'FWD', nation: 'ENG', type: 'gold', income: 125 },
    { id: 'g10', name: 'Salah', rating: 90, pos: 'FWD', nation: 'EGY', type: 'gold', income: 125 },
    { id: 'g11', name: 'Courtois', rating: 90, pos: 'GK', nation: 'BEL', type: 'gold', income: 110 },
    { id: 'g12', name: 'Alisson', rating: 89, pos: 'GK', nation: 'BRA', type: 'gold', income: 105 },
    { id: 'g13', name: 'Dias', rating: 88, pos: 'DEF', nation: 'POR', type: 'gold', income: 100 },
    { id: 'g14', name: 'Modric', rating: 88, pos: 'MID', nation: 'CRO', type: 'gold', income: 105 },
    { id: 'g15', name: 'Foden', rating: 89, pos: 'MID', nation: 'ENG', type: 'gold', income: 110 },
    { id: 'g16', name: 'Martinez', rating: 87, pos: 'FWD', nation: 'ARG', type: 'gold', income: 95 },
    { id: 'g17', name: 'Kimpembe', rating: 87, pos: 'DEF', nation: 'FRA', type: 'gold', income: 95 },
    { id: 'g18', name: 'R. Okafor', rating: 86, pos: 'DEF', nation: 'CIV', type: 'gold', income: 90 },
    { id: 'g19', name: 'N. Foster', rating: 86, pos: 'MID', nation: 'ENG', type: 'gold', income: 90 },
    { id: 'g20', name: 'D. Aguirre', rating: 86, pos: 'GK', nation: 'MEX', type: 'gold', income: 90 },
    { id: 'g21', name: 'K. Fontaine', rating: 87, pos: 'GK', nation: 'FRA', type: 'gold', income: 101 },
    { id: 'g22', name: 'E. Petrov', rating: 87, pos: 'GK', nation: 'SRB', type: 'gold', income: 101 },
    { id: 'g23', name: 'L. Romano', rating: 87, pos: 'FWD', nation: 'ITA', type: 'gold', income: 101 },
    { id: 'g24', name: 'B. Diop', rating: 88, pos: 'DEF', nation: 'EGY', type: 'gold', income: 111 },
    { id: 'g25', name: 'L. Aguirre', rating: 87, pos: 'MID', nation: 'ARG', type: 'gold', income: 101 },
    { id: 'g26', name: 'N. Park', rating: 87, pos: 'MID', nation: 'JPN', type: 'gold', income: 101 },
    { id: 'g27', name: 'M. Berg', rating: 87, pos: 'FWD', nation: 'NOR', type: 'gold', income: 101 },
    { id: 'g28', name: 'V. Willems', rating: 88, pos: 'GK', nation: 'BEL', type: 'gold', income: 111 },
    { id: 'g29', name: 'N. Becker', rating: 89, pos: 'DEF', nation: 'AUT', type: 'gold', income: 122 },
    { id: 'g30', name: 'D. Wagner', rating: 89, pos: 'MID', nation: 'SUI', type: 'gold', income: 122 },
    { id: 'g31', name: 'D. Garcia', rating: 89, pos: 'MID', nation: 'POR', type: 'gold', income: 122 },
    { id: 'g32', name: 'P. Clarke', rating: 89, pos: 'FWD', nation: 'USA', type: 'gold', income: 122 },
    { id: 'g33', name: 'B. Garcia', rating: 88, pos: 'MID', nation: 'POR', type: 'gold', income: 111 },
    { id: 'g34', name: 'K. Choi', rating: 89, pos: 'MID', nation: 'JPN', type: 'gold', income: 122 },
    { id: 'g35', name: 'S. Kim', rating: 89, pos: 'MID', nation: 'JPN', type: 'gold', income: 122 },
    { id: 'g36', name: 'T. Zimmer', rating: 89, pos: 'FWD', nation: 'AUT', type: 'gold', income: 122 },
    { id: 'g37', name: 'L. Murphy', rating: 90, pos: 'FWD', nation: 'ENG', type: 'gold', income: 133 },
    { id: 'g38', name: 'P. Schulz', rating: 90, pos: 'DEF', nation: 'GER', type: 'gold', income: 133 },
    { id: 'g39', name: 'E. Hughes', rating: 91, pos: 'GK', nation: 'ENG', type: 'gold', income: 144 },
    { id: 'g40', name: 'B. Lindqvist', rating: 90, pos: 'MID', nation: 'SWE', type: 'gold', income: 133 },
    { id: 'g41', name: 'B. Kowalski', rating: 90, pos: 'DEF', nation: 'GEO', type: 'gold', income: 133 },
    { id: 'g42', name: 'R. Romano', rating: 92, pos: 'DEF', nation: 'ITA', type: 'gold', income: 154 },
    { id: 'g43', name: 'A. Cardoso', rating: 91, pos: 'MID', nation: 'URU', type: 'gold', income: 144 },
    { id: 'g44', name: 'J. Reid', rating: 92, pos: 'DEF', nation: 'CAN', type: 'gold', income: 154 },
    { id: 'g45', name: 'E. Dvorak', rating: 93, pos: 'FWD', nation: 'SVK', type: 'gold', income: 165 },
    { id: 'g46', name: 'J. Janssens', rating: 93, pos: 'DEF', nation: 'NED', type: 'gold', income: 165 },
    { id: 'g47', name: 'V. Kovac', rating: 93, pos: 'DEF', nation: 'TUR', type: 'gold', income: 165 },
    { id: 'g48', name: 'N. Ferreira', rating: 93, pos: 'MID', nation: 'POR', type: 'gold', income: 165 },
    { id: 'g49', name: 'A. Kim', rating: 93, pos: 'FWD', nation: 'JPN', type: 'gold', income: 165 },
    { id: 'g50', name: 'T. Taylor', rating: 93, pos: 'DEF', nation: 'USA', type: 'gold', income: 165 },
    { id: 'g51', name: 'C. Rodriguez', rating: 93, pos: 'DEF', nation: 'URU', type: 'gold', income: 165 },
  ],
  legend: [
    // Ронду и Месси — топ легенд, оба 99 рейтинга (Роналду первым). Income
    // считается по той же кривой, что и остальная легенда: 50*rating-4300.
    { id: 'l6', name: 'C. Ronaldo', rating: 99, pos: 'FWD', nation: 'POR', type: 'legend', income: 650 },
    { id: 'g1', name: 'L. Messi', rating: 99, pos: 'FWD', nation: 'ARG', type: 'legend', income: 650 },
    { id: 'l5', name: 'Pele', rating: 99, pos: 'FWD', nation: 'BRA', type: 'legend', income: 650 },
    { id: 'l4', name: 'Maradona', rating: 98, pos: 'MID', nation: 'ARG', type: 'legend', income: 600 },
    { id: 'l3', name: 'Ronaldo R9', rating: 97, pos: 'FWD', nation: 'BRA', type: 'legend', income: 550 },
    { id: 'l1', name: 'Z. Zidane', rating: 96, pos: 'MID', nation: 'FRA', type: 'legend', income: 500 },
    { id: 'l2', name: 'Ronaldinho', rating: 95, pos: 'FWD', nation: 'BRA', type: 'legend', income: 450 },
    { id: 'l7', name: 'Xavi', rating: 94, pos: 'MID', nation: 'ESP', type: 'legend', income: 400 },
    { id: 'l8', name: 'Iniesta', rating: 94, pos: 'MID', nation: 'ESP', type: 'legend', income: 400 },
    { id: 'l9', name: 'R. Baggio', rating: 93, pos: 'FWD', nation: 'ITA', type: 'legend', income: 350 },
    { id: 'l10', name: 'Kaka', rating: 93, pos: 'MID', nation: 'BRA', type: 'legend', income: 350 },
    { id: 'l11', name: 'Zico', rating: 93, pos: 'MID', nation: 'BRA', type: 'legend', income: 350 },
    { id: 'l12', name: 'V. Benali', rating: 92, pos: 'FWD', nation: 'NGA', type: 'legend', income: 330 },
    { id: 'l13', name: 'C. Park', rating: 93, pos: 'MID', nation: 'JPN', type: 'legend', income: 378 },
    { id: 'l14', name: 'E. Lopez', rating: 93, pos: 'MID', nation: 'POR', type: 'legend', income: 378 },
    { id: 'l15', name: 'K. De Jong', rating: 93, pos: 'MID', nation: 'BEL', type: 'legend', income: 378 },
    { id: 'l16', name: 'P. Lopez', rating: 94, pos: 'FWD', nation: 'POR', type: 'legend', income: 427 },
    { id: 'l17', name: 'M. Zimmer', rating: 93, pos: 'DEF', nation: 'GER', type: 'legend', income: 378 },
    { id: 'l18', name: 'E. Fernandez', rating: 95, pos: 'FWD', nation: 'BRA', type: 'legend', income: 475 },
    { id: 'l19', name: 'D. Diaz', rating: 94, pos: 'GK', nation: 'MEX', type: 'legend', income: 427 },
    { id: 'l20', name: 'C. Tanaka', rating: 96, pos: 'GK', nation: 'JPN', type: 'legend', income: 523 },
    { id: 'l21', name: 'R. Foster', rating: 95, pos: 'DEF', nation: 'USA', type: 'legend', income: 475 },
    { id: 'l22', name: 'S. Mertens', rating: 95, pos: 'DEF', nation: 'NED', type: 'legend', income: 475 },
    { id: 'l23', name: 'K. Weber', rating: 96, pos: 'GK', nation: 'SUI', type: 'legend', income: 523 },
    { id: 'l24', name: 'J. Ferrari', rating: 96, pos: 'DEF', nation: 'ITA', type: 'legend', income: 523 },
    { id: 'l25', name: 'K. Sato', rating: 96, pos: 'DEF', nation: 'KOR', type: 'legend', income: 523 },
    { id: 'l26', name: 'B. Hoffmann', rating: 97, pos: 'MID', nation: 'GER', type: 'legend', income: 572 },
    { id: 'l27', name: 'E. Balog', rating: 97, pos: 'GK', nation: 'RUS', type: 'legend', income: 572 },
    { id: 'l28', name: 'J. Rossi', rating: 97, pos: 'DEF', nation: 'ITA', type: 'legend', income: 572 },
    { id: 'l29', name: 'R. Gonzalez', rating: 97, pos: 'GK', nation: 'CHI', type: 'legend', income: 572 },
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
    { id: 'm7', name: 'F. Puskas', rating: 98, pos: 'FWD', nation: 'HUN', type: 'mythic', income: 850 },
    { id: 'm8', name: 'G. Muller', rating: 98, pos: 'FWD', nation: 'GER', type: 'mythic', income: 850 },
    { id: 'm9', name: 'B. Moore', rating: 96, pos: 'DEF', nation: 'ENG', type: 'mythic', income: 780 },
    { id: 'm10', name: 'L. Yashin', rating: 96, pos: 'GK', nation: 'RUS', type: 'mythic', income: 780 },
    { id: 'm11', name: 'V. Alonso', rating: 95, pos: 'FWD', nation: 'POR', type: 'mythic', income: 770 },
    { id: 'm12', name: 'N. Janssens', rating: 96, pos: 'GK', nation: 'BEL', type: 'mythic', income: 795 },
    { id: 'm13', name: 'S. Bernard', rating: 95, pos: 'MID', nation: 'FRA', type: 'mythic', income: 770 },
    { id: 'm14', name: 'J. Kovac', rating: 97, pos: 'FWD', nation: 'CZE', type: 'mythic', income: 820 },
    { id: 'm15', name: 'V. Hughes', rating: 97, pos: 'MID', nation: 'USA', type: 'mythic', income: 820 },
    { id: 'm16', name: 'M. Foster', rating: 97, pos: 'MID', nation: 'AUS', type: 'mythic', income: 820 },
    { id: 'm17', name: 'E. Murphy', rating: 98, pos: 'DEF', nation: 'IRL', type: 'mythic', income: 845 },
    { id: 'm18', name: 'D. Bakker', rating: 99, pos: 'MID', nation: 'BEL', type: 'mythic', income: 870 },
    { id: 'm19', name: 'D. Becker', rating: 98, pos: 'FWD', nation: 'GER', type: 'mythic', income: 845 },
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
// common — БЕЗ звёзд намеренно: поле stars отсутствует (не 0, а именно
// отсутствует), это сигнал клиенту скрыть кнопку покупки за ⭐️ в Маркете
// (см. renderMarketCards в index.html) — стартовую редкость можно купить
// в Маркете только за $SLive, как и сам пак этой же редкости.
// Формат единый по всем редкостям: цена Маркета = ×1.5 от цены пака этой же
// редкости в магазине (см. buyPack-кнопки в index.html) — и по $SLive, и по
// ⭐️. common — отдельно (×2, без звёзд), см. комментарий выше.
export const MARKET_PRICE = {
  common: { slive: 1000 },
  bronze: { stars: 65, slive: 7500 },
  silver: { stars: 125, slive: 15000 },
  gold: { stars: 600, slive: 45000 },
  legend: { stars: 1500, slive: 225000 },
  mythic: { stars: 2500, slive: 900000 },
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
