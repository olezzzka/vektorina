/**
 * Озвучка: каждая реплика из quiz.narration синтезируется отдельно и кладётся
 * точно на свой кадр. Рассинхрон невозможен по построению.
 *
 *   node scripts/voice.mjs [out/quizzes/<id>.json] [--engine silero|piper|elevenlabs]
 *
 * По умолчанию — silero: живее piper и умеет интонации (поле emotion у реплики
 * превращается в SSML-разметку темпа и высоты). Оба движка работают локально,
 * офлайн и бесплатно. Установка: node scripts/setup-voice.mjs
 * ElevenLabs остаётся как альтернатива (ключи в .env).
 *
 * Кэш по хэшу текста: data/tts-cache/ — повторяющиеся реплики синтезируются один раз.
 * Выход: public/voice/<id>.wav + поле quiz.voice в JSON.
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {p, readJson, writeJson, config, log, warn, loadEnv, sleep} from './lib.mjs';
import {displayText, speechText} from './narration.mjs';

loadEnv();
const cfg = config();
const vcfg = cfg.voice ?? {};

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const ENGINE = arg('engine', vcfg.engine ?? 'silero');
const MAX_TEMPO = vcfg.maxTempo ?? 1.15;
const fps = cfg.video?.fps ?? 30;

const file = argv.find((a) => a.endsWith('.json')) ??
  p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const quiz = readJson(file);
if (!quiz) { console.error(`нет файла ${file}`); process.exit(1); }
if (!quiz.narration?.length) {
  warn('в викторине нет narration — сначала node scripts/narration.mjs');
  process.exit(0);
}

// --- движки ---

const PIPER_EXE = p('tools', 'piper', 'piper.exe');
const piperVoice = vcfg.piperVoice ?? 'dmitri';
const piperModel = p('data', 'voices', `ru_RU-${piperVoice}-medium.onnx`);

const SILERO_MODEL = p('data', 'voices', 'v4_ru.pt');
const sileroSpeaker = vcfg.speaker ?? 'aidar';
const xttsSpeaker = vcfg.xttsSpeaker ?? 'Lidiya Szekeres';
const PYTHON = process.env.PYTHON ?? 'python';

/** XTTS не понимает SSML — эмоция передаётся темпом речи. */
const XTTS_SPEED = {hype: 1.08, warm: 0.95, neutral: 1.0};

/**
 * Эмоция реплики → SSML-разметка Silero. hype заводит темп и поднимает тон
 * (реврил, интро), warm — наоборот, спокойнее (аутро).
 */
const PROSODY = {
  hype: {rate: 'fast', pitch: 'high'},
  warm: {rate: 'medium', pitch: 'medium'},
  neutral: null,
};
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ssmlFor(text, emotion) {
  const pr = PROSODY[emotion ?? 'neutral'];
  const body = escapeXml(text);
  return pr
    ? `<speak><prosody rate="${pr.rate}" pitch="${pr.pitch}">${body}</prosody></speak>`
    : `<speak>${body}</speak>`;
}

const EL_KEY = process.env.ELEVENLABS_API_KEY;
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID;
const EL_MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';

if (ENGINE === 'silero') {
  if (!fs.existsSync(SILERO_MODEL)) {
    warn('не установлена модель Silero — ролик соберётся без голоса');
    warn('поставить:  node scripts/setup-voice.mjs');
    process.exit(0);
  }
} else if (ENGINE === 'xtts') {
  // модель тянется сама при первом запуске в кэш coqui
} else if (ENGINE === 'piper') {
  if (!fs.existsSync(PIPER_EXE) || !fs.existsSync(piperModel)) {
    warn(`не установлен движок piper или голос «${piperVoice}» — ролик соберётся без голоса`);
    warn('поставить:  node scripts/setup-voice.mjs --engine piper');
    process.exit(0);
  }
} else if (ENGINE === 'elevenlabs') {
  if (!EL_KEY || !EL_VOICE) {
    warn('нет ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID в .env — ролик соберётся без голоса');
    process.exit(0);
  }
} else { console.error(`неизвестный движок «${ENGINE}» (есть: silero, xtts, piper, elevenlabs)`); process.exit(1); }

