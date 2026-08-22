/**
 * Ставит локальный синтез речи. Скачивает один раз в data/voices/ и tools/
 * (обе папки вне гита). После установки озвучка работает офлайн и бесплатно.
 *
 *   node scripts/setup-voice.mjs                      # silero (по умолчанию)
 *   node scripts/setup-voice.mjs --engine piper       # + движок piper
 *   node scripts/setup-voice.mjs --engine piper --voice irina
 *
 * silero — живее и умеет интонации, нужен Python с torch (pip install torch).
 * piper  — отдельный exe, интонаций нет, зато без Python.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {p, httpGet, log} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const PIPER_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const SILERO_URL = 'https://models.silero.ai/models/tts/ru/v4_ru.pt';

// Русские голоса Piper. medium — компромисс размера и качества (~60 МБ).
export const VOICES = {
  dmitri: 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium',
  ruslan: 'ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium',
  denis: 'ru/ru_RU/denis/medium/ru_RU-denis-medium',
  irina: 'ru/ru_RU/irina/medium/ru_RU-irina-medium',
};
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

const engine = arg('engine', 'silero');
const voice = arg('voice', 'dmitri');
if (!['silero', 'piper'].includes(engine)) {
  console.error(`неизвестный движок «${engine}» (есть: silero, piper)`);
  process.exit(1);
}
if (!VOICES[voice]) {
  console.error(`неизвестный голос «${voice}». Есть: ${Object.keys(VOICES).join(', ')}`);
  process.exit(1);
}

/** Скачивает файл, если его ещё нет. */
async function fetchTo(url, dest, label) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`${label}: уже на месте`);
    return;
  }
  log(`качаю ${label}…`);
  const buf = await httpGet(url, {binary: true, timeout: 600000, retries: 2});
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.writeFileSync(dest, buf);
  log(`${label}: ${(buf.length / 1048576).toFixed(1)} МБ`);
}

// --- silero: одна модель, всё остальное делает torch ---
if (engine === 'silero') {
  fs.mkdirSync(p('data', 'voices'), {recursive: true});
  await fetchTo(SILERO_URL, p('data', 'voices', 'v4_ru.pt'), 'модель Silero v4_ru');
  try {
    const v = execFileSync(process.env.PYTHON ?? 'python', ['-c', 'import torch; print(torch.__version__)'],
      {encoding: 'utf8'}).trim();
    log(`torch ${v}: на месте`);
  } catch {
    console.error('\nнет Python с torch. Поставь:  pip install torch --index-url https://download.pytorch.org/whl/cpu');
    process.exit(1);
  }
  log('\nготово. Голоса: aidar, eugene (муж.), baya, kseniya, xenia (жен.)');
  log('выбрать:  "voice": {"speaker": "eugene"} в config.local.json');
  log('послушать все:  node scripts/voice-demo.mjs');
  process.exit(0);
}

// --- piper: отдельный exe + голосовая модель ---
const piperDir = p('tools', 'piper');
const piperExe = p('tools', 'piper', 'piper.exe');
if (!fs.existsSync(piperExe)) {
  fs.mkdirSync(p('tools'), {recursive: true});
  const zip = p('tools', 'piper.zip');
  await fetchTo(PIPER_URL, zip, 'движок Piper');
  log('распаковываю…');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path '${zip}' -DestinationPath '${p('tools')}' -Force`], {stdio: 'inherit'});
  fs.rmSync(zip, {force: true});
  if (!fs.existsSync(piperExe)) { console.error(`piper.exe не найден в ${piperDir}`); process.exit(1); }
} else log('движок Piper: уже на месте');

// --- голос ---
const rel = VOICES[voice];
const base = rel.split('/').pop();
fs.mkdirSync(p('data', 'voices'), {recursive: true});
await fetchTo(`${HF}/${rel}.onnx`, p('data', 'voices', `${base}.onnx`), `голос ${voice} (модель)`);
await fetchTo(`${HF}/${rel}.onnx.json`, p('data', 'voices', `${base}.onnx.json`), `голос ${voice} (конфиг)`);

log(`\nготово. Голос по умолчанию — ${voice}.`);
log('проверить:  node scripts/voice.mjs out/quizzes/<id>.json');
log(`сменить голос: node scripts/setup-voice.mjs --voice irina  (и voice: "irina" в config.local.json)`);
