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
import {p, readJson, writeJson, log, rnd} from './lib.mjs';

const INTRO = [
  'Что дороже? Погнали!',
  'Угадай, что дороже!',
  'Знаешь цены в CS2? Проверим!',
];
const ROUND = [
  'Раунд {n}. Что дороже?',
  'Раунд {n}!',
];
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

function revealLine(round) {
  const side = round.answer === 'a' ? 'верхний' : 'нижний';
  const n = Math.round(round.ratio);
  const text = round.trap
    ? `Ловушка! Дороже ${side}.`
    : n >= 2
      ? `Дороже ${side} — ${times(n)}!`
      : `Дороже ${side}!`;
  return {text, alts: [`Дороже ${side}!`]};
}

export function buildNarration(quiz) {
  const t = quiz.timing;
  const rl = t.roundIn + t.countdown + t.reveal;
  const lines = [];

  lines.push({text: rnd(INTRO), alts: ['Что дороже?'], frame: 4, window: t.intro - 8});

  quiz.rounds.forEach((round, i) => {
    const start = t.intro + i * rl;
    const last = i === quiz.rounds.length - 1;
    const roundText = (last ? rnd(ROUND_LAST) : rnd(ROUND)).replace('{n}', String(i + 1));
    lines.push({
      text: roundText,
      alts: [`Раунд ${i + 1}!`],
      frame: start + 2,
      window: t.roundIn + t.countdown - 10,
    });
    const rv = revealLine(round);
    lines.push({...rv, frame: start + t.roundIn + t.countdown + 1, window: t.reveal - 5});
  });

  const outroStart = t.intro + quiz.rounds.length * rl;
  lines.push({text: rnd(OUTRO), alts: ['Пиши в комменты!'], frame: outroStart + 4, window: t.outro - 10});

  return lines;
}

// CLI: дописывает narration в существующий JSON викторины
if (process.argv[1] && process.argv[1].endsWith('narration.mjs')) {
  const file = process.argv[2] ??
    p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
  const quiz = readJson(file);
  if (!quiz) { console.error(`нет файла ${file}`); process.exit(1); }
  quiz.narration = buildNarration(quiz);
  writeJson(file, quiz);
  log(`narration: ${quiz.narration.length} реплик → ${file}`);
  for (const l of quiz.narration) log(`   кадр ${String(l.frame).padStart(4)}: ${l.text}`);
}
