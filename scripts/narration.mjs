/**
 * Реплики озвучки с точной привязкой к кадрам.
 * Каждая запись: {text, alts, frame, window} — text идёт в субтитры и TTS,
 * alts — запасные укороченные варианты, если фраза не влезает в окно.
 *
 * Пулы фраз намеренно маленькие: повторяющиеся реплики кэшируются
 * в data/tts-cache и озвучиваются один раз за всю жизнь проекта.
 *
 * CLI (добавить реплики в готовый JSON): node scripts/narration.mjs out/quizzes/<id>.json
 */
import fs from 'node:fs';
import {p, readJson, writeJson, config, log, rnd} from './lib.mjs';

const INTRO = {
  duel: [
    'Что дороже? Погнали!',
    'Угадай, что дороже!',
    'Знаешь цены в CS2? Проверим!',
  ],
  price: [
    'Угадай цену скина!',
    'Сколько это стоит? Погнали!',
  ],
  odd: [
    'Два скина стоят почти одинаково. Найди третий!',
    'Один из трёх выбивается по цене. Погнали!',
  ],
};
const ROUND = {
  duel: ['Раунд {n}. Что дороже?', 'Раунд {n}!'],
  price: ['Раунд {n}. Сколько стоит?', 'Раунд {n}!'],
  odd: ['Раунд {n}. Кто лишний по цене?', 'Раунд {n}!'],
};
const ROUND_LAST = [
  'Последний раунд. Самый сложный!',
  'Финальный раунд!',
];
const OUTRO = [
  'Сколько угадал? Пиши в комменты и подпишись!',
  'Пиши в комменты, сколько угадал!',
];

/** «в 3 раза» / «в 7 раз» */
const times = (n) => `в ${n} раз${n >= 2 && n <= 4 ? 'а' : ''}`;

// буква в тексте совпадает с меткой на экране, чтобы диктор читал то же самое
function revealLine(round, format) {
  if (format === 'price') {
    const letter = 'ABC'[round.answer];
    return {text: `Ответ — ${letter}!`, alts: [`${letter}!`]};
  }
  if (format === 'odd') {
    const letter = 'ABC'[round.answer];
    const n = Math.round(round.ratio);
    const dir = round.dearer ? 'дороже' : 'дешевле';
    const text = n >= 2 ? `Лишний — ${letter}, ${dir} ${times(n)}!` : `Лишний — ${letter}!`;
    return {text, alts: [`Лишний — ${letter}!`]};
  }
  const side = round.answer === 'a' ? 'A' : 'B';
  const n = Math.round(round.ratio);
  const text = round.trap
    ? `Ловушка! Дороже ${side}.`
    : n >= 2
      ? `Дороже ${side} — ${times(n)}!`
      : `Дороже ${side}!`;
  return {text, alts: [`Дороже ${side}!`]};
}

export function buildNarration(quiz) {
  const format = quiz.format ?? 'duel';
  const t = quiz.timing;
  const rl = t.roundIn + t.countdown + t.reveal;
  const lines = [];

  lines.push({text: rnd(INTRO[format] ?? INTRO.duel), alts: ['Погнали!'], frame: 4, window: t.intro - 8});

  quiz.rounds.forEach((round, i) => {
    const start = t.intro + i * rl;
    const last = i === quiz.rounds.length - 1;
    const roundText = (last ? rnd(ROUND_LAST) : rnd(ROUND[format] ?? ROUND.duel)).replace('{n}', String(i + 1));
    lines.push({
      text: roundText,
      alts: [`Раунд ${i + 1}!`],
      frame: start + 2,
      window: t.roundIn + t.countdown - 10,
    });
    const rv = revealLine(round, format);
    lines.push({...rv, frame: start + t.roundIn + t.countdown + 1, window: t.reveal - 5});
  });

  const outroStart = t.intro + quiz.rounds.length * rl;
  lines.push({text: rnd(OUTRO), alts: ['Пиши в комменты!'], frame: outroStart + 4, window: t.outro - 10});

  return lines;
}

/** Текст диктора с таймкодами — для ручной записи озвучки. */
export function narrationScript(quiz, fps) {
  const ts = (frames) => {
    const s = frames / fps;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };
  const rows = quiz.narration.map((l) =>
    `${ts(l.frame)}–${ts(l.frame + l.window)}  ${l.text}`);
  return [
    `Сценарий озвучки · ролик ${quiz.id}`,
    `Каждая реплика должна уложиться в свой интервал (начало–конец).`,
    '',
    ...rows,
    '',
  ].join('\n');
}

// CLI: дописывает narration в существующий JSON викторины
if (process.argv[1] && process.argv[1].endsWith('narration.mjs')) {
  const file = process.argv[2] ??
    p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
  const quiz = readJson(file);
  if (!quiz) { console.error(`нет файла ${file}`); process.exit(1); }
  quiz.narration = buildNarration(quiz);
  writeJson(file, quiz);
  const cfg = config();
  fs.mkdirSync(p('out', 'scripts'), {recursive: true});
  fs.writeFileSync(p('out', 'scripts', `${quiz.id}.txt`), narrationScript(quiz, cfg.video?.fps ?? 30));
  log(`narration: ${quiz.narration.length} реплик → ${file} + out/scripts/${quiz.id}.txt`);
  for (const l of quiz.narration) log(`   кадр ${String(l.frame).padStart(4)}: ${l.text}`);
}
