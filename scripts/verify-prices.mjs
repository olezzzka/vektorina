/**
 * Перепроверяет цены только тех 10 позиций, что попали в ролик, напрямую в Steam Market.
 * Steam лимитит ~20 запросов в минуту, поэтому запрос раз в 3.5 секунды.
 *
 *   node scripts/verify-prices.mjs out/quizzes/<id>.json [--drop]
 *
 * --drop  выкидывает раунд, если после уточнения ответ переворачивается или разрыв < 15%.
 */
import fs from 'node:fs';
import {p, httpGet, readJson, writeJson, sleep, log, warn} from './lib.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => a.endsWith('.json')) ??
  p('out', 'quizzes', `${fs.readFileSync(p('out', 'last-quiz-id.txt'), 'utf8').trim()}.json`);
const drop = argv.includes('--drop');
const quiz = readJson(file);

const steamPrice = async (hash) => {
  const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(hash)}`;
  const r = await httpGet(url, {json: true, retries: 1, timeout: 20000});
  const raw = r.median_price ?? r.lowest_price;
  if (!raw) return null;
  return Number(String(raw).replace(/[^0-9.,]/g, '').replace(',', '.'));
};

const kept = [];
for (const round of quiz.rounds) {
  let changed = false;
  for (const key of ['a', 'b']) {
    try {
      const v = await steamPrice(round[key].hash);
      if (v) {
        if (Math.abs(v - round[key].price) / round[key].price > 0.02) changed = true;
        round[key].price = v;
      }
    } catch (e) { warn(`не удалось уточнить ${round[key].hash}: ${e.message}`); }
    await sleep(3500);
  }
  const answer = round.a.price > round.b.price ? 'a' : 'b';
  const hi = Math.max(round.a.price, round.b.price), lo = Math.min(round.a.price, round.b.price);
  round.ratio = Number((hi / lo).toFixed(2));
  if (answer !== round.answer) { warn(`ответ перевернулся: ${round.a.name} vs ${round.b.name}`); round.answer = answer; }
  if (drop && round.ratio < 1.15) { warn(`выкидываю близкий раунд (x${round.ratio})`); continue; }
  if (changed) log(`уточнено: ${round.a.name} $${round.a.price} vs ${round.b.name} $${round.b.price}`);
  kept.push(round);
}
quiz.rounds = kept;
quiz.priceMeta = {source: 'steam-live', updatedAt: new Date().toISOString()};
writeJson(file, quiz);
log(`готово, раундов осталось: ${kept.length}`);
