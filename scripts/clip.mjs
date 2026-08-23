/**
 * Нарезка длинного видео в вертикальные ролики для TikTok.
 *
 *   node scripts/clip.mjs --url https://...           # скачает и нарежет
 *   node scripts/clip.mjs --file video.mp4            # нарежет локальный файл
 *   node scripts/clip.mjs --file v.mp4 --length 90    # куски по полторы минуты
 *   node scripts/clip.mjs --file v.mp4 --limit 1      # только первый кусок (проверить)
 *   node scripts/clip.mjs --url ... --skip 4:07-4:30  # выкинуть рекламу автора
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
const SKIP = arg('skip', '');                                        // «4:07-4:30» — вырезать из исходника
const TITLE = arg('title', '');                                      // короткая надпись сверху
const NO_SUBS = argv.includes('--no-subs');

/** Путь для списка concat: ffmpeg хочет прямые слэши. */
const toPosix = (f) => f.split('\\').join('/');

/** «4:07» → 247, «1:02:30» → 3750, «95» → 95 */
function seconds(t) {
  const parts = String(t).trim().split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

/**
 * Вырезает из исходника заданные отрезки (реклама автора, заставки).
 * Делается один раз до нарезки: так куски считаются по чистому таймлайну
 * и ни один не разрывается на месте выреза.
 */
function cutOut(src, ranges) {
  const dur = Number(probe(src, 'format=duration'));
  const cuts = ranges.split(',').map((r) => {
    const [a, b] = r.split('-').map(seconds);
    return {from: a, to: b};
  }).filter((r) => r.to > r.from).sort((x, y) => x.from - y.from);
  if (!cuts.length) return src;

  const keep = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.from > cursor) keep.push({from: cursor, to: Math.min(c.from, dur)});
    cursor = Math.max(cursor, c.to);
  }
  if (cursor < dur) keep.push({from: cursor, to: dur});

  const tmp = p('out', '.cut-tmp');
  fs.rmSync(tmp, {recursive: true, force: true});
  fs.mkdirSync(tmp, {recursive: true});
  const parts = keep.map((k, i) => {
    const f = `${tmp}/keep${i}.mp4`;
    log(`   оставляю ${Math.floor(k.from / 60)}:${String(Math.round(k.from % 60)).padStart(2, '0')}` +
      `–${Math.floor(k.to / 60)}:${String(Math.round(k.to % 60)).padStart(2, '0')}`);
    ff(['-ss', String(k.from), '-t', String(k.to - k.from), '-i', src, ...ENC, f]);
    return f;
  });
  const list = `${tmp}/list.txt`;
  fs.writeFileSync(list, parts.map((f) => `file '${toPosix(f)}'`).join('\n'));
  const out = p('assets', 'source', path.basename(src).replace(/\.[^.]+$/, '') + '-clean.mp4');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  fs.rmSync(tmp, {recursive: true, force: true});
  log(`   вырезано ${cuts.length} отрезк(ов) → ${(Number(probe(out, 'format=duration')) / 60).toFixed(1)} мин`);
  return out;
}

const W = cfg.video?.width ?? 1080;
const H = cfg.video?.height ?? 1920;
const FPS = cfg.video?.fps ?? 30;

