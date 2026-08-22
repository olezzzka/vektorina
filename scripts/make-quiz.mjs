/**
 * Собирает викторину. Форматы:
 *   duel  — «что дороже»: два скина (по умолчанию)
 *   price — «угадай цену»: один скин, три варианта цены A/B/C
 *   odd   — «что лишнее»: три скина, один из другой ценовой лиги
 * Пишет out/quizzes/<id>.json, out/captions/<id>.txt, out/scripts/<id>.txt
 *
 *   node scripts/make-quiz.mjs [--rounds 5] [--id my-video] [--count 3] [--format price|odd|duel|random]
 */
import fs from 'node:fs';
import {p, readJson, writeJson, config, log, warn, shuffle, rnd} from './lib.mjs';
import {buildNarration, narrationScript} from './narration.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();
const ROUNDS = Number(arg('rounds', cfg.roundsPerVideo));
const COUNT = Number(arg('count', 1));
const FORMAT_ARG = arg('format', cfg.format ?? 'duel');
const FORMATS = ['duel', 'price', 'odd', 'spot', 'zoom', 'rarity', 'sound'];

const catalog = readJson(p('data', 'catalog.json'));
if (!catalog) { console.error('нет data/catalog.json — сначала `npm run data`'); process.exit(1); }
const used = readJson(p('data', 'used.json'), {pairs: [], items: {}});
const usedPairs = new Set(used.pairs);

const pairKey = (a, b) => [a.hash, b.hash].sort().join(' || ');
const weight = (it) =>
  (it.knife ? 1 : it.popular ? 3.5 : 1) *
  (it.hype ? (cfg.pairing.hypeBias ?? 4) : 1) *
  (it.rarityTier >= 4 ? 2 : 1) *
  (it.price > 5000 ? 0.2 : 1);

function pickWeighted(pool) {
  const total = pool.reduce((s, i) => s + weight(i), 0);
  let r = Math.random() * total;
  for (const it of pool) { r -= weight(it); if (r <= 0) return it; }
  return pool[pool.length - 1];
}

/** Окно соотношения цен: первые раунды — лёгкие, последние — впритык. */
function ratioWindow(round, total) {
  const {minRatio, maxRatio} = cfg.pairing;
  const t = total === 1 ? 0 : round / (total - 1);          // 0 → 1
  const hi = maxRatio - (maxRatio - minRatio * 1.6) * t;    // сужаем сверху
  const lo = minRatio + (hi - minRatio) * 0.25 * (1 - t);
  return [lo, Math.max(hi, lo * 1.15)];
}

function buildRound(pool, roundIdx, taken) {
  const [lo, hi] = ratioWindow(roundIdx, ROUNDS);
  const wantTrap = Math.random() < cfg.pairing.trapChance;
  const wantSameWeapon = Math.random() < cfg.pairing.sameWeaponChance;
  const allowKnife = Math.random() < (cfg.pairing.knifeChance ?? 0.25);
  const scoped = allowKnife ? pool : pool.filter((i) => !i.knife);

  for (let attempt = 0; attempt < 400; attempt++) {
    const a = pickWeighted(scoped);
    if (taken.has(a.name)) continue;

    let cands = scoped.filter((b) => {
      if (b.name === a.name || taken.has(b.name)) return false;
      if ((used.items[b.hash] ?? 0) >= cfg.pairing.maxUsesPerItem) return false;
      const r = b.price > a.price ? b.price / a.price : a.price / b.price;
      if (r < lo || r > hi) return false;
      if (usedPairs.has(pairKey(a, b))) return false;
      return true;
    });
    if (!cands.length) continue;

    if (wantSameWeapon) {
      const same = cands.filter((b) => b.weapon === a.weapon);
      if (same.length) cands = same;
    }
    if (wantTrap) {
      // ловушка: более редкий/пафосный скин стоит ДЕШЕВЛЕ
      const traps = cands.filter((b) => {
        const cheaper = b.price < a.price ? b : a;
        const pricier = b.price < a.price ? a : b;
        return cheaper.rarityTier > pricier.rarityTier || (cheaper.knife && !pricier.knife);
      });
      if (traps.length) cands = traps;
    }

    const b = cands[Math.floor(Math.random() * cands.length)];
    const [x, y] = Math.random() < 0.5 ? [a, b] : [b, a];
    const cheaper = x.price < y.price ? x : y;
    const pricier = x.price < y.price ? y : x;
    return {
      a: slim(x), b: slim(y),
      answer: x.price > y.price ? 'a' : 'b',
      ratio: Number((pricier.price / cheaper.price).toFixed(2)),
      trap: cheaper.rarityTier > pricier.rarityTier || (cheaper.knife && !pricier.knife),
    };
  }
  return null;
}

