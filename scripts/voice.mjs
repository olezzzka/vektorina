/**
 * Озвучка: каждая реплика из quiz.narration — отдельный запрос к ElevenLabs,
 * клип кладётся точно на свой кадр. Рассинхрон невозможен по построению.
 *
 *   node scripts/voice.mjs [out/quizzes/<id>.json]
 *
 * Ключи в .env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID.
 * Кэш по хэшу текста: data/tts-cache/<hash>.mp3 — повторяющиеся реплики
 * озвучиваются один раз за всю жизнь проекта.
 * Выход: public/voice/<id>.wav + поле quiz.voice в JSON.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {p, readJson, writeJson, config, log, warn, loadEnv, sleep} from './lib.mjs';

loadEnv();
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID;
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
const MAX_TEMPO = 1.15;

const argv = process.argv.slice(2);
const file = argv.find((a) => a.endsWith('.json')) ??
  p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const quiz = readJson(file);
if (!quiz) { console.error(`нет файла ${file}`); process.exit(1); }

if (!KEY || !VOICE) {
  warn('нет ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID в .env — ролик соберётся без голоса');
  process.exit(0);
}
if (!quiz.narration?.length) {
  warn('в викторине нет narration — сначала node scripts/narration.mjs');
  process.exit(0);
}

const cfg = config();
const fps = cfg.video?.fps ?? 30;
const cacheDir = p('data', 'tts-cache');
fs.mkdirSync(cacheDir, {recursive: true});

const hash = (text) => crypto.createHash('sha1').update([MODEL, VOICE, text].join(' ')).digest('hex').slice(0, 16);

async function tts(text) {
  const f = p('data', 'tts-cache', `${hash(text)}.mp3`);
  if (fs.existsSync(f) && fs.statSync(f).size > 0) return {file: f, cached: true};
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: 'POST',
      headers: {'xi-api-key': KEY, 'content-type': 'application/json'},
      body: JSON.stringify({
        text, model_id: MODEL,
        voice_settings: {stability: 0.5, similarity_boost: 0.75, style: 0.35, speed: 1.0},
      }),
    });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    return {file: f, cached: false};
  }
  throw new Error('ElevenLabs: превышен лимит запросов (429)');
}

const dur = (f) => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());

/**
 * Подбирает вариант текста, влезающий в окно: сперва полный, при
 * необходимости — ускорение до 1.15x, потом укороченные alts.
 * Возвращает {file, text, tempo}.
 */
async function fitLine(line) {
  const variants = [line.text, ...(line.alts ?? [])];
  const windowSec = line.window / fps;
  let best = null;
  for (const text of variants) {
    const {file: clip, cached} = await tts(text);
    const d = dur(clip);
    if (!cached) await sleep(350);                      // щадим rate limit
    const tempo = d / windowSec;
    if (tempo <= 1.02) return {file: clip, text, tempo: 1};
    if (tempo <= MAX_TEMPO) return {file: clip, text, tempo: Number(tempo.toFixed(3))};
    if (!best || tempo < best.tempo) best = {file: clip, text, tempo};
  }
  warn(`не влезает даже кратчайший вариант «${best.text}» (${best.tempo.toFixed(2)}x) — ускоряю до ${MAX_TEMPO}x, хвост уйдёт за окно`);
  return {...best, tempo: MAX_TEMPO};
}

// --- подбор клипов ---
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
  return `[${i + 1}:a]${tempo}adelay=${ms}:all=1[c${i}]`;
});
const mix = `[0:a]${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0[out]`;
args.push('-filter_complex', [...filters, mix].join(';'),
  '-map', '[out]', '-t', totalSec, '-ar', '44100', '-c:a', 'pcm_s16le', outWav);
execFileSync('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});

quiz.voice = `voice/${quiz.id}.wav`;
writeJson(file, quiz);
log(`дорожка готова: ${outWav} (${totalSec}s, ${clips.length} реплик)`);