const ENC = ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];
// cwd нужен для субтитров: в filtergraph двоеточие диска Windows парсится как
// разделитель опций, а из нужной папки достаточно короткого имени файла
const ff = (args, cwd) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args],
  {stdio: ['ignore', 'ignore', 'inherit'], ...(cwd ? {cwd} : {})});
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

  const dir = p('assets', 'source');
  fs.mkdirSync(dir, {recursive: true});

  // Имя файла делаем из id ролика, а не из названия: кириллица в заголовке
  // ломается в кодировке консоли Windows, и путь потом не находится.
  const idRun = spawnSync('yt-dlp', ['--simulate', '--no-playlist', '--print', 'id', url], {encoding: 'utf8'});
  const id = (idRun.stdout || '').trim().split('\n').pop();
  if (!id) { console.error(idRun.stderr || 'не удалось получить id видео'); process.exit(1); }

  const existing = fs.readdirSync(dir).find((f) => f.startsWith(id + '.'));
  if (existing) { log(`исходник уже скачан: ${existing}`); return path.join(dir, existing); }

  log('скачиваю исходник…');
  const r = spawnSync('yt-dlp', [
    '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '-o', path.join(dir, id + '.%(ext)s'),
    url,
  ], {encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit']});
  if (r.status !== 0) { console.error('yt-dlp не смог скачать'); process.exit(1); }

  const got = fs.readdirSync(dir).find((f) => f.startsWith(id + '.'));
  if (!got) { console.error('файл не появился в assets/source'); process.exit(1); }
  log(`скачано: ${got}`);
  return path.join(dir, got);
}

// --- субтитры и заголовок ---

const FONT = cfg.clip?.font ?? 'Arial Black';
// цвета заголовка в формате ASS: там задом наперёд — BGR, а не RGB
const TITLE_COLORS = cfg.clip?.titleColors ?? ['&H00FFFFFF&', '&H0042B3F5&', '&H008AE037&'];

/** Автосубтитры ролика: качаются один раз и лежат рядом с исходником. */
function fetchSubs(url, id) {
  if (NO_SUBS) return null;
  const dir = p('assets', 'source');
  const srt = path.join(dir, `${id}.ru.srt`);
  if (fs.existsSync(srt)) return srt;
  if (!url) return null;
  log('качаю субтитры…');
  spawnSync('yt-dlp', ['--skip-download', '--write-auto-sub', '--sub-lang', 'ru',
    '--convert-subs', 'srt', '--no-playlist', '-o', path.join(dir, id), url],
    {encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore']});
  return fs.existsSync(srt) ? srt : null;
}

/**
 * Разбор автосубтитров. YouTube отдаёт их «бегущим окном»: в каждой реплике
 * повторяется предыдущая строка, а новая идёт последней. Берём только новую —
 * иначе на экране всё двоится.
 */
function parseSubs(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const secs = (t) => {
    const [h, m, rest] = t.split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(String(rest).replace(',', '.'));
  };
  const cues = [];
  for (const block of raw.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    const tl = lines.find((l) => l.includes('-->'));
    if (!tl) continue;
    const [from, to] = tl.split('-->').map((x) => secs(x.trim()));
    if (to - from < 0.05) continue;                    // технические врезки по 10 мс
    const text = lines.filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim()))
      .map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).pop();
    if (!text) continue;
    if (cues.length && cues[cues.length - 1].text === text) continue;
    cues.push({from, to, text});
  }
  // фраза висит до начала следующей: так текст не мигает
  for (let i = 0; i < cues.length - 1; i++) cues[i].to = Math.max(cues[i].to, cues[i + 1].from);
  return cues;
}

/** Время исходника → время после вырезов; null, если попало в вырезанное. */
function makeMapper(cuts) {
  return (t) => {
    let shift = 0;
    for (const c of cuts) {
      if (t >= c.from && t < c.to) return null;
      if (t >= c.to) shift += c.to - c.from;
    }
    return t - shift;
  };
}

const ass = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
};
const assEscape = (s) => s.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');

/** Заголовок: слова раскрашены по кругу, два-три цвета, как на референсе. */
function titleLine(text) {
  return text.split(/\s+/).filter(Boolean)
    .map((w, i) => `{\\c${TITLE_COLORS[i % TITLE_COLORS.length]}}${assEscape(w)}`)
    .join(' ');
}

/**
 * Разметка для одного куска: заголовок сверху висит всё время, субтитры снизу
 * идут по своим таймкодам. Белые с чёрной обводкой — читаются на любом фоне.
 */
