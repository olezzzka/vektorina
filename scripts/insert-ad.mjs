/**
 * Вставляет рекламный баннер в середину готового ролика: картинка викторины
 * замирает, поверх неё по центру играет баннер, потом ролик едет дальше.
 *
 *   node scripts/insert-ad.mjs [out/videos/<id>.mp4] [--speed 2] [--scale 0.86] [--at 26.5]
 *                              [--keep-original]   — оставить копию без рекламы
 *
 * Точка вставки по умолчанию — граница раундов ближе всего к середине
 * (берётся из JSON викторины), чтобы стоп-кадр пришёлся на законченный раунд,
 * а не на середину анимации. Звук викторины на это время замолкает, играет
 * звук баннера. Настройки — config.json → ad.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {p, readJson, config, log, warn} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();
const ad = cfg.ad ?? {};

const video = argv.find((a) => a.endsWith('.mp4')) ??
  p('out', 'videos', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.mp4`);
if (!fs.existsSync(video)) { console.error(`нет файла ${video}`); process.exit(1); }

const bannerRel = arg('file', ad.file);
if (!bannerRel) { warn('баннер не задан (config.json → ad.file) — пропускаю вставку'); process.exit(0); }
const banner = path.isAbsolute(bannerRel) ? bannerRel : p(bannerRel);
if (!fs.existsSync(banner)) { console.error(`нет баннера ${banner}`); process.exit(1); }

const speed = Number(arg('speed', ad.speed ?? 1));
const scale = Number(arg('scale', ad.scale ?? 0.86));   // доля ширины кадра
const dim = Number(arg('dim', ad.dim ?? 0.45));          // затемнение стоп-кадра под баннером

// csv=p=0 отдаёт значения через запятую и с хвостовой запятой — её надо срезать
const probe = (file, entries, stream = null) => execFileSync('ffprobe',
  ['-v', 'error', ...(stream ? ['-select_streams', stream] : []),
    '-show_entries', entries, '-of', 'csv=p=0', file], {encoding: 'utf8'})
  .trim().split('\n')[0].replace(/,+$/, '');

const srcDur = Number(probe(video, 'format=duration'));
const bannerDur = Number(probe(banner, 'format=duration'));
const insertDur = Number((bannerDur / speed).toFixed(3));

// --- точка вставки: граница раундов ближе к середине ---
function insertPoint() {
  const at = arg('at', ad.at ?? 'middle');
  if (at !== 'middle') return Number(at);
  const id = path.basename(video, '.mp4');
  const quiz = readJson(p('out', 'quizzes', `${id}.json`));
  if (!quiz?.timing) return Number((srcDur / 2).toFixed(3));
  const fps = cfg.video?.fps ?? 30;
  const rl = quiz.timing.roundIn + quiz.timing.countdown + quiz.timing.reveal;
  const k = Math.max(1, Math.round(quiz.rounds.length / 2));
  // не на стыке раундов — там экран пустой, карточки ещё летят; берём конец
  // реврила, где видны оба скина с ценами: такой стоп-кадр смотрится осмысленно
  return Number(((quiz.timing.intro + k * rl - 12) / fps).toFixed(3));
}
const at = Math.min(Math.max(insertPoint(), 0.5), srcDur - 0.5);

const [w, h] = probe(video, 'stream=width,height', 'v:0').split(',').map(Number);
const fps = cfg.video?.fps ?? 30;
const bannerW = Math.round(w * scale / 2) * 2;           // чётная ширина — требование h264

log(`баннер ${path.basename(banner)}: ${bannerDur}s${speed !== 1 ? ` → ${insertDur}s (${speed}x)` : ''}`);
log(`вставка на ${at}s (ролик ${srcDur.toFixed(1)}s), ширина ${bannerW}px по центру`);

const tmp = p('out', '.ad-tmp');
fs.rmSync(tmp, {recursive: true, force: true});
fs.mkdirSync(tmp, {recursive: true});

const ENC = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];
const run = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], {stdio: ['ignore', 'ignore', 'inherit']});

// часть до вставки
run(['-i', video, '-t', String(at), ...ENC, `${tmp}/part1.mp4`]);
// часть после
run(['-ss', String(at), '-i', video, ...ENC, `${tmp}/part2.mp4`]);
// стоп-кадр
run(['-ss', String(at), '-i', video, '-frames:v', '1', `${tmp}/freeze.png`]);

// стоп-кадр + затемнение + баннер по центру; звук берём у баннера
const vFilter = [
  `[0:v]scale=${w}:${h},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=black@${dim}:t=fill[bg]`,
  `[1:v]${speed !== 1 ? `setpts=PTS/${speed},` : ''}fps=${fps},scale=${bannerW}:-2[b]`,
  `[bg][b]overlay=(W-w)/2:(H-h)/2[v]`,
].join(';');
const aFilter = `[1:a]${speed !== 1 ? `atempo=${speed},` : ''}aresample=44100[a]`;
run(['-loop', '1', '-t', String(insertDur), '-i', `${tmp}/freeze.png`, '-i', banner,
  '-filter_complex', `${vFilter};${aFilter}`, '-map', '[v]', '-map', '[a]',
  '-t', String(insertDur), ...ENC, `${tmp}/insert.mp4`]);

// склейка. По умолчанию результат заменяет исходник: ролик без рекламы
// никому не нужен, держать две копии одного видео — только мусорить в out/.
fs.writeFileSync(`${tmp}/list.txt`,
  ['part1.mp4', 'insert.mp4', 'part2.mp4'].map((f) => `file '${tmp.replace(/\\/g, '/')}/${f}'`).join('\n'));
const keep = argv.includes('--keep-original');
const out = keep ? video.replace(/\.mp4$/, '-ad.mp4') : video;
run(['-f', 'concat', '-safe', '0', '-i', `${tmp}/list.txt`, '-c', 'copy', `${tmp}/final.mp4`]);
if (!keep) fs.rmSync(video, {force: true});
fs.renameSync(`${tmp}/final.mp4`, out);
fs.rmSync(tmp, {recursive: true, force: true});

log(`готово: ${out} (${(srcDur + insertDur).toFixed(1)}s)`);
