/**
 * Быстро послушать, как движок читает фразу. Нужен, когда голос ставит
 * неправильное ударение: правишь запись в SPEECH_FIX (scripts/narration.mjs),
 * прогоняешь снова — и слышишь результат за секунды, без сборки ролика.
 *
 *   node scripts/say.mjs "Красивый — не значит дорогой"
 *   node scripts/say.mjs "фраза" --engine silero
 *
 * Результат: out/say.wav (открывается любым плеером).
 */
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {p, config, log} from './lib.mjs';
import {speechText} from './narration.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const text = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--engine').join(' ').trim();
if (!text) { console.error('нечего читать: node scripts/say.mjs "фраза"'); process.exit(1); }

const cfg = config();
const vcfg = cfg.voice ?? {};
const engine = arg('engine', vcfg.engine ?? 'xtts');
const PYTHON = process.env.PYTHON ?? 'python';

const say = speechText(text);
if (say !== text) log(`словарь произношения: «${text}» → «${say}»`);

fs.mkdirSync(p('out'), {recursive: true});
const out = p('out', 'say.wav');
const job = p('data', 'say-job.json');
fs.mkdirSync(p('data'), {recursive: true});

if (engine === 'xtts') {
  fs.writeFileSync(job, JSON.stringify({
    speaker: vcfg.xttsSpeaker ?? 'Tanja Adelina', language: 'ru',
    items: [{text: say, speed: 1.0, out}],
  }));
  execFileSync(PYTHON, [p('scripts', 'xtts_tts.py'), job], {stdio: ['ignore', 'ignore', 'inherit']});
} else if (engine === 'silero') {
  fs.writeFileSync(job, JSON.stringify({
    model: p('data', 'voices', 'v4_ru.pt'), speaker: vcfg.speaker ?? 'baya', sampleRate: 48000,
    threads: Math.max(2, Math.min(8, os.cpus().length)),
    items: [{text: say, ssml: `<speak>${say}</speak>`, out}],
  }));
  execFileSync(PYTHON, [p('scripts', 'silero_tts.py'), job], {stdio: ['ignore', 'ignore', 'inherit']});
} else {
  console.error(`движок «${engine}» тут не поддержан (есть: xtts, silero)`);
  process.exit(1);
}
fs.rmSync(job, {force: true});

log(`готово: ${out}`);
log('если ударение не то — добавь строку в SPEECH_FIX в scripts/narration.mjs');
