/**
 * Нарезка длинного видео в вертикальные ролики для TikTok.
 *
 *   node scripts/clip.mjs --url https://...           # скачает и нарежет
 *   node scripts/clip.mjs --file video.mp4            # нарежет локальный файл
 *   node scripts/clip.mjs --file v.mp4 --length 90    # куски по полторы минуты
 *   node scripts/clip.mjs --file v.mp4 --limit 1      # только первый кусок (проверить)
 *
 * Что делает с каждым куском:
 *   исходник 16:9 ставится по центру вертикального кадра 1080x1920,
 *   фоном идёт размытый геймплей из assets/ (как в викторинах),
 *   раз в минуту (в середине минуты) картинка замирает и играет баннер.
 *
 * Номера частей на экран не выводятся — только в имена файлов.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {p, config, log, warn} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();

const LENGTH = Number(arg('length', cfg.clip?.length ?? 180));       // длина куска, сек
const EVERY = Number(arg('every', cfg.clip?.every ?? 60));           // как часто баннер
const OFFSET = Number(arg('offset', cfg.clip?.offset ?? 30));        // где внутри минуты
const LIMIT = Number(arg('limit', 0));                               // 0 — все куски
const MIN_TAIL = Number(arg('minTail', cfg.clip?.minTail ?? 45));    // хвост короче — приклеиваем к прошлому

const W = cfg.video?.width ?? 1080;
const H = cfg.video?.height ?? 1920;
const FPS = cfg.video?.fps ?? 30;

const ENC = ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], {stdio: ['ignore', 'ignore', 'inherit']});
const probe = (file, entries, stream = null) => execFileSync('ffprobe',
  ['-v', 'error', ...(stream ? ['-select_streams', stream] : []), '-show_entries', entries, '-of', 'csv=p=0', file],
  {encoding: 'utf8'}).trim().split('\n')[0].replace(/,+$/, '');

// --- источник ---
function source() {
  const file = arg('file', null);
  if (file) {
    const f = path.isAbsolute(file) ? file : p(file);
    if (!fs.existsSync(f)) { console.error(`нет файла ${f}`); process.exit(1); }
    return f;
  }
  const url = arg('url', null);
  if (!url) { console.error('нужен --url ссылка или --file путь'); process.exit(1); }

  fs.mkdirSync(p('assets', 'source'), {recursive: true});
  const out = p('assets', 'source', '%(title).80B [%(id)s].%(ext)s');
  log('скачиваю исходник…');
  const r = spawnSync('yt-dlp', [
    '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b',
    '--merge-output-format', 'mp4',
    '--no-playlist', '--print', 'after_move:filepath',
    '-o', out, url,
  ], {encoding: 'utf8'});
  if (r.status !== 0) { console.error(r.stderr || 'yt-dlp не смог скачать'); process.exit(1); }
  const got = (r.stdout || '').trim().split('\n').pop();
  if (!got || !fs.existsSync(got)) { console.error('не понял, куда скачался файл'); process.exit(1); }
  log(`скачано: ${path.basename(got)}`);
  return got;
}

// --- фон: случайный кусок размытого геймплея, как в викторинах ---
const bgCfg = cfg.background ?? {};
function bgSource() {
  if (!bgCfg.file) return null;
  const f = path.isAbsolute(bgCfg.file) ? bgCfg.file : p(bgCfg.file);
  return fs.existsSync(f) ? f : null;
}
function bgBrightness(file, sec) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(sec), '-i', file, '-frames:v', '1',
    '-vf', 'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'],
    {encoding: 'utf8'});
  const m = `${r.stderr ?? ''}`.match(/YAVG=([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

/** Кусок исходника в вертикальном кадре: размытый фон + видео по центру. */
function verticalize(src, start, dur, out) {
  const bg = bgSource();
  if (!bg) {
    // фонового видео нет — просто чёрные поля
    ff(['-ss', String(start), '-t', String(dur), '-i', src,
      '-vf', `scale=${W}:-2,pad=${W}:${H}:0:(oh-ih)/2:black`, ...ENC, out]);
    return;
  }
  const bgDur = Number(probe(bg, 'format=duration'));
  const at = Math.max(0, Math.random() * Math.max(1, bgDur - dur - 30));
  const measured = bgBrightness(bg, at + 2) || 60;
  const gain = Math.max(0.1, Math.min(1.6, (bgCfg.targetBrightness ?? 52) / measured)).toFixed(3);
  const blurH = bgCfg.blurHeight ?? 480;
  const blurW = Math.round(blurH * (W / H) / 2) * 2;

  ff([
    '-ss', String(at), '-t', String(dur), '-i', bg,
    '-ss', String(start), '-t', String(dur), '-i', src,
    '-filter_complex',
    `[0:v]scale=-2:${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},` +
      `gblur=sigma=${bgCfg.blur ?? 6},lutyuv=y=val*${gain},scale=${W}:${H}:flags=bicubic,fps=${FPS}[bg];` +
    `[1:v]scale=${W}:-2,fps=${FPS}[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`,
    '-map', '[v]', '-map', '1:a?', '-t', String(dur), ...ENC, out,
  ]);
}

