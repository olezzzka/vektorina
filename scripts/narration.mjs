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
    {text: 'Ты тупее обезьяны, если этого не знаешь.', emotion: 'hype', alts: ['Не знаешь? Тупее обезьяны.']},
    {text: 'Ты вообще не играл в CS, если ответишь неправильно.', emotion: 'hype', alts: ['Значит ты в CS не играл!']},
    {text: 'Ты настоящий лох, если не ответишь на это.', emotion: 'hype', alts: ['Не ответишь, значит лох!']},
    {text: 'Не угадаешь — значит скины видел только на картинках.', emotion: 'hype', alts: ['Видел скины только на картинках?']},
    {text: 'Ответишь неправильно — и ты не игрок, а турист.', emotion: 'hype', alts: ['Значит ты тут турист!']},
    {text: 'Сольёшь это — тебе пора в шашки, а не в CS.', emotion: 'hype', alts: ['Сольёшь, иди играть в шашки!']},
    {text: 'Только конченый нуб не угадает первый раунд.', emotion: 'hype', alts: ['Только нуб сольёт первый раунд!']},
    {text: 'Ты десятый лвл фейсита, если угадаешь всё.', emotion: 'hype', alts: ['Угадаешь всё, значит десятый лвл!']},
    {text: 'Твоя собака угадает лучше тебя. Проверим?', emotion: 'hype', alts: ['Собака угадает лучше тебя!']},
    {text: 'Девяносто процентов сливаются на последнем раунде.', emotion: 'hype', alts: ['Девяносто процентов сольются!']},
    {text: 'Не угадаешь — удаляй CS, блядь, честное слово.', emotion: 'hype', nsfw: true, alts: ['Не угадаешь, удаляй CS!']},
    {text: 'Скинов на тысячу долларов, а цены не знаешь?', emotion: 'hype', alts: ['А цены-то знаешь?']},
    {text: 'Тут даже сильвер угадает. Или нет?', emotion: 'hype', alts: ['Даже сильвер угадает!']},
    {text: 'Семь из семи — и ты шаришь за скины сильнее меня.', emotion: 'hype', alts: ['Семь из семи, и ты шаришь!']},
    {text: 'Сольёшь — твой инвентарь тебя не уважает.', emotion: 'hype', alts: ['Сольёшь, и инвентарь тебя не уважает!']},
  ],
  duel: [
    {text: 'Ты тупее своей собаки, если не угадаешь это.', emotion: 'hype', alts: ['Не угадаешь, совсем плохо!']},
    {text: 'Половина зрителей ошибётся уже на первом.', emotion: 'hype', alts: ['Половина ошибётся на первом!']},
  ],
  price: [
    {text: 'Не угадаешь цену — ты кейсы вообще открывал?', emotion: 'hype', alts: ['Ты кейсы вообще открывал?']},
    {text: 'Назови цену на глаз. Ну давай, докажи.', emotion: 'hype', alts: ['Назови цену на глаз!']},
  ],
  odd: [
    {text: 'Найдёшь лишний — реально шаришь за цены.', emotion: 'hype', alts: ['Найдёшь лишний, значит шаришь!']},
    {text: 'Один тут вообще не из той лиги. Видишь его?', emotion: 'hype', alts: ['Один тут не из той лиги!']},
  ],
  zoom: [
    {text: 'Узнаешь скин по одному пикселю? Погнали.', emotion: 'hype', alts: ['Узнаешь скин по пикселю?']},
    {text: 'Тут по кусочку. Настоящие задроты угадают все.', emotion: 'hype', alts: ['Задроты угадают все!']},
  ],
  rarity: [
    {text: 'Отличишь ковёрт от рестрикта? Сомневаюсь.', emotion: 'hype', alts: ['Отличишь ковёрт от рестрикта?']},
    {text: 'Цвет я спрятал. Теперь угадай редкость.', emotion: 'hype', alts: ['Цвет спрятан. Угадай редкость!']},
  ],
  sound: [
    {text: 'Узнаешь ствол по выстрелу? Надевай наушники.', emotion: 'hype', alts: ['Узнаешь ствол по выстрелу?']},
    {text: 'Тысячи часов в CS — а на слух угадаешь?', emotion: 'hype', alts: ['А на слух угадаешь?']},
  ],
  spot: [
    {text: 'Не назовёшь калауты — ты в CS турист.', emotion: 'hype', nsfw: false, alts: ['Не назовёшь калауты, значит турист!']},
    {text: 'Знаешь карты наизусть? Сейчас проверим.', emotion: 'hype', alts: ['Знаешь карты наизусть?']},
    {text: 'Смотри на подсвеченную зону и называй место.', emotion: 'hype', alts: ['Называй подсвеченное место!']},
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

/**
 * Текст для экрана. В репликах часть слов записана «как слышится», иначе
 * синтезатор читает их неверно, — но в субтитрах такое выглядит криво,
 * поэтому на показ возвращаем нормальное написание.
 */
const SPEECH_FIX = [
  // тире синтезатор проговаривает вслух — меняем на запятую: пауза та же,
  // а лишнего слова в реплике не появляется
  [/\s*[—–]\s*/g, ', '],
  [/\.{2,}/g, ','],                       // многоточие читается как «точка точка точка»
  [/\bCS\s*2\b/gi, 'кэ-эс два'],
  [/\bCS\b/gi, 'кэ-эс'],
  [/\bкс\s*2\b/gi, 'кэ-эс два'],
  [/\bкс\b/gi, 'кэ-эс'],
  [/\bлвл\b/gi, 'лэвэл'],
  [/\bфейсит/gi, 'фэйсит'],
  [/\s{2,}/g, ' '],
];
export const speechText = (s) =>
  SPEECH_FIX.reduce((acc, [re, to]) => acc.replace(re, to), s).trim();

// на экран идёт исходный текст: правки нужны только синтезатору
export const displayText = (s) => s;

// числительные словами: синтезатор читает «в шесть раз» увереннее, чем «в 6 раз»
const NUM = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь',
  'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать', 'двадцать'];
