/**
 * Ставит локальный синтез речи: движок Piper + русский голос с Hugging Face.
 * Скачивает один раз в tools/ и data/voices/ (обе папки вне гита).
 *
 *   node scripts/setup-voice.mjs [--voice dmitri|irina|ruslan|denis]
 *
 * После установки озвучка работает офлайн и бесплатно: node scripts/voice.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {p, httpGet, log} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const PIPER_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

// Русские голоса Piper. medium — компромисс размера и качества (~60 МБ).
export const VOICES = {
  dmitri: 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium',
  ruslan: 'ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium',
  denis: 'ru/ru_RU/denis/medium/ru_RU-denis-medium',
  irina: 'ru/ru_RU/irina/medium/ru_RU-irina-medium',
};
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

const voice = arg('voice', 'dmitri');
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

// --- движок ---
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