// --- баннер: картинка замирает, поверх играет ролик, потом видео едет дальше ---
const adCfg = cfg.ad ?? {};
function bannerFile() {
  if (!adCfg.file) return null;
  const f = path.isAbsolute(adCfg.file) ? adCfg.file : p(adCfg.file);
  return fs.existsSync(f) ? f : null;
}

function insertBanners(file, tmp) {
  const banner = bannerFile();
  if (!banner) { warn('баннер не задан — оставляю кусок как есть'); return file; }

  const dur = Number(probe(file, 'format=duration'));
  const speed = Number(adCfg.speed ?? 1);
  const insertDur = Number((Number(probe(banner, 'format=duration')) / speed).toFixed(3));
  const scale = Number(adCfg.scale ?? 0.86);
  const dim = Number(adCfg.dim ?? 0.45);
  const bw = Math.round(W * scale / 2) * 2;

  // середина каждой минуты: 0:30, 1:30, 2:30…
  const points = [];
  for (let t = OFFSET; t < dur - 5; t += EVERY) points.push(Number(t.toFixed(3)));
  if (!points.length) return file;

  const parts = [];
  let cursor = 0;
  points.forEach((at, i) => {
    const body = `${tmp}/body${i}.mp4`;
    ff(['-ss', String(cursor), '-t', String(at - cursor), '-i', file, ...ENC, body]);
    parts.push(body);

    const freeze = `${tmp}/freeze${i}.png`;
    ff(['-ss', String(at), '-i', file, '-frames:v', '1', freeze]);

    const ad = `${tmp}/ad${i}.mp4`;
    const vf = [
      `[0:v]scale=${W}:${H},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=black@${dim}:t=fill[bg]`,
      `[1:v]${speed !== 1 ? `setpts=PTS/${speed},` : ''}fps=${FPS},scale=${bw}:-2[b]`,
      `[bg][b]overlay=(W-w)/2:(H-h)/2[v]`,
    ].join(';');
    ff(['-loop', '1', '-t', String(insertDur), '-i', freeze, '-i', banner,
      '-filter_complex', `${vf};[1:a]${speed !== 1 ? `atempo=${speed},` : ''}aresample=44100[a]`,
      '-map', '[v]', '-map', '[a]', '-t', String(insertDur), ...ENC, ad]);
    parts.push(ad);
    cursor = at;
  });

  const tail = `${tmp}/tail.mp4`;
  ff(['-ss', String(cursor), '-i', file, ...ENC, tail]);
  parts.push(tail);

  const list = `${tmp}/list.txt`;
  fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const out = `${tmp}/joined.mp4`;
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  log(`   баннер вставлен ${points.length} раз: ${points.map((t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`).join(', ')}`);
  return out;
}

// --- нарезка ---
const src = source();
const total = Number(probe(src, 'format=duration'));
const outDir = p('out', 'clips');
fs.mkdirSync(outDir, {recursive: true});

let count = Math.max(1, Math.floor(total / LENGTH));
if (total - count * LENGTH >= MIN_TAIL) count += 1;      // хвост достаточной длины — отдельный ролик
if (LIMIT) count = Math.min(count, LIMIT);

const slug = path.basename(src).replace(/\.[^.]+$/, '').replace(/[^\wа-яА-Я-]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
log(`исходник ${(total / 60).toFixed(1)} мин → ${count} ролик(ов) по ${LENGTH / 60} мин`);

for (let i = 0; i < count; i++) {
  const start = i * LENGTH;
  const dur = Math.min(LENGTH, total - start);
  if (dur < 10) break;

  const tmp = p('out', `.clip-tmp-${i}`);
  fs.rmSync(tmp, {recursive: true, force: true});
  fs.mkdirSync(tmp, {recursive: true});

  log(`${i + 1}/${count}: ${Math.floor(start / 60)}:${String(Math.round(start % 60)).padStart(2, '0')} + ${Math.round(dur)}с`);
  const vertical = `${tmp}/vertical.mp4`;
  verticalize(src, start, dur, vertical);

  const withAds = insertBanners(vertical, tmp);
  const out = path.join(outDir, `${slug}-${String(i + 1).padStart(2, '0')}.mp4`);
  fs.rmSync(out, {force: true});
  fs.copyFileSync(withAds, out);
  fs.rmSync(tmp, {recursive: true, force: true});
  log(`   готово: ${out} (${probe(out, 'format=duration')}с)`);
}

log(`\nвсё готово → ${outDir}`);