const slim = (i) => ({
  hash: i.hash, name: i.name, weapon: i.weapon, pattern: i.pattern, wear: i.wear,
  wearShort: i.wearShort, rarity: i.rarity, color: i.color, knife: i.knife, hype: i.hype, price: Number(i.price.toFixed(2)),
  image: i.image,
});

/**
 * Приманка в том же «стиле», что и настоящая цена: на экране до $100 видны
 * копейки — значит и у приманок они должны быть, а выше $100 — целые, но не
 * круглые. Иначе правильный ответ вычисляется по виду числа, а не по знанию цен.
 */
function decoyPrice(v) {
  if (v >= 1000) {
    let n = Math.round(v);
    if (n % 100 === 0) n += 7 + Math.floor(Math.random() * 40);
    return n;
  }
  if (v >= 100) {
    let n = Math.round(v);
    if (n % 10 === 0) n += 1 + Math.floor(Math.random() * 8);
    return n;
  }
  return Number((Math.floor(v) + (1 + Math.floor(Math.random() * 98)) / 100).toFixed(2));
}

/** Как цена будет выглядеть на экране — по этому и сравниваем варианты. */
const shownAs = (v) => (v >= 1000 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(2));

/** «Угадай цену»: один скин, три варианта. Разброс вариантов сужается к концу ролика. */
function buildPriceRound(pool, roundIdx, taken) {
  const t = ROUNDS === 1 ? 0 : roundIdx / (ROUNDS - 1);
  const spread = 3.0 - 1.4 * t;                      // ранние раунды: варианты далеко, поздние: впритык
  const allowKnife = Math.random() < (cfg.pairing.knifeChance ?? 0.25);
  const scoped = allowKnife ? pool : pool.filter((i) => !i.knife);

  for (let attempt = 0; attempt < 200; attempt++) {
    const item = pickWeighted(scoped);
    if (taken.has(item.name)) continue;
    const jitter = () => spread * (0.85 + Math.random() * 0.3);
    const real = Number(item.price.toFixed(2));
    const low = decoyPrice(real / jitter());
    const high = decoyPrice(real * jitter());
    if (low <= 0) continue;
    const seen = new Set([real, low, high].map(shownAs));
    if (seen.size < 3) continue;                     // на экране две одинаковые цены — переигрываем
    const options = shuffle([
      {value: real, correct: true},
      {value: low, correct: false},
      {value: high, correct: false},
    ]);
    return {
      item: slim(item),
      options: options.map((o) => o.value),
      answer: options.findIndex((o) => o.correct),
    };
  }
  return null;
}

/** «Что лишнее»: два скина из одной ценовой лиги + один из другой. */
function buildOddRound(pool, roundIdx, taken) {
  const t = ROUNDS === 1 ? 0 : roundIdx / (ROUNDS - 1);
  const gapLo = 5.5 - 2.5 * t;                       // ранние: лишний в 5.5–9x, поздние: в 3–5x
  const gapHi = gapLo * 1.6;
  const allowKnife = Math.random() < (cfg.pairing.knifeChance ?? 0.25);
  const scoped = allowKnife ? pool : pool.filter((i) => !i.knife);

  for (let attempt = 0; attempt < 400; attempt++) {
    const a = pickWeighted(scoped);
    if (taken.has(a.name)) continue;
    const mates = scoped.filter((b) => {
      if (b.name === a.name || taken.has(b.name) || b.weapon === a.weapon) return false;
      const r = Math.max(a.price, b.price) / Math.min(a.price, b.price);
      return r <= 1.22;                              // пара должна читаться как «почти одна цена»
    });
    if (!mates.length) continue;
    const b = mates[Math.floor(Math.random() * mates.length)];
    const mid = Math.sqrt(a.price * b.price);
    const dearer = Math.random() < 0.5;              // лишний дороже или дешевле лиги
    const odds = scoped.filter((c) => {
      if (c.name === a.name || c.name === b.name || taken.has(c.name)) return false;
      if (c.weapon === a.weapon || c.weapon === b.weapon) return false;
      const r = dearer ? c.price / mid : mid / c.price;
      return r >= gapLo && r <= gapHi;
    });
    if (!odds.length) continue;
    const odd = odds[Math.floor(Math.random() * odds.length)];
    const items = shuffle([slim(a), slim(b), slim(odd)]);
    return {
      items,
      answer: items.findIndex((i) => i.hash === odd.hash),
      ratio: Number((dearer ? odd.price / mid : mid / odd.price).toFixed(2)),
      dearer,
    };
  }
  return null;
}

