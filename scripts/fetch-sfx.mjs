/**
 * Скачивает «живые» звуки под свободной лицензией CC0 в public/sfx/.
 *
 *   node scripts/fetch-sfx.mjs [--force]
 *
 * Синтезированные формулами звуки (make-sfx.mjs) хороши для тиков и реврила,
 * но удар на первом кадре должен быть настоящим — от него зависит, остановит
 * зритель палец или пролистает. Источник: videoeditingsfx.com, лицензия CC0
 * (общественное достояние, указание автора не требуется).
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {p, httpGet, log} from './lib.mjs';

const force = process.argv.includes('--force');
const SRC = 'https://videoeditingsfx.com/sounds';

/**
 * имя в проекте → {файл у источника, как обрезать}
 *
 * impact сейчас берётся не отсюда: под хук положен свой файл (assets/sfx/hook.mp3),
 * и скрипт его не трогает — он вообще не перезаписывает то, что уже лежит,
 * если не передать --force.
 */
const SOUNDS = {
  impact: {from: 'deep-hit', trim: 1.6, gain: 'loudnorm=I=-14:TP=-1'},
  // переход между раундами — живее синтезированного свиста
  'whoosh-real': {from: 'deep-whoosh-1', trim: 1.2, gain: 'loudnorm=I=-18:TP=-2'},
};

const dir = p('public', 'sfx');
fs.mkdirSync(dir, {recursive: true});
const tmp = p('data', '.sfx-tmp');
fs.mkdirSync(tmp, {recursive: true});

for (const [name, s] of Object.entries(SOUNDS)) {
  const out = `${dir}/${name}.mp3`;
  if (fs.existsSync(out) && !force) { log(`${name}: уже есть (--force чтобы перекачать)`); continue; }

  const raw = `${tmp}/${s.from}.mp3`;
  log(`качаю ${s.from}…`);
  fs.writeFileSync(raw, await httpGet(`${SRC}/${s.from}.mp3`, {binary: true, timeout: 120000, retries: 2}));

  // срезаем тишину перед атакой, иначе удар опаздывает на первый кадр
  const cut = 'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB:detection=peak';
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw,
    '-af', `${cut},${s.gain},afade=t=out:st=${(s.trim - 0.25).toFixed(2)}:d=0.25`,
    '-t', String(s.trim), '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', out],
    {stdio: ['ignore', 'ignore', 'inherit']});
  log(`${name}: ${s.trim}s, ${(fs.statSync(out).size / 1024).toFixed(1)} КБ`);
}
fs.rmSync(tmp, {recursive: true, force: true});
log(`\nзвуки → ${dir} (лицензия CC0, указание автора не требуется)`);