const tag = ENGINE === 'silero'
  ? `silero|v4_ru|${sileroSpeaker}`
  : ENGINE === 'xtts'
    ? `xtts2|${xttsSpeaker}`
    : ENGINE === 'piper'
      ? `piper|${piperVoice}|${vcfg.lengthScale ?? 1}`
      : `11labs|${EL_MODEL}|${EL_VOICE}`;
// эмоция меняет звучание — значит входит в ключ кэша
const hash = (text, emotion) => crypto.createHash('sha1')
  .update(`${tag}|${emotion ?? 'neutral'} ${text}`).digest('hex').slice(0, 16);
const ext = ENGINE === 'elevenlabs' ? 'mp3' : 'wav';

fs.mkdirSync(p('data', 'tts-cache'), {recursive: true});

/** Синтез Piper: локально, через stdin. Пишет сразу wav. */
function piperSay(text, out) {
  execFileSync(PIPER_EXE, [
    '--model', piperModel,
    '--output_file', out,
    '--length_scale', String(vcfg.lengthScale ?? 1.0),
    '--sentence_silence', '0.0',       // паузы ставим сами, по кадрам
  ], {input: text, stdio: ['pipe', 'ignore', 'pipe']});
}

async function elevenSay(text, out) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}`, {
      method: 'POST',
      headers: {'xi-api-key': EL_KEY, 'content-type': 'application/json'},
      body: JSON.stringify({
        text, model_id: EL_MODEL,
        voice_settings: {stability: 0.5, similarity_boost: 0.75, style: 0.35, speed: 1.0},
      }),
    });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error('ElevenLabs: превышен лимит запросов (429)');
}

/** Срезает тишину по краям — иначе реплика «стартует» позже своего кадра. */
function trimSilence(f) {
  const tmp = `${f}.trim.${ext}`;
  const cut = 'silenceremove=start_periods=1:start_silence=0:start_threshold=-45dB:detection=peak';
  execFileSync('ffmpeg', ['-y', '-i', f, '-af', `${cut},areverse,${cut},areverse`, tmp],
    {stdio: ['ignore', 'ignore', 'pipe']});
  fs.renameSync(tmp, f);
}

const cachePath = (text, emotion) => p('data', 'tts-cache', `${hash(text, emotion)}.${ext}`);
const isCached = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;

/**
 * Silero грузит модель ~1 секунду, поэтому все недостающие реплики ролика
 * синтезируются одним запуском Python, а не по процессу на фразу.
 */
function sileroBatch(items) {
  if (!items.length) return;
  const job = p('data', 'tts-cache', 'job.json');
  fs.writeFileSync(job, JSON.stringify({
    model: SILERO_MODEL, speaker: sileroSpeaker, sampleRate: 48000,
    threads: Math.max(2, Math.min(8, os.cpus().length)),
    items,
  }));
  log(`синтезирую ${items.length} реплик…`);
  execFileSync(PYTHON, [p('scripts', 'silero_tts.py'), job], {stdio: ['ignore', 'ignore', 'inherit']});
  fs.rmSync(job, {force: true});
  for (const it of items) trimSilence(it.out);
}

/** XTTS: модель тяжёлая (~2 ГБ), грузится минуту — тем более синтезируем скопом. */
function xttsBatch(items) {
  if (!items.length) return;
  const job = p('data', 'tts-cache', 'job.json');
  fs.writeFileSync(job, JSON.stringify({speaker: xttsSpeaker, language: 'ru', items}));
  log(`синтезирую ${items.length} реплик (XTTS, первая загрузка модели ~минуту)…`);
  execFileSync(PYTHON, [p('scripts', 'xtts_tts.py'), job], {stdio: ['ignore', 'ignore', 'inherit']});
  fs.rmSync(job, {force: true});
  for (const it of items) trimSilence(it.out);
}

async function tts(text, emotion) {
  const f = cachePath(text, emotion);
  if (isCached(f)) return {file: f, cached: true};
  const say = speechText(text);                          // «как читать», а не «как писать»
  if (ENGINE === 'silero') sileroBatch([{text: say, ssml: ssmlFor(say, emotion), out: f}]);
  else if (ENGINE === 'xtts') xttsBatch([{text: say, speed: XTTS_SPEED[emotion ?? 'neutral'] ?? 1, out: f}]);
  else if (ENGINE === 'piper') { piperSay(say, f); trimSilence(f); }
  else { await elevenSay(say, f); trimSilence(f); }
  return {file: f, cached: false};
}

const dur = (f) => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());

/**
 * Подбирает вариант текста, влезающий в окно: сперва полный, при
 * необходимости — ускорение до maxTempo, потом укороченные alts.
 */
async function fitLine(line) {
  const variants = [line.text, ...(line.alts ?? [])];
  const windowSec = line.window / fps;
  let best = null;
  for (const text of variants) {
    const {file: clip, cached} = await tts(text, line.emotion);
    const d = dur(clip);
    if (!cached && ENGINE === 'elevenlabs') await sleep(350);   // щадим rate limit
    const tempo = d / windowSec;
    if (tempo <= 1.02) return {file: clip, text, tempo: 1, seconds: d};
    if (tempo <= MAX_TEMPO) return {file: clip, text, tempo: Number(tempo.toFixed(3)), seconds: d / tempo};
    if (!best || tempo < best.tempo) best = {file: clip, text, tempo, seconds: d};
  }
  warn(`не влезает даже кратчайший вариант «${best.text}» (${best.tempo.toFixed(2)}x) — ускоряю до ${MAX_TEMPO}x`);
  return {...best, tempo: MAX_TEMPO, seconds: best.seconds / MAX_TEMPO};
}

// --- подбор клипов ---
log(`движок: ${ENGINE}${
  ENGINE === 'silero' ? ` (голос ${sileroSpeaker}, локально)` :
  ENGINE === 'xtts' ? ` (голос ${xttsSpeaker}, локально)` :
  ENGINE === 'piper' ? ` (голос ${piperVoice}, локально)` : ''}`);

// один заход синтеза на весь ролик: собираем всё, чего ещё нет в кэше
if (ENGINE === 'silero' || ENGINE === 'xtts') {
  const need = new Map();
  for (const line of quiz.narration) {
    for (const text of [line.text, ...(line.alts ?? [])]) {
      const out = cachePath(text, line.emotion);
      if (!isCached(out) && !need.has(out)) {
        need.set(out, ENGINE === 'silero'
          ? {text: speechText(text), ssml: ssmlFor(speechText(text), line.emotion), out}
          : {text: speechText(text), speed: XTTS_SPEED[line.emotion ?? 'neutral'] ?? 1, out});
      }
    }
  }
  if (ENGINE === 'silero') sileroBatch([...need.values()]);
  else xttsBatch([...need.values()]);
}

const clips = [];
for (const line of quiz.narration) {
  const fit = await fitLine(line);
  line.text = fit.text;                                  // субтитры показывают то, что реально звучит
  line.display = displayText(fit.text);                  // но нормальным написанием, а не «как слышится»
  line.spoken = Math.ceil(fit.seconds * fps);            // сколько кадров реально занимает речь —
  clips.push({...fit, frame: line.frame});               // по ним музыка приглушается, а не по всему окну
  log(`кадр ${String(line.frame).padStart(4)}  ${fit.tempo > 1 ? `${fit.tempo}x ` : ''}«${fit.text}»`);
}

// --- сборка дорожки: тишина полной длины + каждый клип на своём таймкоде ---
const rl = quiz.timing.roundIn + quiz.timing.countdown + quiz.timing.reveal;
const totalFrames = quiz.timing.intro + quiz.rounds.length * rl + quiz.timing.outro;
const totalSec = (totalFrames / fps).toFixed(3);

fs.mkdirSync(p('public', 'voice'), {recursive: true});
const outWav = p('public', 'voice', `${quiz.id}.wav`);

const args = ['-y', '-f', 'lavfi', '-t', totalSec, '-i', 'anullsrc=r=44100:cl=stereo'];
for (const c of clips) args.push('-i', c.file);
const filters = clips.map((c, i) => {
  const ms = Math.round((c.frame / fps) * 1000);
  const tempo = c.tempo > 1 ? `atempo=${c.tempo},` : '';
  return `[${i + 1}:a]${tempo}aresample=44100,adelay=${ms}:all=1[c${i}]`;
});
const mix = `[0:a]${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0[out]`;
args.push('-filter_complex', [...filters, mix].join(';'),
  '-map', '[out]', '-t', totalSec, '-ar', '44100', '-c:a', 'pcm_s16le', outWav);
execFileSync('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});

quiz.voice = `voice/${quiz.id}.wav`;
writeJson(file, quiz);
log(`дорожка готова: ${outWav} (${totalSec}s, ${clips.length} реплик)`);
