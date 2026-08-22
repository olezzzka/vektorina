/**
 * Реплики озвучки с точной привязкой к кадрам.
 * Запись: {text, alts, emotion, frame, window} — text идёт в субтитры и TTS,
 * alts — укороченные варианты, если фраза не влезает в окно,
 * emotion — подсказка движку синтеза: hype (заводится), neutral, warm.
 *
 * На реврите диктор НЕ называет букву ответа: она видна на экране и подсвечена
 * цветом, а проговаривание вслух звучит как робот-зачитыватель. Вместо этого —
 * живая реакция на факт: масштаб разрыва, сработавшая ловушка, размер ценника.
 *
 * CLI (добавить реплики в готовый JSON): node scripts/narration.mjs out/quizzes/<id>.json
 */
import fs from 'node:fs';
import {p, readJson, writeJson, config, log, rnd} from './lib.mjs';

/**
 * Опенинг — первая секунда ролика, от неё зависит досмотр. Задача: задеть,
 * а не описать. Числа словами: синтезатор читает их увереннее цифр.
 * Реплика идёт и в озвучку, и в субтитры — половина зрителей смотрит без звука.
 */
const HOOKS = {
  any: [
    {text: 'Ты десятый лэвэл фейсита, если угадаешь всё.', emotion: 'hype', alts: ['Угадаешь всё — ты десятый лэвэл!']},
    {text: 'Твоя собака угадает лучше тебя. Проверим?', emotion: 'hype', alts: ['Собака угадает лучше тебя!']},
    {text: 'Девяносто процентов сливаются на последнем раунде.', emotion: 'hype', alts: ['Девяносто процентов сольются!']},
    {text: 'Не угадаешь — удаляй кэ-эс, честное слово.', emotion: 'hype', alts: ['Не угадаешь — удаляй кэ-эс!']},
    {text: 'Скинов на тысячу долларов, а цены не знаешь?', emotion: 'hype', alts: ['А цены-то знаешь?']},
    {text: 'Тут даже сильвер угадает. Или нет?', emotion: 'hype', alts: ['Даже сильвер угадает!']},
    {text: 'Семь из семи — и ты шаришь за скины сильнее меня.', emotion: 'hype', alts: ['Семь из семи — и ты шаришь!']},
    {text: 'Сольёшь — твой инвентарь тебя не уважает.', emotion: 'hype', alts: ['Сольёшь — инвентарь не уважает!']},
  ],
  duel: [
    {text: 'Ты тупее своей собаки, если не угадаешь это.', emotion: 'hype', alts: ['Не угадаешь — совсем плохо!']},
    {text: 'Половина зрителей ошибётся уже на первом.', emotion: 'hype', alts: ['Половина ошибётся на первом!']},
  ],
  price: [
    {text: 'Не угадаешь цену — ты кейсы вообще открывал?', emotion: 'hype', alts: ['Ты кейсы вообще открывал?']},
    {text: 'Назови цену на глаз. Ну давай, докажи.', emotion: 'hype', alts: ['Назови цену на глаз!']},
  ],
  odd: [
    {text: 'Найдёшь лишний — реально шаришь за цены.', emotion: 'hype', alts: ['Найдёшь лишний — шаришь!']},
    {text: 'Один тут вообще не из той лиги. Видишь его?', emotion: 'hype', alts: ['Один тут не из той лиги!']},
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
  {text: 'Сколько угадал? Пиши в комменты и подпишись!', emotion: 'warm'},
  {text: 'Пиши в комменты, сколько угадал!', emotion: 'warm'},
];

// числительные словами: синтезатор читает «в шесть раз» увереннее, чем «в 6 раз»
const NUM = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь',
  'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать', 'двадцать'];
const times = (n) => `в ${NUM[n] ?? n} раз${n >= 2 && n <= 4 ? 'а' : ''}`;

