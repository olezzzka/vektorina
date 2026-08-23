/**
 * Генерирует звуки интерфейса в public/sfx/ через ffmpeg.
 *
 * Удар на первом кадре (impact) тут НЕ синтезируется: он должен быть живым,
 * его качает scripts/fetch-sfx.mjs из библиотеки с лицензией CC0.
 *   node scripts/make-sfx.mjs [--force]
 *
 * Принцип: не тоны-«пищалки», а звуки с быстрой атакой и затуханием —
 * ударный деревянный тик, шумовой переход, колокольный аккорд на правильном
 * ответе. Каждый звук — формула, её легко подкрутить: exp(-k*t) задаёт скорость
 * затухания (больше k — короче звук), число перед sin — громкость составляющей.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {p, log} from './lib.mjs';

const force = process.argv.includes('--force');
const dir = p('public', 'sfx');
fs.mkdirSync(dir, {recursive: true});

// запятая внутри выражения экранируется: в filtergraph ffmpeg она разделяет фильтры
const gate = (t0) => `gt(t\\,${t0})`;
const noise = '(random(0)*2-1)';

/** Нота с колокольным затуханием, вступает в t0. */
const note = (freq, amp, decay, t0 = 0) =>
  t0 === 0
    ? `${amp}*exp(-${decay}*t)*sin(2*PI*${freq}*t)`
    : `${amp}*exp(-${decay}*(t-${t0}))*sin(2*PI*${freq}*(t-${t0}))*${gate(t0)}`;

const SOUNDS = {
  // отсчёт: деревянный тик — щелчок, а не писк
  tick: {
    d: 0.1,
    expr: [note(640, 0.5, 55), note(1620, 0.22, 150), `0.12*exp(-420*t)*${noise}`].join('+'),
    chain: 'highpass=f=180',
  },
  // последняя секунда: выше и настойчивее
  'tick-last': {
    d: 0.24,
    expr: [note(880, 0.6, 26), note(1760, 0.3, 64), `0.15*exp(-380*t)*${noise}`].join('+'),
    chain: 'highpass=f=200',
  },
  // переход между раундами: шумовой свист с движением
  whoosh: {
    d: 0.45,
    expr: `0.55*${noise}*(sin(PI*t/0.45)*sin(PI*t/0.45))*(0.35+0.65*t/0.45)`,
    chain: 'flanger=delay=2:depth=4:speed=3,highpass=f=420,lowpass=f=7000',
  },
  // правильный ответ: мажорное трезвучие с колокольным затуханием
  reveal: {
    d: 1.5,
    expr: [
      note(523.25, 0.42, 3.0), note(659.25, 0.34, 3.4), note(783.99, 0.28, 3.8),
      note(1046.5, 0.16, 7.5), `0.1*exp(-90*t)*${noise}`,
    ].join('+'),
    chain: 'aecho=0.8:0.7:60:0.25,highpass=f=200',
  },
  // интро: нарастающее напряжение
  riser: {
    d: 1.6,
    expr: `0.3*${noise}*(t/1.6)*(t/1.6)+0.24*(t/1.6)*(t/1.6)*sin(2*PI*(170+430*(t/1.6)*(t/1.6))*t)`,
    chain: 'highpass=f=150,lowpass=f=9000',
  },
  // аутро: восходящий мотив из четырёх нот
  outro: {
    d: 1.8,
    expr: [
      note(523.25, 0.38, 3.4), note(659.25, 0.36, 3.4, 0.22),
      note(783.99, 0.34, 2.6, 0.44), note(1046.5, 0.3, 2.2, 0.66),
    ].join('+'),
    chain: 'aecho=0.8:0.7:90:0.3,highpass=f=180',
  },
};

for (const [name, s] of Object.entries(SOUNDS)) {
  const out = `${dir}/${name}.mp3`;
  if (fs.existsSync(out) && !force) { log(`${name}: уже есть (--force чтобы перегенерить)`); continue; }
  const fadeOut = Math.max(0.01, s.d - 0.03);
  const chain = [
    `aevalsrc=${s.expr}:d=${s.d}:s=44100`,
    ...(s.chain ? [s.chain] : []),
    `afade=t=out:st=${fadeOut.toFixed(3)}:d=0.03`,
    'alimiter=limit=0.95',
    'aformat=channel_layouts=stereo',
  ].join(',');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', chain, '-c:a', 'libmp3lame', '-q:a', '2', out],
    {stdio: ['ignore', 'ignore', 'pipe']});
  log(`${name}: ${s.d}s, ${(fs.statSync(out).size / 1024).toFixed(1)} КБ`);
}
log(`\nзвуки → ${dir}`);