/**
 * «Угадай скин по зуму»: показываем сильно увеличенный кусок текстуры.
 * Кроп делает сама сцена (масштаб + смещение картинки), поэтому обработка
 * изображений тут не нужна — только выбираем точку и силу увеличения.
 */
function buildZoomRound(pool, roundIdx, taken) {
  const t = ROUNDS === 1 ? 0 : roundIdx / (ROUNDS - 1);
  const zoom = 3.2 + 3.3 * t;                        // к финалу почти пиксели
  const scoped = pool.filter((i) => i.popular || i.hype || i.knife);

  for (let attempt = 0; attempt < 200; attempt++) {
    const item = pickWeighted(scoped.length > 60 ? scoped : pool);
    if (taken.has(item.name)) continue;
    // варианты — из той же категории, иначе ответ считывается по силуэту оружия
    const mates = shuffle(pool.filter((o) => o.name !== item.name && o.weapon !== item.weapon &&
      o.category === item.category && !taken.has(o.name))).slice(0, 2);
    if (mates.length < 2) continue;

    const options = shuffle([item, ...mates]);
    return {
      item: slim(item),
      // точка кропа не у самого края: там часто пусто
      focus: {x: 0.3 + Math.random() * 0.4, y: 0.32 + Math.random() * 0.36},
      zoom: Number(zoom.toFixed(2)),
      options: options.map((o) => o.name),
      answer: options.findIndex((o) => o.name === item.name),
    };
  }
  return null;
}

/**
 * «Какая редкость»: варианты — соседние тиры, иначе слишком легко.
 *
 * Названия тиров берутся из самого каталога, а не из своего списка: нумерация
 * там своя (tier 5 — это Covert, а не Classified), и захардкоженная таблица
 * незаметно давала бы неверные ответы.
 *
 * Ножи исключены: в каталоге они помечены Covert, хотя в игре у них отдельный
 * золотой тир, — вопрос получился бы спорным.
 */
function rarityLabels(items) {
  const byTier = {};
  for (const i of items) {
    if (i.knife || i.rarityTier == null || !i.rarity) continue;
    byTier[i.rarityTier] = i.rarity;
  }
  return byTier;
}

function buildRarityRound(pool, roundIdx, taken) {
  const labels = rarityLabels(catalog.items);
  const scoped = pool.filter((i) => !i.knife && labels[i.rarityTier]);
  if (scoped.length < 10) return null;

  for (let attempt = 0; attempt < 200; attempt++) {
    const item = pickWeighted(scoped);
    if (taken.has(item.name)) continue;
    const tier = item.rarityTier;

    const near = [tier - 2, tier - 1, tier + 1, tier + 2].filter((x) => labels[x]);
    const wrong = shuffle(near).slice(0, 2);
    if (wrong.length < 2) continue;

    const options = shuffle([tier, ...wrong]);
    return {
      item: slim(item),
      options: options.map((x) => labels[x]),
      answer: options.findIndex((x) => x === tier),
    };
  }
  return null;
}

/**
 * «Угадай оружие по звуку»: играет выстрел, три ствола на выбор.
 * Варианты подбираются из одного класса (винтовки к винтовкам), иначе
 * пистолет на фоне AWP слышно за версту и угадывать нечего.
 */
