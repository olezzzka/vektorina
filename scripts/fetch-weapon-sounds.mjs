/**
 * Достаёт звуки выстрелов из файлов CS2 для рубрики «угадай оружие по звуку».
 *
 *   node scripts/fetch-weapon-sounds.mjs [--force]
 *
 * Из каждой папки оружия берётся первый вариант выстрела (<префикс>_01),
 * обрезается тишина, нормализуется громкость и остаётся ~1.2 секунды —
 * ровно выстрел, без перезарядки и затвора.
 * Результат: public/weapon-sfx/<ключ>.wav + data/weapon-sounds.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {p, writeJson, log, warn} from './lib.mjs';

const force = process.argv.includes('--force');
const VRF = p('tools', 'vrf', 'Source2Viewer-CLI.exe');

/** Папка звуков в игре → как оружие называется на экране. */
const WEAPONS = {
  ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', awp: 'AWP',
  ssg08: 'SSG 08', scar20: 'SCAR-20', g3sg1: 'G3SG1', aug: 'AUG', sg556: 'SG 553',
  famas: 'FAMAS', galilar: 'Galil AR', m249: 'M249', negev: 'Negev',
  p90: 'P90', bizon: 'PP-Bizon', mac10: 'MAC-10', mp7: 'MP7', mp9: 'MP9',
  ump45: 'UMP-45', mp5sd: 'MP5-SD',
  nova: 'Nova', xm1014: 'XM1014', sawedoff: 'Sawed-Off', mag7: 'MAG-7',
  deagle: 'Desert Eagle', revolver: 'R8 Revolver', glock18: 'Glock-18',
  hkp2000: 'P2000', usp_silencer: 'USP-S', p250: 'P250',
  cz75a: 'CZ75-Auto', fiveseven: 'Five-SeveN', tec9: 'Tec-9', elite: 'Dual Berettas',
};

function findGame() {
  const roots = ['C:/Program Files (x86)/Steam', 'C:/Steam', 'D:/Steam', 'D:/SteamLibrary', 'E:/SteamLibrary'];
  for (const r of roots) {
    const f = `${r}/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk`;
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const vpk = findGame();
if (!vpk) { console.error('не нашёл установленную CS2'); process.exit(1); }
if (!fs.existsSync(VRF)) { console.error('нет распаковщика — сначала node scripts/fetch-callouts.mjs'); process.exit(1); }

log('читаю список звуков…');
const listing = execFileSync(VRF, ['-i', vpk, '-e', 'vsnd_c', '-l'],
  {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024})
  .split('\n')
  .map((l) => l.trim().split(' ')[0])
  .filter((f) => f.startsWith('sounds/weapons/'));

const outDir = p('public', 'weapon-sfx');
fs.mkdirSync(outDir, {recursive: true});
const tmp = p('data', '.snd-tmp');

const sounds = [];
for (const [folder, label] of Object.entries(WEAPONS)) {
  const out = path.join(outDir, `${folder}.wav`);
  if (fs.existsSync(out) && !force) { sounds.push({key: folder, label, file: `weapon-sfx/${folder}.wav`}); continue; }

  const inFolder = listing.filter((f) => f.startsWith(`sounds/weapons/${folder}/`));
  // именно выстрел: <префикс>_01, без затворов, перезарядок и осмотров
  const shot = inFolder.find((f) => /_0?1\.vsnd_c$/.test(f) &&
    !/(boltpull|boltback|boltforward|clip|draw|deploy|zoom|slide|magrelease|addammo|dryfire|switch|reload|inspect|lookat|distant|element|foley|body|silencer_off|silencer_on)/i.test(f));
  if (!shot) { warn(`${folder}: не нашёл звук выстрела`); continue; }

  fs.rmSync(tmp, {recursive: true, force: true});
  execFileSync(VRF, ['-i', vpk, '-f', shot, '-o', tmp, '-d'], {stdio: 'ignore'});
  const raw = fs.statSync(tmp).isDirectory()
    ? (function walk(d) {
        for (const e of fs.readdirSync(d, {withFileTypes: true})) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) { const r = walk(full); if (r) return r; }
          else if (e.name.endsWith('.wav')) return full;
        }
        return null;
      })(tmp)
    : tmp;
  if (!raw) { warn(`${folder}: распаковщик не отдал wav`); continue; }

  const cut = 'silenceremove=start_periods=1:start_silence=0:start_threshold=-45dB:detection=peak';
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw,
    '-af', `${cut},loudnorm=I=-16:TP=-1.5,afade=t=out:st=1.1:d=0.25`,
    '-t', '1.35', '-ar', '44100', '-ac', '2', out], {stdio: ['ignore', 'ignore', 'inherit']});
  fs.rmSync(tmp, {recursive: true, force: true});

  sounds.push({key: folder, label, file: `weapon-sfx/${folder}.wav`});
  log(`${label}: ${path.basename(shot)}`);
}

writeJson(p('data', 'weapon-sounds.json'), {updatedAt: new Date().toISOString(), sounds});
log(`\nготово: ${sounds.length} стволов → public/weapon-sfx/`);
