import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...s) => path.join(ROOT, ...s);

export const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
export const writeJson = (f, data) => {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
};
/** Глубокий мёрж: config.local.json (в .gitignore) перекрывает config.json. */
const deepMerge = (base, over) => {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = {...base};
  for (const k of Object.keys(over)) out[k] = deepMerge(base?.[k], over[k]);
  return out;
};
export const config = () => deepMerge(readJson(p('config.json')), readJson(p('config.local.json'), {}));

/** Читает .env в корне проекта в process.env (существующие переменные не трогает). */
export function loadEnv() {
  let raw;
  try { raw = fs.readFileSync(p('.env'), 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const log = (...a) => console.log('·', ...a);
export const warn = (...a) => console.warn('!', ...a);

const AGENT = 'cs2-skin-quiz/1.0 (+local pipeline)';

export async function httpGet(url, {json = false, binary = false, timeout = 60000, retries = 2, headers = {}} = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {signal: ctrl.signal, headers: {'user-agent': AGENT, ...headers}});
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (json) return await res.json();
      if (binary) return Buffer.from(await res.arrayBuffer());
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(800 * (i + 1));
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Скачивает URL в файл, если файла нет или он старше maxAgeHours. */
export async function cached(url, file, {maxAgeHours = 24, binary = false} = {}) {
  try {
    const st = fs.statSync(file);
    const ageH = (Date.now() - st.mtimeMs) / 36e5;
    if (ageH < maxAgeHours && st.size > 0) return {file, fresh: false};
  } catch {}
  const data = await httpGet(url, {binary});
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, binary ? data : data, binary ? undefined : 'utf8');
  return {file, fresh: true};
}

export const rnd = (a) => a[Math.floor(Math.random() * a.length)];
export const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
export const money = (v) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