const WEAPON_CLASS = {
  ak47: 'rifle', m4a1: 'rifle', m4a1_silencer: 'rifle', famas: 'rifle',
  galilar: 'rifle', aug: 'rifle', sg556: 'rifle',
  awp: 'sniper', ssg08: 'sniper', scar20: 'sniper', g3sg1: 'sniper',
  p90: 'smg', bizon: 'smg', mac10: 'smg', mp7: 'smg', mp9: 'smg', ump45: 'smg', mp5sd: 'smg',
  nova: 'heavy', xm1014: 'heavy', sawedoff: 'heavy', mag7: 'heavy', m249: 'heavy', negev: 'heavy',
  deagle: 'pistol', revolver: 'pistol', glock18: 'pistol', hkp2000: 'pistol', usp_silencer: 'pistol',
  p250: 'pistol', cz75a: 'pistol', fiveseven: 'pistol', tec9: 'pistol', elite: 'pistol',
};
function buildSoundRound(_pool, roundIdx, taken) {
  const db = readJson(p('data', 'weapon-sounds.json'));
  if (!db?.sounds?.length) return null;

  for (let attempt = 0; attempt < 200; attempt++) {
    const pick = db.sounds[Math.floor(Math.random() * db.sounds.length)];
    if (taken.has(pick.key)) continue;
    const cls = WEAPON_CLASS[pick.key];
    const sameClass = db.sounds.filter((x) => x.key !== pick.key && WEAPON_CLASS[x.key] === cls);
    const mates = shuffle(sameClass.length >= 2 ? sameClass : db.sounds.filter((x) => x.key !== pick.key)).slice(0, 2);
    if (mates.length < 2) continue;

    const options = shuffle([pick, ...mates]);
    return {
      weapon: pick.key,
      file: pick.file,
      options: options.map((o) => o.label),
      answer: options.findIndex((o) => o.key === pick.key),
      key: pick.key,
    };
  }
  return null;
}

/** Все скины раунда — для учёта повторов и скачивания картинок. */
const roundItems = (round) => round.items ?? (round.item ? [round.item] : (round.a ? [round.a, round.b] : []));

/** Человеческое имя позиции: BombsiteA → «Bombsite A», CTSpawn → «CT Spawn». */
const spotLabel = (n) => n
  .replace(/([a-z])of([A-Z])/g, '$1 of $2')        // TopofMid → Top of Mid
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')          // BombsiteA → Bombsite A
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')       // CTSpawn → CT Spawn
  .replace(/\s+/g, ' ')
  .trim();

/**
 * «Где это?»: на радаре подсвечена зона, надо назвать позицию.
 * Названия и границы зон берутся из файлов самой CS2 (fetch-callouts.mjs),
 * поэтому ответ совпадает с тем, что игра пишет в киллфиде.
 */
function buildSpotRound(_pool, roundIdx, taken) {
  const db = readJson(p('data', 'callouts.json'));
  if (!db?.maps || !Object.keys(db.maps).length) return null;
  const maps = Object.entries(db.maps);

  for (let attempt = 0; attempt < 200; attempt++) {
    const [mapName, map] = maps[Math.floor(Math.random() * maps.length)];
    const usable = map.spots.filter((s) => !taken.has(`${mapName}:${s.name}`));
    if (usable.length < 3) continue;

    // к концу ролика берём зоны поменьше: их знают только те, кто реально играет
    const t = ROUNDS === 1 ? 0 : roundIdx / (ROUNDS - 1);
    const bySize = [...usable].sort((x, y) => y.w * y.h - x.w * x.h);
    const from = Math.floor(t * (bySize.length - 3));
    const answer = bySize[from + Math.floor(Math.random() * Math.min(4, bySize.length - from))];

    const others = shuffle(usable.filter((s) => s.name !== answer.name)).slice(0, 2);
    if (others.length < 2) continue;

    const options = shuffle([answer, ...others]);
    return {
      map: mapName,
      mapLabel: mapName.replace(/^de_|^cs_|^ar_/, '').replace(/^\w/, (c) => c.toUpperCase()),
      radar: map.radar,
      // доли от размера радара: сцена не знает про мировые координаты
      zone: {
        x: (answer.x - map.pos_x) / map.scale / 1024,
        y: (map.pos_y - answer.y) / map.scale / 1024,
        w: answer.w / map.scale / 1024,
        h: answer.h / map.scale / 1024,
      },
      options: options.map((s) => spotLabel(s.name)),
      answer: options.findIndex((s) => s.name === answer.name),
      key: `${mapName}:${answer.name}`,
    };
  }
  return null;
}

