/**
 * Достаёт названия позиций (калаутов) с координатами прямо из файлов CS2
 * и радары карт. Данные официальные — это те же имена, что игра показывает
 * в киллфиде, поэтому ответы в викторине точные по построению.
 *
 *   node scripts/fetch-callouts.mjs [--maps de_mirage,de_dust2]
 *
 * Нужен установленный CS2 и распаковщик Source 2 в tools/vrf (ставится сам).
 * Результат: data/callouts.json + public/radars/<map>.png
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {p, httpGet, writeJson, readJson, log, warn} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

// карты с одноуровневым радаром: у Nuke/Vertigo/Train два этажа, отметка на
// плоском радаре была бы неоднозначной — их пока не берём
const MAPS = (arg('maps', 'de_mirage,de_dust2,de_inferno,de_overpass,de_ancient,de_anubis,de_cache,de_italy,de_office')).split(',');

const VRF = p('tools', 'vrf', 'Source2Viewer-CLI.exe');
const VRF_URL = 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0/cli-windows-x64.zip';
const ICONS = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main';

/** Ищет установленную CS2 по стандартным местам Steam. */
function findGame() {
  const roots = [
    'C:/Program Files (x86)/Steam', 'C:/Steam', 'D:/Steam', 'D:/SteamLibrary', 'E:/SteamLibrary',
  ];
  for (const r of roots) {
    const dir = `${r}/steamapps/common/Counter-Strike Global Offensive/game/csgo/maps`;
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

async function ensureVrf() {
  if (fs.existsSync(VRF)) return;
  log('качаю распаковщик Source 2…');
  fs.mkdirSync(p('tools'), {recursive: true});
  const zip = p('tools', 'vrf.zip');
  fs.writeFileSync(zip, await httpGet(VRF_URL, {binary: true, timeout: 300000}));
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path '${zip}' -DestinationPath '${p('tools', 'vrf')}' -Force`], {stdio: 'ignore'});
  fs.rmSync(zip, {force: true});
}

/**
 * Габариты зоны из физического блока её модели. Координата у самой сущности —
 * это угол привязки, а не центр: без этой поправки отметка уезжает на четверть
 * карты и указывает на соседний калаут.
 */
function zoneBounds(vpk, model) {
  const file = `${model.replace(/^resource_name:"|"$/g, '')}_c`;
  try {
    const out = execFileSync(VRF, ['-i', vpk, '-f', file, '-b', 'PHYS'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024});
    const mins = out.match(/m_vMinBounds = \[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/);
    const maxs = out.match(/m_vMaxBounds = \[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/);
    if (!mins || !maxs) return null;
    return {
      min: [Number(mins[1]), Number(mins[2])],
      max: [Number(maxs[1]), Number(maxs[2])],
    };
  } catch { return null; }
}

/** Вытаскивает env_cs_place: имя позиции, центр зоны и её размер в мире. */
function callouts(mapsDir, map) {
  const vpk = path.join(mapsDir, `${map}.vpk`);
  if (!fs.existsSync(vpk)) { warn(`нет ${map}.vpk`); return []; }

  const list = execFileSync(VRF, ['-i', vpk, '-e', 'vents_c', '-l'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  const entFile = list.split('\n').map((l) => l.trim().split(' ')[0]).find((f) => f.endsWith('.vents_c'));
  if (!entFile) { warn(`${map}: не нашёл файл сущностей`); return []; }

  const dump = p('data', '.ents-tmp');
  fs.rmSync(dump, {force: true});
  execFileSync(VRF, ['-i', vpk, '-f', entFile, '-o', dump, '-d'], {stdio: 'ignore'});
  const text = fs.readFileSync(dump, 'utf8');
  fs.rmSync(dump, {force: true});

  // блок сущности: place_name идёт перед classname, origin и model — следом
  const re = /place_name\s+"([^"]+)"\s*\r?\nclassname\s+"env_cs_place"[\s\S]{0,300}?origin\s+\[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\][\s\S]{0,300}?model\s+(resource_name:"[^"]+")/g;
  const byName = new Map();
  let m;
  while ((m = re.exec(text))) {
    const [name, ox, oy] = [m[1], Number(m[2]), Number(m[3])];
    const b = zoneBounds(vpk, m[5]);
    if (!b) continue;
    const spot = {
      name,
      x: ox + (b.min[0] + b.max[0]) / 2,
      y: oy + (b.min[1] + b.max[1]) / 2,
      w: b.max[0] - b.min[0],
      h: b.max[1] - b.min[1],
    };
    // одно имя иногда покрыто несколькими объёмами — оставляем самый крупный
    const prev = byName.get(name);
    if (!prev || spot.w * spot.h > prev.w * prev.h) byName.set(name, spot);
  }
  return [...byName.values()];
}

/** Радар и его координатная привязка (pos_x/pos_y/scale). */
async function radar(map) {
  fs.mkdirSync(p('public', 'radars'), {recursive: true});
  const png = p('public', 'radars', `${map}.png`);
  if (!fs.existsSync(png)) {
    const buf = await httpGet(`${ICONS}/images/radars/${map}_radar_psd.png`, {binary: true, timeout: 120000});
    fs.writeFileSync(png, buf);
  }
  const txt = await httpGet(`${ICONS}/data/radar_info/${map}.txt`, {timeout: 60000});
  const num = (key) => {
    const m = txt.match(new RegExp(`"${key}"\\s+"([-\\d.]+)"`));
    return m ? Number(m[1]) : null;
  };
  return {pos_x: num('pos_x'), pos_y: num('pos_y'), scale: num('scale')};
}

// --- сборка ---
const mapsDir = findGame();
if (!mapsDir) { console.error('не нашёл установленную CS2'); process.exit(1); }
await ensureVrf();

const db = readJson(p('data', 'callouts.json'), {maps: {}});
for (const map of MAPS) {
  const spots = callouts(mapsDir, map);
  if (!spots.length) continue;
  const info = await radar(map);
  if (info.pos_x === null) { warn(`${map}: нет привязки радара`); continue; }
  db.maps[map] = {radar: `radars/${map}.png`, ...info, spots};
  log(`${map}: ${spots.length} позиций → ${spots.slice(0, 4).map((s) => s.name).join(', ')}…`);
}
db.updatedAt = new Date().toISOString();
writeJson(p('data', 'callouts.json'), db);
log(`\nготово: ${Object.keys(db.maps).length} карт → data/callouts.json`);
