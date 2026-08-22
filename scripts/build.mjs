/**
 * Полный цикл: данные → викторина → картинки → mp4.
 *   node scripts/build.mjs [--count 3] [--rounds 5] [--skip-data]
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {p, log} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const count = Number(arg('count', 1));
const rounds = arg('rounds', null);   // не задано — берём roundsPerVideo из config.json
const run = (script, args = []) =>
  execFileSync(process.execPath, [p('scripts', script), ...args], {stdio: 'inherit'});

if (!argv.includes('--skip-data')) run('fetch-data.mjs');

for (let i = 0; i < count; i++) {
  log(`\n=== ролик ${i + 1}/${count} ===`);
  run('make-quiz.mjs', rounds ? ['--rounds', rounds] : []);
  const id = fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim();
  const quizFile = p('out', 'quizzes', `${id}.json`);
  run('download-images.mjs', [quizFile]);
  run('render.mjs', [quizFile]);
}
log('\nвсё готово → out/videos/, тексты постов → out/captions/');