const times = (n) => `в ${NUM[n] ?? n} раз${n >= 2 && n <= 4 ? 'а' : ''}`;

/**
 * Звуковые теги ElevenLabs v3: модель отыгрывает их голосом, а не зачитывает.
 * Без них реплики звучат ровно — а ровная подача в ленте не держит.
 * Другие движки тег игнорируют, на экран он тоже не попадает.
 */
const TAGS = {
  hype: ['excited', 'laughs', 'mischievously', 'shouts', 'laughs harder'],
  neutral: ['sarcastic', 'curious', 'mischievously'],
  warm: ['happy', 'laughs'],
};
const tagFor = (emotion, used) => {
  const pool = TAGS[emotion ?? 'neutral'] ?? TAGS.neutral;
  const fresh = pool.filter((t) => t !== used.lastTag);
  const tag = rnd(fresh.length ? fresh : pool);
  used.lastTag = tag;
  return tag;
};

// мат включается флагом narration.profanity в config; фразы с ним помечены nsfw
const allowNsfw = () => config()?.narration?.profanity !== false;

/** Берёт неиспользованную реплику: в ролике 3–4 ловушки подряд, повтор режет ухо. */
function pickFresh(pool, used) {
  const allowed = allowNsfw() ? pool : pool.filter((o) => !o.nsfw);
  let fresh = allowed.filter((o) => !used.has(o.text));
  if (!fresh.length) {
    // пул кончился — заходим на второй круг, но подряд одно и то же не даём:
    // раньше при коротком пуле одна фраза могла прозвучать три раза за ролик
    for (const o of allowed) used.delete(o.text);
    fresh = allowed.filter((o) => o.text !== used.lastText);
  }
  const choice = rnd(fresh.length ? fresh : allowed);
  used.add(choice.text);
  used.lastText = choice.text;
  return choice;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Реакция на реврил: комментируем факт, а не зачитываем букву с экрана. */
function revealLine(round, format, used) {
  if (format === 'zoom') {
    return pickFresh([
      {text: 'Вот он целиком.', emotion: 'neutral', alts: ['Вот он целиком.']},
      {text: 'Узнал? Значит наиграл.', emotion: 'hype', alts: ['Узнал?']},
      {text: 'А вот тут половина мимо.', emotion: 'hype', alts: ['Половина мимо!']},
      {text: 'Ебать, это же очевидно было.', emotion: 'hype', nsfw: true, alts: ['Это же очевидно!']},
      {text: 'Не угадал — не расстраивайся.', emotion: 'neutral', alts: ['Не угадал? Бывает.']},
      {text: 'Блядь, ну по текстуре же видно.', emotion: 'hype', nsfw: true, alts: ['По текстуре же видно!']},
      {text: 'Сука, а вблизи и не узнать.', emotion: 'hype', nsfw: true, alts: ['Вблизи его и не узнаешь!']},
      {text: 'Вот такой он под лупой.', emotion: 'neutral', alts: ['Вот такой он вблизи.']},
      {text: 'Кто угадал — тот красавчик.', emotion: 'hype', alts: ['Кто угадал, тот красавчик!']},
      {text: 'Хуй там угадаешь с такого куска.', emotion: 'hype', nsfw: true, alts: ['С такого куска хрен угадаешь!']},
    ], used);
  }
  if (format === 'rarity') {
    return pickFresh([
      {text: 'Вот и цвет рамки.', emotion: 'hype', alts: ['Вот и цвет!']},
      {text: 'По виду вообще не скажешь.', emotion: 'neutral', alts: ['По виду не скажешь!']},
      {text: 'Тут многие валятся.', emotion: 'hype', alts: ['Тут многие валятся!']},
      {text: 'Ебать, а выглядит дешевле.', emotion: 'hype', nsfw: true, alts: ['А выглядит дешевле!']},
      {text: 'Не угадал? Ну и хуй с ним.', emotion: 'hype', nsfw: true, alts: ['Не угадал? Бывает.']},
      {text: 'Тайное — это самый топ, если что.', emotion: 'neutral', alts: ['Тайное это самый топ.']},
      {text: 'Сука, обманчивая штука.', emotion: 'hype', nsfw: true, alts: ['Обманчивая штука!']},
      {text: 'Внешность тут вообще не помощник.', emotion: 'neutral', alts: ['Внешность не помощник.']},
      {text: 'Блядь, а я думал наоборот.', emotion: 'hype', nsfw: true, alts: ['А я думал наоборот!']},
      {text: 'Вот так вот, запоминай.', emotion: 'neutral', alts: ['Запоминай.']},
    ], used);
  }
  if (format === 'sound') {
    return pickFresh([
      {text: 'Слышно же, да?', emotion: 'hype', alts: ['Слышно же!']},
      {text: 'На слух это отдельный скилл.', emotion: 'neutral', alts: ['Это отдельный скилл.']},
      {text: 'Не угадал — играй с наушниками.', emotion: 'hype', alts: ['Играй с наушниками!']},
      {text: 'Ветераны такое с полвыстрела ловят.', emotion: 'hype', alts: ['Ветераны ловят сразу!']},
      {text: 'Ебать, ну это же очевидно.', emotion: 'hype', nsfw: true, alts: ['Это же очевидно!']},
      {text: 'Спутал? Они реально похожи.', emotion: 'neutral', alts: ['Они похожи, бывает.']},
      {text: 'Вот так он и звучит, блядь.', emotion: 'hype', nsfw: true, alts: ['Вот так и звучит!']},
      {text: 'Тысячи часов, а не узнал?', emotion: 'hype', alts: ['Тысячи часов, и всё равно мимо?']},
      {text: 'Сука, по звуку сложнее всего.', emotion: 'hype', nsfw: true, alts: ['По звуку сложнее всего!']},
      {text: 'Уши не обманешь.', emotion: 'neutral', alts: ['Уши не обманешь.']},
    ], used);
  }
  if (format === 'spot') {
    return pickFresh([
      {text: 'Ну это же элементарно.', emotion: 'hype', alts: ['Элементарно!']},
      {text: 'Не угадал? Мало катал.', emotion: 'hype', alts: ['Значит мало катал!']},
      {text: 'Тут половина зала мимо.', emotion: 'hype', alts: ['Половина мимо!']},
      {text: 'Кто играл — тот знает.', emotion: 'neutral', alts: ['Кто играл, тот знает.']},
      {text: 'Вот оно, это место.', emotion: 'neutral', alts: ['Вот оно!']},
      {text: 'Ебать, ты вообще карты видел?', emotion: 'hype', nsfw: true, alts: ['Карты вообще видел?']},
      {text: 'Блядь, это же база.', emotion: 'hype', nsfw: true, alts: ['Это же база!']},
      {text: 'Сюда бегают каждую катку.', emotion: 'neutral', alts: ['Сюда бегают каждую катку.']},
      {text: 'Сука, а на радаре и не узнать.', emotion: 'hype', nsfw: true, alts: ['На радаре не узнать!']},
      {text: 'Запомни, пригодится.', emotion: 'neutral', alts: ['Запомни, пригодится.']},
    ], used);
  }
  if (format === 'price') {
    const price = round.options[round.answer];
    if (price >= 500) return pickFresh([
      {text: 'Ебать, вот это ценник!', emotion: 'hype', nsfw: true, alts: ['Вот это ценник!']},
      {text: 'Столько за один скин, лол.', emotion: 'hype', alts: ['И это за один скин!']},
      {text: 'Дороже твоего компа, сука.', emotion: 'hype', nsfw: true, alts: ['Дороже целого компа!']},
      {text: 'Вот это ценник, я не шучу.', emotion: 'hype', alts: ['Вот это ценник!']},
      {text: 'За такие деньги можно жить месяц.', emotion: 'hype', alts: ['На это можно жить месяц!']},
      {text: 'Блядь, кто это вообще покупает?', emotion: 'hype', nsfw: true, alts: ['Кто это покупает?']},
    ], used);
    if (price <= 50) return pickFresh([
      {text: 'Копейки, лол.', emotion: 'hype', alts: ['Копейки!']},
      {text: 'Дешёвка, а выглядит дорого.', emotion: 'neutral', alts: ['Дешёвка!']},
      {text: 'И это всё? Ну такое.', emotion: 'neutral', alts: ['И это всё?']},
      {text: 'За такие деньги — норм.', emotion: 'neutral', alts: ['За такие деньги норм.']},
      {text: 'Ебать, дешевле обеда.', emotion: 'hype', nsfw: true, alts: ['Дешевле обеда!']},
    ], used);
    return pickFresh([
      {text: 'Вот столько. Угадал?', emotion: 'hype', alts: ['Угадал?']},
      {text: 'Мимо? Бывает, лол.', emotion: 'neutral', alts: ['Мимо?']},
      {text: 'Ни больше ни меньше.', emotion: 'neutral', alts: ['Вот столько.']},
      {text: 'Ну как, близко было?', emotion: 'hype', alts: ['Близко было?']},
      {text: 'Блядь, вечно мимо угадывают.', emotion: 'hype', nsfw: true, alts: ['Вечно мимо!']},
      {text: 'Средний ценник, ничего особенного.', emotion: 'neutral', alts: ['Средний ценник.']},
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
      {text: 'Блядь, а по виду не скажешь.', emotion: 'hype', nsfw: true, alts: ['По виду не скажешь!']},
      {text: 'Сука, вот он и выбивается.', emotion: 'hype', nsfw: true, alts: ['Вот он и выбивается!']},
      {text: 'Двое почти вровень, третий улетел.', emotion: 'neutral', alts: ['Третий улетел!']},
      {text: 'Тут надо чувствовать цены.', emotion: 'neutral', alts: ['Надо чувствовать цены.']},
    ], used);
  }

  if (round.trap) return pickFresh([
    {text: 'Ебать, попался?', emotion: 'hype', nsfw: true, alts: ['Попался?']},
    {text: 'Классика, блядь.', emotion: 'hype', nsfw: true, alts: ['Классика!']},
    {text: 'На это ведутся все подряд, каждый раз.', emotion: 'hype', alts: ['На это ведутся все подряд!']},
    {text: 'Красивый — не значит дорогой, запомни.', emotion: 'neutral', alts: ['Красивый не значит дорогой!']},
    {text: 'Ну и как, повёлся?', emotion: 'hype', alts: ['Повёлся?']},
    {text: 'Тут половина уже слилась.', emotion: 'hype', alts: ['Половина слилась!']},
    {text: 'Сука, как всегда обманка.', emotion: 'hype', nsfw: true, alts: ['Как всегда обманка!']},
    {text: 'Развели тебя, признай.', emotion: 'hype', alts: ['Развели тебя!']},
    {text: 'Блядь, ну кто так думал?', emotion: 'hype', nsfw: true, alts: ['Кто так думал?']},
    {text: 'Редкость и цена — разные вещи.', emotion: 'neutral', alts: ['Редкость это ещё не цена.']},
  ], used);
  if (n >= 5) return pickFresh([
    {text: 'Нихуя себе разрыв!', emotion: 'hype', nsfw: true, alts: ['Вот это разрыв!']},
    {text: `Разрыв ${gap}, ебать.`, emotion: 'hype', nsfw: true, alts: [`${cap(gap)}!`]},
    {text: 'Это просто разъёб.', emotion: 'hype', nsfw: true, alts: ['Разъёб!']},
    {text: 'Даже рядом не стояли.', emotion: 'hype', alts: ['Не стояли рядом!']},
    {text: 'Сука, вот это пропасть.', emotion: 'hype', nsfw: true, alts: ['Вот это пропасть!']},
    {text: 'Разница конская.', emotion: 'hype', alts: ['Разница конская!']},
    {text: 'В хлам разнесло по цене.', emotion: 'hype', alts: ['В хлам разнесло!']},
  ], used);
  if (n >= 2) return pickFresh([
    {text: `${cap(gap)}. Норм разница.`, emotion: 'neutral', alts: [`Разница ${gap}.`]},
    {text: `Разница ${gap}, чуешь?`, emotion: 'hype', alts: [`Разница ${gap}!`]},
    {text: 'Ощутимо дороже.', emotion: 'neutral', alts: ['Ощутимо дороже.']},
    {text: 'Разрыв заметный, блядь.', emotion: 'hype', nsfw: true, alts: ['Разрыв заметный!']},
    {text: 'Прилично так дороже.', emotion: 'neutral', alts: ['Прилично дороже.']},
    {text: 'Разница есть, и немаленькая.', emotion: 'neutral', alts: ['Разница немаленькая.']},
  ], used);
  return pickFresh([
    {text: 'Впритык, сука.', emotion: 'hype', nsfw: true, alts: ['Впритык!']},
    {text: 'Чуть-чуть не дотянул?', emotion: 'hype', alts: ['Чуть не дотянул?']},
    {text: 'Тут реально сложно было.', emotion: 'neutral', alts: ['Тут было сложно!']},
    {text: 'Почти вровень, ебать.', emotion: 'hype', nsfw: true, alts: ['Почти вровень!']},
    {text: 'Разрыв копеечный.', emotion: 'neutral', alts: ['Разрыв копеечный.']},
    {text: 'На волосок разошлись.', emotion: 'neutral', alts: ['На волосок!']},
  ], used);
}

export function buildNarration(quiz) {
  const format = quiz.format ?? 'duel';
  const t = quiz.timing;
  const rl = t.roundIn + t.countdown + t.reveal;
  const lines = [];
  const usedReactions = new Set();
  const usedNext = new Set();

  // опенинг: общий пул + крючки под формат. Форматным даём вес побольше —
  // они заодно объясняют правило («один тут не из той лиги»), а для odd
  // и price это единственное место, где правило звучит голосом.
  const hookPool = [...HOOKS.any, ...Array(4).fill(HOOKS[format] ?? []).flat()];
  lines.push({...rnd(hookPool), frame: 4, window: t.intro - 8});

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

  for (const l of lines) {
    l.display = displayText(l.text);
    if (!l.tag) l.tag = tagFor(l.emotion, usedReactions);
  }
  return lines;
}

/** Текст диктора с таймкодами — для ручной записи озвучки. */
export function narrationScript(quiz, fps) {
  const ts = (frames) => {
    const s = frames / fps;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };
  const rows = quiz.narration.map((l) =>
    `${ts(l.frame)}–${ts(l.frame + l.window)}  ${l.display ?? l.text}`);
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
