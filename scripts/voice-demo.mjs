/**
 * Собирает один файл-прослушку: каждый голос Silero читает одни и те же реплики
 * ролика — интро, раунд, реакцию на реврил. Слушаешь, выбираешь, вписываешь
 * в config.local.json → "voice": {"speaker": "..."}.
 *
 *   node scripts/voice-demo.mjs [--out out/voice-demo.wav]
 */
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {p, config, log} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const SPEAKERS = ['aidar', 'eugene', 'baya', 'kseniya', 'xenia'];
const LINES = [
  {name: 'айдар', speaker: 'aidar'},
  {name: 'евгений', speaker: 'eugene'},
  {name: 'бая', speaker: 'baya'},
  {name: 'ксения', speaker: 'kseniya'},
  {name: 'ксюша', speaker: 'xenia'},
];
// три типа реплик: заводная, спокойная и реакция — чтобы слышать диапазон
const SCRIPT = [
  {text: 'Что дороже? Погнали!', emotion: 'hype'},
  {text: 'Раунд три. Что дороже?', emotion: 'neutral'},
  {text: 'Ловушка сработала! Разрыв в шесть раз.', emotion: 'hype'},
];

const model = p('data', 'voices', 'v4_ru.pt');
if (!fs.existsSync(model)) {
  console.error('нет модели Silero — сначала node scripts/setup-voice.mjs');
  process.exit(1);
}

const PROSODY = {hype: {rate: 'fast', pitch: 'high'}, warm: {rate: 'medium', pitch: 'medium'}, neutral: null};
const ssmlFor = (text, emotion) => {
  const pr = PROSODY[emotion ?? 'neutral'];
  return pr ? `<speak><prosody rate="${pr.rate}" pitch="${pr.pitch}">${text}</prosody></speak>` : `<speak>${text}</speak>`;
};

const tmp = p('data', 'tts-cache', 'demo');
fs.mkdirSync(tmp, {recursive: true});
const parts = [];

for (const {name, speaker} of LINES) {
  const items = [
    {text: `Голос ${name}.`, ssml: `<speak>Голос ${name}.</speak>`, out: `${tmp}/${speaker}-0.wav`},
    ...SCRIPT.map((l, i) => ({text: l.text, ssml: ssmlFor(l.text, l.emotion), out: `${tmp}/${speaker}-${i + 1}.wav`})),
  ];
  const job = `${tmp}/job.json`;
  fs.writeFileSync(job, JSON.stringify({
    model, speaker, sampleRate: 48000, threads: Math.max(2, Math.min(8, os.cpus().length)), items,
  }));
  log(`синтезирую ${speaker}…`);
  execFileSync(process.env.PYTHON ?? 'python', [p('scripts', 'silero_tts.py'), job],
    {stdio: ['ignore', 'ignore', 'inherit']});
  parts.push(...items.map((i) => i.out));
}

// пауза между репликами, чтобы голоса не сливались в кашу
const gap = `${tmp}/gap.wav`;
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '0.45',
  '-c:a', 'pcm_s16le', gap], {stdio: ['ignore', 'ignore', 'pipe']});
const seq = parts.flatMap((f) => [f, gap]);

const out = arg('out', p('out', 'voice-demo.mp3'));
fs.mkdirSync(p('out'), {recursive: true});
const args = ['-y'];
for (const f of seq) args.push('-i', f);
const chain = seq.map((_, i) => `[${i}:a]`).join('') +
  `concat=n=${seq.length}:v=0:a=1[j];[j]aformat=channel_layouts=stereo[out]`;
args.push('-filter_complex', chain, '-map', '[out]', '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '3', out);
execFileSync('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
fs.rmSync(tmp, {recursive: true, force: true});
log(`\nпрослушка готова: ${out}`);
log(`голоса по порядку: ${SPEAKERS.join(', ')}`);