const HOOKS = {
  duel: [
    'Угадаешь хотя бы 3 из 5?',
    '90% ошибаются на последнем раунде',
    'Какой скин дороже? Проверь себя',
    'Считай очки — ответ в комменты',
    'Думаешь, знаешь цены в CS2?',
  ],
  price: [
    'Угадаешь цену хотя бы 3 скинов?',
    'Сколько стоит этот скин? 90% мимо',
    'Проверь, чувствуешь ли ты цены CS2',
  ],
  odd: [
    'Найди лишний скин — это сложнее, чем кажется',
    'Один из трёх — из другой лиги. Какой?',
    'Что лишнее? Финал валит почти всех',
  ],
  spot: [
    'Назовёшь все калауты? Проверим, сколько ты наиграл',
    'Где это на карте? Реальные калауты из игры',
    'Знаешь карты наизусть? Ну-ну',
  ],
};
const TAGS = ['#cs2','#кс2','#counterstrike2','#cs2skins','#скиныcs2','#викторина','#quiz','#кейсы','#csgo','#рек'];

/** Заголовки экранов под формат (перекрываются config.json → text). */
const FORMAT_TEXT = {
  duel: {},
  price: {introTitle: 'УГАДАЙ ЦЕНУ', introSubtitle: '{n} скинов · сколько угадаешь?'},
  odd: {introTitle: 'ЛИШНИЙ ПО ЦЕНЕ', introSubtitle: 'два скина стоят почти одинаково — найди третий'},
  spot: {introTitle: 'ГДЕ ЭТО?', introSubtitle: '{n} позиций · назови калаут'},
  zoom: {introTitle: 'ЧТО ЗА СКИН?', introSubtitle: '{n} раундов · узнай по кусочку'},
  rarity: {introTitle: 'КАКАЯ РЕДКОСТЬ?', introSubtitle: '{n} скинов · угадай тир'},
  sound: {introTitle: 'ЧТО ЗА СТВОЛ?', introSubtitle: '{n} выстрелов · угадай на слух'},
};

/** Поправки таймингов под формат (интро под опенинг задано в config → timing.intro). */
const FORMAT_TIMING = {
  duel: {},
  price: {},
  odd: {},
};

function caption(quiz) {
  const hook = rnd(HOOKS[quiz.format] ?? HOOKS.duel);
  const highlight =
    quiz.format === 'duel'
      ? `Самый сложный раунд: ${[...quiz.rounds].sort((r1, r2) => r1.ratio - r2.ratio)[0].a.name} против ${[...quiz.rounds].sort((r1, r2) => r1.ratio - r2.ratio)[0].b.name} 👀`
      : quiz.format === 'price'
        ? `Самый жирный лот: ${[...quiz.rounds].sort((r1, r2) => r2.item.price - r1.item.price)[0].item.name} 👀`
        : quiz.format === 'spot'
          ? `Карты в ролике: ${[...new Set(quiz.rounds.map((r) => r.mapLabel))].join(', ')} 👀`
          : `Самый хитрый раунд — последний 👀`;
  return [
    hook,
    highlight,
    `Сколько угадал? Пиши в комменты 👇`,
    '',
    `Цены: Steam Market на ${new Date(quiz.priceMeta.updatedAt ?? Date.now()).toLocaleDateString('ru-RU')}`,
    '',
    TAGS.join(' '),
  ].join('\n');
}

