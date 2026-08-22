/**
 * Собирает викторину: подбирает пары скинов так, чтобы вопрос был не очевидным,
 * но и не спорным. Пишет out/quizzes/<id>.json и out/captions/<id>.txt
 *
 *   node scripts/make-quiz.mjs [--rounds 5] [--id my-video] [--count 3]
 */
import fs from 'node:fs';
import {p, readJson, writeJson, config, log, warn, shuffle} from './lib.mjs';
import {buildNarration, narrationScript} from './narration.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();
const ROUNDS = Number(arg('rounds', cfg.roundsPerVideo));
const COUNT = Number(arg('count', 1));

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

const HOOKS = [
  'Угадаешь хотя бы 3 из 5?',
  '90% ошибаются на последнем раунде',
  'Какой скин дороже? Проверь себя',
  'Считай очки — ответ в комменты',
  'Думаешь, знаешь цены в CS2?',
];
const TAGS = ['#cs2','#кс2','#counterstrike2','#cs2skins','#скиныcs2','#викторина','#quiz','#кейсы','#csgo','#рек'];

function caption(quiz) {
  const hook = HOOKS[Math.floor(Math.random() * HOOKS.length)];
  const hardest = [...quiz.rounds].sort((r1, r2) => r1.ratio - r2.ratio)[0];
  return [
    hook,
    `Самый сложный раунд: ${hardest.a.name} против ${hardest.b.name} 👀`,
    `Сколько угадал? Пиши в комменты 👇`,
    '',
    `Цены: Steam Market на ${new Date(quiz.priceMeta.updatedAt ?? Date.now()).toLocaleDateString('ru-RU')}`,
    '',
    TAGS.join(' '),
  ].join('\n');
}

function makeOne(index) {
  const pool = catalog.items.filter((i) => (used.items[i.hash] ?? 0) < cfg.pairing.maxUsesPerItem);
  const taken = new Set();
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const round = buildRound(pool, r, taken);
    if (!round) { warn(`раунд ${r + 1}: не нашёл пару, пропускаю`); continue; }
    taken.add(round.a.name); taken.add(round.b.name);
    rounds.push(round);
  }
  if (rounds.length < ROUNDS) warn(`собрано ${rounds.length}/${ROUNDS} раундов`);

  const stamp = new Date().toISOString().slice(0, 10);
  const id = arg('id', null) ?? `${stamp}-${String(index + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`;
  const quiz = {
    id, generatedAt: new Date().toISOString(),
    priceMeta: catalog.meta, symbol: cfg.display.symbol, rate: cfg.display.rate,
    timing: cfg.timing, text: cfg.text, audio: cfg.audio, captions: cfg.captions, rounds,
  };
  quiz.caption = caption(quiz);
  quiz.narration = buildNarration(quiz);

  for (const r of rounds) {
    usedPairs.add([r.a.hash, r.b.hash].sort().join(' || '));
    used.items[r.a.hash] = (used.items[r.a.hash] ?? 0) + 1;
    used.items[r.b.hash] = (used.items[r.b.hash] ?? 0) + 1;
  }

  writeJson(p('out', 'quizzes', `${id}.json`), quiz);
  fs.mkdirSync(p('out', 'captions'), {recursive: true});
  fs.writeFileSync(p('out', 'captions', `${id}.txt`), quiz.caption);
  fs.mkdirSync(p('out', 'scripts'), {recursive: true});
  fs.writeFileSync(p('out', 'scripts', `${id}.txt`), narrationScript(quiz, cfg.video?.fps ?? 30));
  log(`викторина ${id}:`);
  for (const [n, r] of rounds.entries()) {
    log(`   ${n + 1}. ${r.a.name} ${r.a.wearShort} $${r.a.price}  vs  ${r.b.name} ${r.b.wearShort} $${r.b.price}  (x${r.ratio}${r.trap ? ', ловушка' : ''})`);
  }
  return quiz;
}

const made = [];
for (let i = 0; i < COUNT; i++) made.push(makeOne(i));
used.pairs = [...usedPairs].slice(-20000);
writeJson(p('data', 'used.json'), used);
fs.writeFileSync(p('out', 'last-quiz-id.txt'), made[made.length - 1].id);
