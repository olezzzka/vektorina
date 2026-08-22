/**
 * Готовит фоновую подложку: вырезает случайный кусок длинного видео, кадрирует
 * под вертикаль, размывает, притемняет и глушит звук.
 *
 *   node scripts/prepare-bg.mjs [out/quizzes/<id>.json] [--at 620]
 *
 * Кусок каждый раз берётся из нового места, поэтому ролики не выглядят
 * одинаково. Размытие делается на уменьшенной копии и потом растягивается —
 * так в разы быстрее, чем блюрить кадр 1080x1920 целиком, а на глаз то же самое.
 * Настройки — config.json → background.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {p, readJson, writeJson, config, log, warn} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();
const bg = cfg.background ?? {};

const file = argv.find((a) => a.endsWith('.json')) ??
  p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const quiz = readJson(file);
if (!quiz) { console.error(`нет файла ${file}`); process.exit(1); }

if (!bg.file) { log('фоновое видео не задано (config → background.file) — оставляю градиент'); process.exit(0); }
const source = path.isAbsolute(bg.file) ? bg.file : p(bg.file);
if (!fs.existsSync(source)) { warn(`нет фонового видео ${source} — оставляю градиент`); process.exit(0); }

const fps = cfg.video?.fps ?? 30;
const width = cfg.video?.width ?? 1080;
const height = cfg.video?.height ?? 1920;
const rl = quiz.timing.roundIn + quiz.timing.countdown + quiz.timing.reveal;
const frames = quiz.timing.intro + quiz.rounds.length * rl + quiz.timing.outro;
const need = Number((frames / fps + 1).toFixed(2));          // +1с запаса на хвост

const srcDur = Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source], {encoding: 'utf8'}).trim());

// случайный старт, но не у самых краёв: там часто заставка и титры
const margin = Math.min(30, srcDur * 0.02);
const span = Math.max(1, srcDur - need - margin * 2);
const randomStart = () => Number((margin + Math.random() * span).toFixed(2));

/** Средняя яркость кадра (0–255). Нужна, чтобы не взять кусок, где всё чёрное. */
function brightness(sec) {
  // metadata=print пишет в stderr на уровне info — с -v error значений не будет,
  // а execFileSync возвращает только stdout, поэтому берём spawnSync
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(sec), '-i', source,
    '-frames:v', '1', '-vf', 'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f', 'null', '-'], {encoding: 'utf8'});
  const m = `${r.stderr ?? ''}`.match(/YAVG=([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Из нескольких случайных кандидатов берём первый, где вообще есть что показать:
 * на surf-картах хватает почти чёрных кусков, из них подложка выходит мёртвой.
 * Яркость потом всё равно приводится к целевой, поэтому «чем ярче, тем лучше»
 * тут не работает — слишком светлый кусок топит белый текст викторины.
 */
function pickStart() {
  const manual = arg('at', null);
  if (manual !== null) return {sec: Number(manual), y: brightness(Number(manual) + 2)};
  const tries = bg.candidates ?? 5;
  let best = null;
  for (let i = 0; i < tries; i++) {
    const sec = randomStart();
    const y = brightness(sec + 2);
    if (!best || y > best.y) best = {sec, y};
    if (y >= (bg.minBrightness ?? 25)) break;                 // видно достаточно, дальше не ищем
  }
  return best;
}
const {sec: at, y: measured} = pickStart();

// приводим яркость к целевой множителем: так подложка одинаково читается
// и на солнечной карте, и в тёмном тоннеле
const target = bg.targetBrightness ?? 52;
const gain = Math.max(0.1, Math.min(1.6, measured > 1 ? target / measured : 1)).toFixed(3);

const blurH = bg.blurHeight ?? 480;                           // высота, на которой блюрим
const blurW = Math.round(blurH * (width / height) / 2) * 2;
const sigma = bg.blur ?? 6;

fs.mkdirSync(p('public', 'bg'), {recursive: true});
const out = p('public', 'bg', `${quiz.id}.mp4`);

const chain = [
  `scale=-2:${blurH}:force_original_aspect_ratio=increase`,   // уменьшаем, сохраняя охват
  `crop=${blurW}:${blurH}`,                                   // кадрируем под вертикаль
  `gblur=sigma=${sigma}`,
  `lutyuv=y=val*${gain}`,                                     // выравниваем яркость под текст
  `eq=saturation=${bg.saturation ?? 1.05}`,
  `scale=${width}:${height}:flags=bicubic`,                   // растягиваем обратно
  `fps=${fps}`,
].join(',');

log(`фон: кусок с ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')} ` +
  `(из ${Math.round(srcDur / 60)} мин), яркость ${measured.toFixed(0)} → x${gain}`);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(at), '-t', String(need), '-i', source,
  '-an',                                                      // звук фона не нужен
  '-vf', chain, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out],
  {stdio: ['ignore', 'ignore', 'inherit']});

quiz.background = `bg/${quiz.id}.mp4`;
writeJson(file, quiz);
log(`готово: ${out}`);