function makeOne(index) {
  const format = FORMAT_ARG === 'random' ? rnd(FORMATS) : FORMAT_ARG;
  if (!FORMATS.includes(format)) { console.error(`неизвестный формат «${format}» (есть: ${FORMATS.join(', ')}, random)`); process.exit(1); }
  const build = format === 'price' ? buildPriceRound
    : format === 'odd' ? buildOddRound
      : format === 'spot' ? buildSpotRound
        : format === 'zoom' ? buildZoomRound
          : format === 'rarity' ? buildRarityRound
            : format === 'sound' ? buildSoundRound : buildRound;

  const pool = catalog.items.filter((i) => (used.items[i.hash] ?? 0) < cfg.pairing.maxUsesPerItem);
  const taken = new Set();
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const round = build(pool, r, taken);
    if (!round) { warn(`раунд ${r + 1}: не нашёл подходящих вариантов, пропускаю`); continue; }
    for (const it of roundItems(round)) taken.add(it.name);
    if (round.key) taken.add(round.key);              // формат spot: карта + позиция
    rounds.push(round);
  }
  if (rounds.length < ROUNDS) warn(`собрано ${rounds.length}/${ROUNDS} раундов`);

  const stamp = new Date().toISOString().slice(0, 10);
  const id = arg('id', null) ?? `${stamp}-${String(index + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`;
  const quiz = {
    id, format, generatedAt: new Date().toISOString(),
    priceMeta: catalog.meta, symbol: cfg.display.symbol, rate: cfg.display.rate,
    timing: {...cfg.timing, ...FORMAT_TIMING[format]},
    text: {...cfg.text, ...FORMAT_TEXT[format]}, audio: cfg.audio, captions: cfg.captions, rounds,
  };
  quiz.caption = caption(quiz);
  quiz.narration = buildNarration(quiz);

  for (const r of rounds) {
    if (format === 'duel') usedPairs.add([r.a.hash, r.b.hash].sort().join(' || '));
    for (const it of roundItems(r)) used.items[it.hash] = (used.items[it.hash] ?? 0) + 1;
  }

  writeJson(p('out', 'quizzes', `${id}.json`), quiz);
  fs.mkdirSync(p('out', 'captions'), {recursive: true});
  fs.writeFileSync(p('out', 'captions', `${id}.txt`), quiz.caption);
  fs.mkdirSync(p('out', 'scripts'), {recursive: true});
  fs.writeFileSync(p('out', 'scripts', `${id}.txt`), narrationScript(quiz, cfg.video?.fps ?? 30));
  log(`викторина ${id} (${format}):`);
  for (const [n, r] of rounds.entries()) {
    if (format === 'duel') {
      log(`   ${n + 1}. ${r.a.name} ${r.a.wearShort} $${r.a.price}  vs  ${r.b.name} ${r.b.wearShort} $${r.b.price}  (x${r.ratio}${r.trap ? ', ловушка' : ''})`);
    } else if (format === 'price') {
      log(`   ${n + 1}. ${r.item.name} ${r.item.wearShort} $${r.item.price}  варианты: ${r.options.map((v, i) => `${'ABC'[i]}=$${v}${i === r.answer ? '✓' : ''}`).join(' ')}`);
    } else if (format === 'zoom') {
      log(`   ${n + 1}. ${r.item.name} (x${r.zoom})  ${r.options.map((v, i) => `${'ABC'[i]}=${v}${i === r.answer ? '✓' : ''}`).join('  ')}`);
    } else if (format === 'rarity') {
      log(`   ${n + 1}. ${r.item.name.padEnd(30)} ${r.options.map((v, i) => `${'ABC'[i]}=${v}${i === r.answer ? '✓' : ''}`).join('  ')}`);
    } else if (format === 'sound') {
      log(`   ${n + 1}. ${r.options.map((v, i) => `${'ABC'[i]}=${v}${i === r.answer ? '✓' : ''}`).join('  ')}`);
    } else if (format === 'spot') {
      log(`   ${n + 1}. ${r.mapLabel.padEnd(9)} ${r.options.map((v, i) => `${'ABC'[i]}=${v}${i === r.answer ? '✓' : ''}`).join('  ')}`);
    } else {
      log(`   ${n + 1}. ${r.items.map((it, i) => `${'ABC'[i]}: ${it.name} $${it.price}${i === r.answer ? ' ←лишний' : ''}`).join('  ')}`);
    }
  }
  return quiz;
}

const made = [];
for (let i = 0; i < COUNT; i++) made.push(makeOne(i));
used.pairs = [...usedPairs].slice(-20000);
writeJson(p('data', 'used.json'), used);
fs.writeFileSync(p('out', 'last-quiz-id.txt'), made[made.length - 1].id);
