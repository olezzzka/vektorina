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
    {text: 'Ты тупее обезьяны, если этого не знаешь.', emotion: 'hype', alts: ['Тупее обезьяны, если не знаешь!']},
    {text: 'Ты вообще не играл в кэ-эс, если ответишь неправильно.', emotion: 'hype', alts: ['Ответишь неверно — ты не играл в кэ-эс!']},
    {text: 'Ты настоящий лох, если не ответишь на это.', emotion: 'hype', alts: ['Не ответишь — ты лох!']},
    {text: 'Не угадаешь — значит скины видел только на картинках.', emotion: 'hype', alts: ['Видел скины только на картинках?']},
    {text: 'Ответишь неправильно — ты фейковый кэ-эсер.', emotion: 'hype', alts: ['Ответишь неверно — ты фейк!']},
    {text: 'Сольёшь это — тебе пора в шашки, а не в кэ-эс.', emotion: 'hype', alts: ['Сольёшь — иди в шашки!']},
    {text: 'Только конченый нуб не угадает первый раунд.', emotion: 'hype', alts: ['Только нуб сольёт первый раунд!']},
    {text: 'Ты десятый лэвэл фейсита, если угадаешь всё.', emotion: 'hype', alts: ['Угадаешь всё — ты десятый лэвэл!']},
    {text: 'Твоя собака угадает лучше тебя. Проверим?', emotion: 'hype', alts: ['Собака угадает лучше тебя!']},
    {text: 'Девяносто процентов сливаются на последнем раунде.', emotion: 'hype', alts: ['Девяносто процентов сольются!']},
    {text: 'Не угадаешь — удаляй кэ-эс, блядь, честное слово.', emotion: 'hype', nsfw: true, alts: ['Не угадаешь — удаляй кэ-эс!']},
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
/**
 * Переход к следующему раунду. Номер раунда уже висит на экране («РАУНД 3/7»),
 * поэтому проговаривать его вслух незачем — это звучит как объявление на вокзале.
 * Часть раундов вообще идёт молча: пауза даёт музыке подняться и не утомляет.
 */
