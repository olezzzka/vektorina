/**
 * Локальная панель управления: собирать ролики кнопками, а не командами.
 *
 *   npm run ui        → http://localhost:4321
 *
 * Без зависимостей: обычный http-сервер отдаёт одну страницу, запускает
 * build.mjs дочерним процессом и стримит его вывод в браузер через SSE.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {p, readJson, config} from './lib.mjs';

const PORT = Number(process.env.PORT ?? 4321);
const HTML = p('scripts', 'studio.html');

/** Текущая сборка: один прогон за раз, чтобы не драться за файлы и CPU. */
let job = null;            // {proc, lines, done, code, started}
const clients = new Set(); // подписчики на живой лог

const send = (res, event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const push = (line) => {
  if (!job) return;
  const clean = line.replace(ANSI, '');
  job.lines.push(clean);
  if (job.lines.length > 400) job.lines.shift();
  for (const c of clients) send(c, 'log', clean);
};

/** Нарезка длинного видео — тот же механизм запуска и лога, что у сборки. */
function startClip(opts) {
  if (job && !job.done) return false;
  const args = [p('scripts', 'clip.mjs')];
  if (opts.url) args.push('--url', opts.url);
  else if (opts.file) args.push('--file', opts.file);
  else return false;
  if (opts.length) args.push('--length', String(opts.length));
  if (opts.every) args.push('--every', String(opts.every));
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.title) args.push('--title', opts.title);
  if (opts.skip) args.push('--skip', opts.skip);
  return spawnJob(args);
}

function startBuild(opts) {
  if (job && !job.done) return false;
  const args = [p('scripts', 'build.mjs'), '--count', String(opts.count || 1)];
  if (opts.format && opts.format !== 'config') args.push('--format', opts.format);
  if (opts.rounds) args.push('--rounds', String(opts.rounds));
  if (!opts.data) args.push('--skip-data');
  if (!opts.voice) args.push('--no-voice');
  if (!opts.ad) args.push('--no-ad');
  if (!opts.bg) args.push('--no-bg');
  return spawnJob(args);
}

function spawnJob(args) {
  const proc = spawn(process.execPath, args, {cwd: p(), env: process.env});
  job = {proc, lines: [], done: false, code: null, started: Date.now()};

  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) if (line.trim()) push(line);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => {
    job.done = true;
    job.code = code;
    for (const c of clients) send(c, 'done', {code});
  });
  return true;
}

/** Список готовых роликов с данными викторины. */
function videos() {
  const dir = p('out', 'videos');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const id = f.replace(/\.mp4$/, '');
      const st = fs.statSync(path.join(dir, f));
      const quiz = readJson(p('out', 'quizzes', id + '.json'));
      return {
        id,
        size: st.size,
        mtime: st.mtimeMs,
        format: (quiz && quiz.format) || '—',
        rounds: (quiz && quiz.rounds && quiz.rounds.length) || 0,
        hasVoice: Boolean(quiz && quiz.voice),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** Кадр-превью: делается один раз и кэшируется. */
function poster(id, cb) {
  const dir = p('out', '.posters');
  fs.mkdirSync(dir, {recursive: true});
  const out = path.join(dir, id + '.jpg');
  if (fs.existsSync(out)) return cb(out);
  const src = p('out', 'videos', id + '.mp4');
  if (!fs.existsSync(src)) return cb(null);
  execFile('ffmpeg', ['-v', 'error', '-y', '-ss', '9', '-i', src, '-frames:v', '1',
    '-vf', 'scale=360:-2', out], () => cb(fs.existsSync(out) ? out : null));
}

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => resolve(b));
});

const json = (res, obj) => {
  res.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
};

const sendFile = (res, filePath, type) => {
  if (!filePath || !fs.existsSync(filePath)) { res.writeHead(404); return res.end('нет файла'); }
  res.writeHead(200, {'content-type': type, 'content-length': fs.statSync(filePath).size});
  fs.createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const route = url.pathname;

  if (route === '/') return sendFile(res, HTML, 'text/html; charset=utf-8');

  if (route === '/api/state') {
    const cfg = config();
    const v = cfg.voice || {};
    return json(res, {
      videos: videos(),
      running: Boolean(job && !job.done),
      lines: (job && job.lines) || [],
      config: {
        format: cfg.format,
        rounds: cfg.roundsPerVideo,
        engine: v.engine,
        voice: v.engine === 'xtts' ? v.xttsSpeaker : v.speaker,
        music: Boolean(cfg.audio && cfg.audio.music && cfg.audio.music.file),
        ad: Boolean(cfg.ad && cfg.ad.file),
        background: Boolean(cfg.background && cfg.background.file),
      },
    });
  }

  if (route === '/api/build' && req.method === 'POST') {
    const opts = JSON.parse((await readBody(req)) || '{}');
    return json(res, {ok: startBuild(opts)});
  }

  if (route === '/api/clip' && req.method === 'POST') {
    const opts = JSON.parse((await readBody(req)) || '{}');
    return json(res, {ok: startClip(opts)});
  }

  if (route === '/api/stop' && req.method === 'POST') {
    if (job && !job.done) job.proc.kill();
    return json(res, {ok: true});
  }

  if (route === '/api/logs') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (route.startsWith('/api/text/')) {
    const rest = route.replace('/api/text/', '').split('/');
    const kind = rest[0];
    const id = rest.slice(1).join('/');
    const f = kind === 'caption' ? p('out', 'captions', id + '.txt') : p('out', 'scripts', id + '.txt');
    return json(res, {text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'файла нет'});
  }

  if (route.startsWith('/poster/')) {
    const id = decodeURIComponent(route.replace('/poster/', '').replace('.jpg', ''));
    return poster(id, (f) => sendFile(res, f, 'image/jpeg'));
  }

  if (route.startsWith('/video/')) {
    const id = decodeURIComponent(route.replace('/video/', '').replace('.mp4', ''));
    const f = p('out', 'videos', id + '.mp4');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    // Range нужен, чтобы в плеере работала перемотка
    const size = fs.statSync(f).size;
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes'});
      return fs.createReadStream(f).pipe(res);
    }
    const parts = range.replace(/bytes=/, '').split('-');
    const start = Number(parts[0]);
    const end = parts[1] ? Number(parts[1]) : size - 1;
    res.writeHead(206, {
      'content-range': 'bytes ' + start + '-' + end + '/' + size,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      'content-type': 'video/mp4',
    });
    return fs.createReadStream(f, {start, end}).pipe(res);
  }

  res.writeHead(404);
  res.end('нет такой страницы');
});

/**
 * Если порт занят — берём следующий, а не падаем стеком: панель часто уже
 * запущена в соседнем окне, и человеку нужен адрес, а не трассировка.
 */
function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (attempt === 0) {
      console.log('\n  порт ' + port + ' занят — возможно, панель уже запущена в другом окне.');
      console.log('  сначала проверь http://localhost:' + port + ', иначе беру следующий…');
    }
    if (attempt >= 10) {
      console.error('  свободный порт не нашёлся — закрой лишние окна');
      process.exit(1);
    }
    listen(port + 1, attempt + 1);
  });
  server.listen(port, () => {
    console.log('\n  панель управления: http://localhost:' + port + '\n');
  });
}

listen(PORT);
