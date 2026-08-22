/**
 * Озвучка: каждая реплика из quiz.narration синтезируется отдельно и кладётся
 * точно на свой кадр. Рассинхрон невозможен по построению.
 *
 *   node scripts/voice.mjs [out/quizzes/<id>.json] [--engine piper|elevenlabs]
 *
 * Движок по умолчанию — piper: локально, офлайн, бесплатно, без лимитов.
 * Установка: node scripts/setup-voice.mjs
 * ElevenLabs остаётся как альтернатива (ключи в .env), включается --engine elevenlabs.
 *
 * Кэш по хэшу текста: data/tts-cache/ — повторяющиеся реплики синтезируются один раз.
 * Выход: public/voice/<id>.wav + поле quiz.voice в JSON.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {p, readJson, writeJson, config, log, warn, loadEnv, sleep} from './lib.mjs';

loadEnv();
const cfg = config();
const vcfg = cfg.voice ?? {};

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const ENGINE = arg('engine', vcfg.engine ?? 'piper');
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
const piperVoice = vcfg.voice ?? 'dmitri';
const piperModel = p('data', 'voices', `ru_RU-${piperVoice}-medium.onnx`);

const EL_KEY = process.env.ELEVENLABS_API_KEY;
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID;
const EL_MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';

if (ENGINE === 'piper') {
  if (!fs.existsSync(PIPER_EXE) || !fs.existsSync(piperModel)) {
    warn(`не установлен локальный движок или голос «${piperVoice}» — ролик соберётся без голоса`);
    warn('поставить:  node scripts/setup-voice.mjs');
    process.exit(0);
  }
} else if (ENGINE === 'elevenlabs') {
  if (!EL_KEY || !EL_VOICE) {
    warn('нет ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID в .env — ролик соберётся без голоса');
    process.exit(0);
  }
} else { console.error(`неизвестный движок «${ENGINE}» (есть: piper, elevenlabs)`); process.exit(1); }

const tag = ENGINE === 'piper'
  ? `piper|${piperVoice}|${vcfg.lengthScale ?? 1}`
  : `11labs|${EL_MODEL}|${EL_VOICE}`;
const hash = (text) => crypto.createHash('sha1').update(`${tag} ${text}`).digest('hex').slice(0, 16);
const ext = ENGINE === 'piper' ? 'wav' : 'mp3';

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

async function tts(text) {
  const f = p('data', 'tts-cache', `${hash(text)}.${ext}`);
  if (fs.existsSync(f) && fs.statSync(f).size > 0) return {file: f, cached: true};
  if (ENGINE === 'piper') piperSay(text, f); else await elevenSay(text, f);
  trimSilence(f);
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
    const {file: clip, cached} = await tts(text);
    const d = dur(clip);
    if (!cached && ENGINE === 'elevenlabs') await sleep(350);   // щадим rate limit
    const tempo = d / windowSec;
    if (tempo <= 1.02) return {file: clip, text, tempo: 1};
    if (tempo <= MAX_TEMPO) return {file: clip, text, tempo: Number(tempo.toFixed(3))};
    if (!best || tempo < best.tempo) best = {file: clip, text, tempo};
  }
  warn(`не влезает даже кратчайший вариант «${best.text}» (${best.tempo.toFixed(2)}x) — ускоряю до ${MAX_TEMPO}x`);
  return {...best, tempo: MAX_TEMPO};
}

// --- подбор клипов ---
log(`движок: ${ENGINE}${ENGINE === 'piper' ? ` (голос ${piperVoice}, локально)` : ''}`);
const clips = [];
for (const line of quiz.narration) {
  const fit = await fitLine(line);
  line.text = fit.text;                                  // субтитры показывают то, что реально звучит
  clips.push({...fit, frame: line.frame});
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
