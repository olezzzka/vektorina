/**
 * Тянет картинки скинов из Steam CDN в public/images/ и прописывает локальные пути в викторину.
 * Если CDN недоступен (например, за файрволом) — рисует SVG-заглушку, пайплайн не падает.
 *
 *   node scripts/download-images.mjs out/quizzes/<id>.json
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {p, httpGet, readJson, writeJson, log, warn} from './lib.mjs';

const file = process.argv[2] ?? p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const quiz = readJson(file);
if (!quiz) { console.error('нет файла викторины: ' + file); process.exit(1); }

const dir = p('public', 'images');
fs.mkdirSync(dir, {recursive: true});

const placeholder = (item, out) => {
  const c = item.color || '#888';
  const label = `${item.weapon}`.slice(0, 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 384">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0.12"/>
  </linearGradient></defs>
  <rect x="26" y="120" width="460" height="120" rx="26" fill="url(#g)" stroke="${c}" stroke-width="3"/>
  <rect x="300" y="60" width="150" height="70" rx="18" fill="url(#g)" stroke="${c}" stroke-width="3"/>
  <circle cx="140" cy="180" r="34" fill="none" stroke="${c}" stroke-width="6" opacity="0.7"/>
  <text x="256" y="316" font-family="sans-serif" font-size="34" font-weight="700"
        fill="${c}" opacity="0.85" text-anchor="middle">${label}</text>
</svg>`;
  fs.writeFileSync(out, svg);
};

let ok = 0, ph = 0;
for (const round of quiz.rounds) {
  for (const key of ['a', 'b']) {
    const item = round[key];
    const h = crypto.createHash('sha1').update(item.hash).digest('hex').slice(0, 16);
    let name = `${h}.png`;
    let out = `${dir}/${name}`;
    if (!fs.existsSync(out) && !fs.existsSync(`${dir}/${h}.svg`)) {
      try {
        const buf = await httpGet(item.image, {binary: true, timeout: 20000, retries: 1});
        if (buf.length < 500) throw new Error('слишком маленький файл');
        fs.writeFileSync(out, buf);
        ok++;
      } catch (e) {
        name = `${h}.svg`; out = `${dir}/${name}`;
        placeholder(item, out);
        ph++;
      }
    } else if (fs.existsSync(`${dir}/${h}.svg`)) {
      name = `${h}.svg`;
    }
    item.imageLocal = `images/${name}`;
  }
}
writeJson(file, quiz);
log(`картинки: скачано ${ok}, заглушек ${ph} → public/images/`);
if (ph) warn('Steam CDN недоступен из этой среды — на твоей машине картинки скачаются нормально.');

// свежая викторина становится превью для `npm run studio`
fs.copyFileSync(file, p('src', 'sample-quiz.json'));
