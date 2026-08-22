/**
 * Рендерит mp4 из JSON-викторины.
 *   node scripts/render.mjs [out/quizzes/<id>.json] [--concurrency 4]
 */
import fs from 'node:fs';
import os from 'node:os';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia} from '@remotion/renderer';
import {p, readJson, log} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const fileArg = argv.find((a) => a.endsWith('.json'));
const file = fileArg ?? p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const quiz = readJson(file);

// в песочнице/CI можно подсунуть свой Chromium; локально Remotion скачает свой сам
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? null;

const out = p('out', 'videos', `${quiz.id}.mp4`);
fs.mkdirSync(p('out', 'videos'), {recursive: true});

log('бандлю проект…');
const serveUrl = await bundle({entryPoint: p('src', 'index.ts'), publicDir: p('public')});

log('ищу композицию…');
const composition = await selectComposition({
  serveUrl, id: 'Quiz', inputProps: {quiz}, browserExecutable,
  chromiumOptions: {gl: 'angle'},
});

log(`рендер ${composition.durationInFrames} кадров → ${out}`);
let last = -1;
await renderMedia({
  composition, serveUrl, codec: 'h264', outputLocation: out, inputProps: {quiz},
  browserExecutable, chromiumOptions: {gl: 'angle'},
  concurrency: Number(arg('concurrency', Math.max(2, Math.min(8, os.cpus().length)))),
  crf: 18,
  onProgress: ({progress}) => {
    const pct = Math.floor(progress * 100);
    if (pct >= last + 10) { last = pct; process.stdout.write(`  ${pct}%\n`); }
  },
});
log(`готово: ${out}`);