function buildAss(file, title, cues, dur) {
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,' +
      ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,' +
      ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,${FONT},92,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,8,3,8,60,60,130,204`,
    `Style: Sub,${FONT},56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,2,2,90,90,380,204`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = [];
  if (title) events.push(`Dialogue: 0,${ass(0)},${ass(dur)},Title,,0,0,0,,${titleLine(title)}`);
  for (const c of cues) {
    events.push(`Dialogue: 0,${ass(c.from)},${ass(c.to)},Sub,,0,0,0,,${assEscape(c.text)}`);
  }
  fs.writeFileSync(file, head.concat(events).join('\n'), 'utf8');
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

/**
 * Рывок камеры в первые кадры куска: изображение наезжает и отскакивает назад.
 * Вместе с ударом звуком это то, ради чего зритель тормозит палец, — без такого
 * начала вертикалку пролистывают раньше, чем поймут, о чём она.
 */
const PUNCH_FROM = Number(arg('punch', cfg.clip?.punch ?? 1.28));   // 1 — выключить
const PUNCH_SEC = 0.34;
// crop размер по времени менять не умеет — он фиксируется при инициализации,
// поэтому наезд делаем zoompan: он для этого и сделан и держит размер кадра
const punchFilter = PUNCH_FROM > 1
  ? `,zoompan=z='if(lte(it\,${PUNCH_SEC})\,max(1\,${PUNCH_FROM}-${((PUNCH_FROM - 1) / PUNCH_SEC).toFixed(3)}*it)\,1)'` +
    `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`
  : '';

/** Звук-хук на первом кадре: свой файл, если положен в public/sfx/impact.mp3. */
function hookSound() {
  const f = p('public', 'sfx', 'impact.mp3');
  return fs.existsSync(f) ? f : null;
}

/** Кусок исходника в вертикальном кадре: размытый фон + видео по центру. */
function verticalize(src, start, dur, out, assFile) {
  const bg = bgSource();
  // подписи накладываются последними: поверх и видео, и фона
  const subs = assFile ? `,subtitles=${path.basename(assFile)}` : '';
  const hook = hookSound();

  if (!bg) {
    // фонового видео нет — просто чёрные поля
    ff(['-ss', String(start), '-t', String(dur), '-i', src,
      '-vf', `scale=${W}:-2,pad=${W}:${H}:0:(oh-ih)/2:black${punchFilter}${subs}`, ...ENC, out],
      assFile ? path.dirname(assFile) : undefined);
    return;
  }
  const bgDur = Number(probe(bg, 'format=duration'));
  const at = Math.max(0, Math.random() * Math.max(1, bgDur - dur - 30));
  const measured = bgBrightness(bg, at + 2) || 60;
  const gain = Math.max(0.1, Math.min(1.6, (bgCfg.targetBrightness ?? 52) / measured)).toFixed(3);
  const blurH = bgCfg.blurHeight ?? 480;
  const blurW = Math.round(blurH * (W / H) / 2) * 2;

  const video =
    `[0:v]scale=-2:${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},` +
      `gblur=sigma=${bgCfg.blur ?? 6},lutyuv=y=val*${gain},scale=${W}:${H}:flags=bicubic,fps=${FPS}[bg];` +
    `[1:v]scale=${W}:-2,fps=${FPS}[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1${punchFilter}${subs}[v]`;

  const args = [
    '-ss', String(at), '-t', String(dur), '-i', bg,
    '-ss', String(start), '-t', String(dur), '-i', src,
  ];
  if (hook) args.push('-i', hook);

  // звук хука подмешиваем к дорожке куска, а не поверх: иначе он режет громкость
  const audio = hook
    ? `;[1:a]aresample=44100[a0];[2:a]aresample=44100,adelay=0:all=1[a1];` +
      `[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`
    : '';

  args.push('-filter_complex', video + audio,
    '-map', '[v]', ...(hook ? ['-map', '[a]'] : ['-map', '1:a?']),
    '-t', String(dur), ...ENC, out);
  ff(args, assFile ? path.dirname(assFile) : undefined);
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
  fs.writeFileSync(list, parts.map((f) => `file '${toPosix(f)}'`).join('\n'));
  const out = `${tmp}/joined.mp4`;
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  log(`   баннер вставлен ${points.length} раз: ${points.map((t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`).join(', ')}`);
  return out;
}

// --- нарезка ---
const url = arg('url', null);
let src = source();

// субтитры берём до вырезов: их таймкоды в системе координат исходника
const videoId = path.basename(src).replace(/\.[^.]+$/, '').replace(/-clean$/, '');
const srtFile = fetchSubs(url, videoId);
const allCues = srtFile ? parseSubs(srtFile) : [];
if (srtFile) log(`субтитры: ${allCues.length} фраз`);
else if (!NO_SUBS) warn('субтитров нет — ролики соберутся без них');

let cutRanges = [];
if (SKIP) {
  log('убираю лишние отрезки из исходника…');
  cutRanges = SKIP.split(',').map((r) => {
    const [a, b] = r.split('-').map(seconds);
    return {from: a, to: b};
  }).filter((r) => r.to > r.from).sort((x, y) => x.from - y.from);
  src = cutOut(src, SKIP);
}
const toClean = makeMapper(cutRanges);

// заголовок: свой, либо коротко из названия ролика
let title = TITLE;
if (!title && url) {
  const r = spawnSync('yt-dlp', ['--simulate', '--no-playlist', '--print', 'title', url], {encoding: 'utf8'});
  title = (r.stdout || '').trim().split('\n').pop().split(/\s+/).slice(0, 5).join(' ');
}
if (title) log(`заголовок: «${title}»`);
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

  // субтитры этого куска: переводим из времени исходника в время куска
  const cues = [];
  for (const c of allCues) {
    const from = toClean(c.from);
    const to = toClean(c.to);
    if (from === null || to === null) continue;
    if (to <= start || from >= start + dur) continue;
    cues.push({
      from: Math.max(0, from - start),
      to: Math.min(dur, to - start),
      text: c.text,
    });
  }
  const assFile = `${tmp}/subs.ass`;
  if (title || cues.length) buildAss(assFile, title, cues, dur);
  if (cues.length) log(`   субтитров в куске: ${cues.length}`);

  const vertical = `${tmp}/vertical.mp4`;
  verticalize(src, start, dur, vertical, (title || cues.length) ? assFile : null);

  const withAds = insertBanners(vertical, tmp);
  const out = path.join(outDir, `${slug}-${String(i + 1).padStart(2, '0')}.mp4`);
  try {
    fs.rmSync(out, {force: true});
    fs.copyFileSync(withAds, out);
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EBUSY') {
      console.error(`
  файл занят: ${out}
  закрой его в плеере и запусти снова
`);
      process.exit(1);
    }
    throw e;
  }
  fs.rmSync(tmp, {recursive: true, force: true});
  log(`   готово: ${out} (${probe(out, 'format=duration')}с)`);
}

log(`\nвсё готово → ${outDir}`);