const NEXT = [
  {text: 'Дальше.', emotion: 'neutral'},
  {text: 'Погнали дальше.', emotion: 'hype'},
  {text: 'Следующий.', emotion: 'neutral'},
  {text: 'Едем дальше.', emotion: 'neutral'},
  {text: 'Го дальше.', emotion: 'hype'},
  {text: 'Так, а тут?', emotion: 'hype'},
  {text: 'Ладно, вот этот.', emotion: 'neutral'},
];
const ROUND_LAST = [
  {text: 'Последний. Не слейся.', emotion: 'hype', alts: ['Последний!']},
  {text: 'Финалка. Тут все и палятся.', emotion: 'hype', alts: ['Финалка!']},
  {text: 'Последний, самый жёсткий.', emotion: 'hype', alts: ['Последний!']},
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

// мат включается флагом narration.profanity в config; фразы с ним помечены nsfw
const allowNsfw = () => config()?.narration?.profanity !== false;

/** Берёт неиспользованную реплику: в ролике 3–4 ловушки подряд, повтор режет ухо. */
function pickFresh(pool, used) {
  const allowed = allowNsfw() ? pool : pool.filter((o) => !o.nsfw);
  const fresh = allowed.filter((o) => !used.has(o.text));
  const choice = rnd(fresh.length ? fresh : allowed);
  used.add(choice.text);
  return choice;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Реакция на реврил: комментируем факт, а не зачитываем букву с экрана. */
function revealLine(round, format, used) {
  if (format === 'price') {
    const price = round.options[round.answer];
    if (price >= 500) return pickFresh([
      {text: 'Ебать, вот это ценник!', emotion: 'hype', nsfw: true, alts: ['Вот это ценник!']},
      {text: 'Столько за один скин, лол.', emotion: 'hype', alts: ['За один скин!']},
      {text: 'Дороже твоего компа, сука.', emotion: 'hype', nsfw: true, alts: ['Дороже компа!']},
      {text: 'Вот это ценник, я не шучу.', emotion: 'hype', alts: ['Вот это ценник!']},
    ], used);
    if (price <= 50) return pickFresh([
      {text: 'Копейки, лол.', emotion: 'hype', alts: ['Копейки!']},
      {text: 'Дешёвка, а выглядит дорого.', emotion: 'neutral', alts: ['Дешёвка!']},
      {text: 'И это всё? Ну такое.', emotion: 'neutral', alts: ['И это всё?']},
    ], used);
    return pickFresh([
      {text: 'Вот столько. Угадал?', emotion: 'hype', alts: ['Угадал?']},
      {text: 'Мимо? Бывает, лол.', emotion: 'neutral', alts: ['Мимо?']},
      {text: 'Ни больше ни меньше.', emotion: 'neutral', alts: ['Вот столько.']},
      {text: 'Ну как, близко было?', emotion: 'hype', alts: ['Близко было?']},
    ], used);
  }

  const n = Math.round(round.ratio);
  const gap = times(n);

  if (format === 'odd') {
    const dir = round.dearer ? 'дороже' : 'дешевле';
    return pickFresh([
      {text: `Он ${dir} остальных ${gap}, ебать.`, emotion: 'hype', nsfw: true, alts: [`${cap(dir)} ${gap}!`]},
      {text: 'Этот вообще из другой лиги.', emotion: 'hype', alts: ['Из другой лиги!']},
      {text: `Вот кто тут лишний — ${dir} ${gap}.`, emotion: 'neutral', alts: ['Вот кто лишний.']},
      {text: `Разница ${gap}. Спалил его?`, emotion: 'hype', alts: [`Разница ${gap}!`]},
    ], used);
  }

  if (round.trap) return pickFresh([
    {text: 'Ебать, попался?', emotion: 'hype', nsfw: true, alts: ['Попался?']},
    {text: 'Классика, блядь.', emotion: 'hype', nsfw: true, alts: ['Классика!']},
    {text: 'На это ведутся вообще все.', emotion: 'hype', alts: ['На это ведутся все!']},
    {text: 'Красивый — не значит дорогой, запомни.', emotion: 'neutral', alts: ['Красивый — не дорогой!']},
    {text: 'Ну и как, повёлся?', emotion: 'hype', alts: ['Повёлся?']},
    {text: 'Тут половина уже слилась.', emotion: 'hype', alts: ['Половина слилась!']},
  ], used);
  if (n >= 5) return pickFresh([
    {text: 'Нихуя себе разрыв!', emotion: 'hype', nsfw: true, alts: ['Вот это разрыв!']},
    {text: `Разрыв ${gap}, ебать.`, emotion: 'hype', nsfw: true, alts: [`${cap(gap)}!`]},
    {text: 'Это просто разъёб.', emotion: 'hype', nsfw: true, alts: ['Разъёб!']},
    {text: 'Даже рядом не стояли.', emotion: 'hype', alts: ['Не стояли рядом!']},
  ], used);
  if (n >= 2) return pickFresh([
    {text: `${cap(gap)}. Норм разница.`, emotion: 'neutral', alts: [`Разница ${gap}.`]},
    {text: `Разница ${gap}, чуешь?`, emotion: 'hype', alts: [`Разница ${gap}!`]},
    {text: 'Ощутимо дороже.', emotion: 'neutral', alts: ['Ощутимо дороже.']},
  ], used);
  return pickFresh([
    {text: 'Впритык, сука.', emotion: 'hype', nsfw: true, alts: ['Впритык!']},
    {text: 'Чуть-чуть не дотянул?', emotion: 'hype', alts: ['Чуть не дотянул?']},
    {text: 'Тут реально сложно было.', emotion: 'neutral', alts: ['Тут было сложно!']},
  ], used);
}

export function buildNarration(quiz) {
  const format = quiz.format ?? 'duel';
  const t = quiz.timing;
  const rl = t.roundIn + t.countdown + t.reveal;
  const lines = [];
  const usedReactions = new Set();
  const usedNext = new Set();

  // опенинг: общий пул + пара крючков под конкретный формат
  lines.push({...rnd([...HOOKS.any, ...(HOOKS[format] ?? [])]), frame: 4, window: t.intro - 8});

  quiz.rounds.forEach((round, i) => {
    const start = t.intro + i * rl;
    const last = i === quiz.rounds.length - 1;
    // первый раунд идёт сразу после крючка — там без слов; дальше короткий
    // переход, и то не всегда: часть раундов молчит, чтобы не тараторить
    if (last || (i > 0 && Math.random() < 0.55)) {
      lines.push({
        ...pickFresh(last ? ROUND_LAST : NEXT, usedNext),
        frame: start + 2,
        window: t.roundIn + t.countdown - 10,
      });
    }
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