/** Берёт неиспользованную реплику: в ролике 3–4 ловушки подряд, повтор режет ухо. */
function pickFresh(pool, used) {
  const fresh = pool.filter((o) => !used.has(o.text));
  const choice = rnd(fresh.length ? fresh : pool);
  used.add(choice.text);
  return choice;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Реакция на реврил: комментируем факт, а не зачитываем букву с экрана. */
function revealLine(round, format, used) {
  if (format === 'price') {
    const price = round.options[round.answer];
    if (price >= 500) return pickFresh([
      {text: 'Ого, вот это ценник!', emotion: 'hype', alts: ['Вот это ценник!']},
      {text: 'Столько и стоит. Неплохо, да?', emotion: 'hype', alts: ['Вот его цена!']},
      {text: 'Дороже, чем весь твой инвентарь?', emotion: 'hype', alts: ['Дороже инвентаря!']},
    ], used);
    if (price <= 50) return pickFresh([
      {text: 'Всего ничего!', emotion: 'hype', alts: ['Дешёвка!']},
      {text: 'Дешевле, чем кажется.', emotion: 'neutral', alts: ['Дешевле, чем кажется.']},
      {text: 'Копейки. А выглядит дорого.', emotion: 'neutral', alts: ['Копейки!']},
    ], used);
    return pickFresh([
      {text: 'Вот его настоящая цена.', emotion: 'neutral', alts: ['Вот его цена.']},
      {text: 'Ни больше ни меньше.', emotion: 'neutral', alts: ['Вот столько.']},
      {text: 'Угадал? Ставь плюс.', emotion: 'hype', alts: ['Угадал?']},
      {text: 'Мимо? Бывает.', emotion: 'neutral', alts: ['Мимо?']},
    ], used);
  }

  const n = Math.round(round.ratio);
  const gap = times(n);

  if (format === 'odd') {
    const dir = round.dearer ? 'дороже' : 'дешевле';
    return pickFresh([
      {text: `Он ${dir} остальных ${gap}!`, emotion: 'hype', alts: [`${cap(dir)} ${gap}!`]},
      {text: `Вот кто выбивается — ${dir} ${gap}.`, emotion: 'neutral', alts: ['Вот кто выбивается.']},
      {text: 'Этот вообще из другой лиги!', emotion: 'hype', alts: ['Из другой лиги!']},
      {text: `Разница ${gap}. Заметил?`, emotion: 'neutral', alts: [`Разница ${gap}.`]},
    ], used);
  }

  if (round.trap) return pickFresh([
    {text: 'Ловушка сработала!', emotion: 'hype', alts: ['Ловушка!']},
    {text: 'Редкость — ещё не цена!', emotion: 'hype', alts: ['Редкость — не цена!']},
    {text: 'Вот на этом и попадаются.', emotion: 'neutral', alts: ['Классика!']},
    {text: 'Красивый — не значит дорогой.', emotion: 'neutral', alts: ['Красивый — не дорогой!']},
    {text: 'Обманка! Классика жанра.', emotion: 'hype', alts: ['Обманка!']},
  ], used);
  if (n >= 5) return pickFresh([
    {text: `Разрыв ${gap}!`, emotion: 'hype', alts: [`${cap(gap)}!`]},
    {text: 'Вот это пропасть!', emotion: 'hype', alts: ['Пропасть!']},
    {text: 'Даже близко не стояли.', emotion: 'hype', alts: ['Не стояли рядом!']},
  ], used);
  if (n >= 2) return pickFresh([
    {text: `Разница ${gap}.`, emotion: 'neutral', alts: [`Разница ${gap}.`]},
    {text: `Дороже ${gap}. Чувствуется?`, emotion: 'neutral', alts: [`Дороже ${gap}.`]},
    {text: 'Разрыв заметный.', emotion: 'neutral', alts: ['Разрыв заметный.']},
  ], used);
  return pickFresh([
    {text: 'Почти вровень — но нет!', emotion: 'hype', alts: ['Почти вровень!']},
    {text: 'Разрыв совсем небольшой.', emotion: 'neutral', alts: ['Разрыв небольшой.']},
    {text: 'Тут было сложно, признай.', emotion: 'neutral', alts: ['Тут было сложно!']},
  ], used);
}

export function buildNarration(quiz) {
  const format = quiz.format ?? 'duel';
  const t = quiz.timing;
  const rl = t.roundIn + t.countdown + t.reveal;
  const lines = [];
  const usedReactions = new Set();

  // опенинг: общий пул + пара крючков под конкретный формат
  lines.push({...rnd([...HOOKS.any, ...(HOOKS[format] ?? [])]), frame: 4, window: t.intro - 8});

  quiz.rounds.forEach((round, i) => {
    const start = t.intro + i * rl;
    const last = i === quiz.rounds.length - 1;
    const roundText = (last ? rnd(ROUND_LAST) : rnd(ROUND[format] ?? ROUND.duel)).replace('{n}', String(i + 1));
    lines.push({
      text: roundText,
      alts: [`Раунд ${i + 1}!`],
      emotion: last ? 'hype' : 'neutral',
      frame: start + 2,
      window: t.roundIn + t.countdown - 10,
    });
    const rv = revealLine(round, format, usedReactions);
    lines.push({...rv, frame: start + t.roundIn + t.countdown + 1, window: t.reveal - 5});
  });

  const outroStart = t.intro + quiz.rounds.length * rl;
  lines.push({alts: ['Пиши в комменты!'], ...rnd(OUTRO), frame: outroStart + 4, window: t.outro - 10});

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
