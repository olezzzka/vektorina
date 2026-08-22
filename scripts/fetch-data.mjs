/**
 * Качает каталог скинов CS2 и цены. Результат — data/catalog.json.
 *
 * Провайдеры цен (config.priceProvider или --provider):
 *   github   — снапшот цен Steam из репозитория ByMykel (без ключей, обновляется ~ежедневно)
 *   skinport — публичный API Skinport (бесплатно, кэш 5 минут, реальные цены площадки)
 *   steam    — прямой Steam Market (медленно, ~20 запросов/мин; см. verify-prices.mjs)
 */
import fs from 'node:fs';
import {p, cached, httpGet, readJson, writeJson, config, log, warn} from './lib.mjs';

const SKINS_URL  = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json';
const GH_PRICES  = 'https://raw.githubusercontent.com/ByMykel/counter-strike-price-tracker/main/static/latest.json';
const SKINPORT   = 'https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cfg = config();
const provider = arg('provider', cfg.priceProvider);
const force = argv.includes('--force');

async function loadPrices() {
  if (provider === 'skinport') {
    log('цены: Skinport API');
    const items = await httpGet(SKINPORT, {json: true, headers: {'accept-encoding': 'br'}});
    const prices = {};
    for (const it of items) {
      const v = it.min_price ?? it.median_price ?? it.suggested_price;
      if (v) prices[it.market_hash_name] = Number(v);
    }
    return {prices, meta: {source: 'skinport', updatedAt: new Date().toISOString()}};
  }
  if (provider === 'steam') {
    warn('провайдер steam не отдаёт цены пачкой — беру github-снапшот как основу');
  }
  log('цены: снапшот Steam (counter-strike-price-tracker)');
  const {file} = await cached(GH_PRICES, p('data', 'prices.raw.json'), {maxAgeHours: force ? 0 : 12});
  const raw = readJson(file);
  const prices = {};
  for (const [k, v] of Object.entries(raw.prices ?? {})) if (v > 0) prices[k] = v / 100;
  return {prices, meta: {source: 'steam-snapshot', updatedAt: raw.metadata?.updated_at ?? null}};
}

const POPULAR = ['AK-47','M4A4','M4A1-S','AWP','USP-S','Glock-18','Desert Eagle','Karambit','Butterfly Knife',
  'M9 Bayonet','Bayonet','Talon Knife','Skeleton Knife','Bowie Knife','Flip Knife','Huntsman Knife',
  'Falchion Knife','Shadow Daggers','Ursus Knife','Stiletto Knife','Navaja Knife','Classic Knife','Nomad Knife',
  'Kukri Knife','P250','Five-SeveN','Tec-9','MAC-10','MP9','UMP-45','P90','Galil AR','FAMAS','SG 553','AUG','SSG 08','Dual Berettas','R8 Revolver'];


// Скины, которые узнают даже те, кто не играет. Дают вовлечение.
const HYPE = new Set([
  'Dragon Lore','Medusa','Howl','Fire Serpent','Wild Lotus','Gungnir','Hyper Beast','Asiimov','Redline',
  'Vulcan','Printstream','Neo-Noir','Bloodsport','Fuel Injector','Neon Rider','The Empress','Aquamarine Revenge',
  'Desolate Space','Cyrex','Guardian','Nightmare','Chantico\'s Fire','Hydroponic','Water Elemental','Twilight Galaxy',
  'Case Hardened','Fade','Doppler','Gamma Doppler','Marble Fade','Tiger Tooth','Crimson Web','Slaughter','Autotronic',
  'Lore','Blaze','Wildfire','Frontside Misty','Bullet Rain','Point Disarray','Legion of Anubis','Nightwish',
  'Head Shot','Fever Dream','Whiteout','Mecha Industries','Golden Coil','Kill Confirmed','Code Red','Orion',
  'Oni Taiji','Player Two','In Living Color','Cortex','Emerald','Ruby','Sapphire','Black Pearl','Hot Rod',
  'Neon Revolution','Dragon King','Man-o\'-war','Elite Build','The Prince','Poseidon','Containment Breach',
  'Ghost Crusader','Imperial Dragon','Decimator','Atheris','Ancient Visions','Duality','Jet Set','Emerald Dragon',
]);

const RARITY_TIER = {
  'Consumer Grade': 0, 'Industrial Grade': 1, 'Mil-Spec Grade': 2, 'Restricted': 3,
  'Classified': 4, 'Covert': 5, 'Contraband': 6, 'Extraordinary': 6,
};

const WEAR_SHORT = {
  'Factory New': 'FN', 'Minimal Wear': 'MW', 'Field-Tested': 'FT',
  'Well-Worn': 'WW', 'Battle-Scarred': 'BS',
};

async function main() {
  const {file: skinsFile} = await cached(SKINS_URL, p('data', 'skins.json'), {maxAgeHours: force ? 0 : 24 * 7});
  const skins = readJson(skinsFile);
  log(`каталог: ${skins.length} скинов`);

  const {prices, meta} = await loadPrices();
  log(`цены: ${Object.keys(prices).length} позиций, источник ${meta.source}, обновлено ${meta.updatedAt}`);

  const f = cfg.filters;
  const items = [];
  for (const s of skins) {
    const cat = s.category?.name ?? '';
    if (f.excludeCategories.includes(cat)) continue;
    const wears = s.wears?.length ? s.wears : [{name: null}];
    for (const w of wears) {
      if (w.name && f.excludeWears.includes(w.name)) continue;
      const variants = [{prefix: '', st: false}];
      if (s.stattrak && f.allowStatTrak) variants.push({prefix: 'StatTrak™ ', st: true});
      if (s.souvenir && f.allowSouvenir) variants.push({prefix: 'Souvenir ', st: false});
      for (const v of variants) {
        // ножи в каталоге уже с ★, StatTrak у них пишется как "★ StatTrak™ Name"
        const base = v.st && s.name.startsWith('★ ')
          ? `★ StatTrak™ ${s.name.slice(2)}`
          : `${v.prefix}${s.name}`;
        const hash = w.name ? `${base} (${w.name})` : base;
        const price = prices[hash];
        if (!price || price < f.minPrice || price > f.maxPrice) continue;
        items.push({
          hash,
          name: s.name.replace(/^★ /, ''),
          weapon: s.weapon?.name ?? cat,
          category: cat,
          pattern: s.pattern?.name ?? '',
          wear: w.name,
          wearShort: w.name ? WEAR_SHORT[w.name] ?? w.name : '',
          rarity: s.rarity?.name ?? '',
          rarityTier: RARITY_TIER[s.rarity?.name] ?? 0,
          color: s.rarity?.color ?? '#666666',
          knife: /Knives|Gloves/.test(cat),
          popular: POPULAR.includes(s.weapon?.name ?? ''),
          hype: HYPE.has(s.pattern?.name ?? ''),
          image: s.image,
          price,
        });
      }
    }
  }

  items.sort((a, b) => b.price - a.price);
  writeJson(p('data', 'catalog.json'), {meta, count: items.length, items});
  log(`готово: ${items.length} позиций с ценой → data/catalog.json`);
  log(`   дороже $100: ${items.filter(i => i.price > 100).length}, дешевле $10: ${items.filter(i => i.price < 10).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
