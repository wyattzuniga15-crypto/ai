// Balance check for Bean Baron. Loads the economy block straight out of the
// page so the simulation can never drift from what players run, then plays a
// greedy "best payback first" strategy with a plausible tapping rate and a
// player who catches most golden beans.
//
//   node tools/beanbaron_sim.js [minutes] [BeanBaron.html] [goldCatchRate=0.7]
const fs = require('fs'), path = require('path');
const MIN = +process.argv[2] || 90;
const src = process.argv[3] || path.join(__dirname, '..', 'BeanBaron.html');
const CATCH = process.argv[4] != null ? +process.argv[4] : 0.7;
let E;
if (src.endsWith('.js')) E = require(path.resolve(src));
else {
  const page = fs.readFileSync(src, 'utf8');
  const a = page.indexOf('// ---- Bean Baron economy'), b = page.indexOf('// ---- end economy');
  if (a < 0 || b < 0) throw new Error('economy block not found in page');
  E = new Function('module', page.slice(a, b) + '\nreturn BeanBaronEconomy;')({});
}

// deterministic rng so runs are comparable
let seed = 12345; const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

let s = E.newState(0);
let t = 0; const DT = 0.5;
const firstBuy = {}; const upgAt = []; let golds = 0;
let nextLog = 0, hit = null;
// taps per second: eager at first, then the occasional poke
const tps = t => t < 180 ? 5 : t < 900 ? 3 : t < 1800 ? 1.5 : 0.8;
const value = (s2, s1) => E.cashPerSec(s2) - E.cashPerSec(s1) + (E.tapValue(s2) - E.tapValue(s1)) * tps(t);

while (t < MIN * 60) {
  // a rush buff inflates cashPerSec; judge purchases on the calm rate
  const calm = { ...s, buffs: { rush: 0, frenzy: 0 } };
  const income = E.cashPerSec(calm) + E.tapValue(calm) * tps(t);
  let best = null;
  for (let gi = 0; gi < E.GENS.length; gi++) {
    const owned = calm.owned[gi];
    for (const n of [1, Math.max(1, (E.nextMilestone(calm, owned) || owned + 1) - owned)]) {
      const cost = E.genCost(gi, owned, n);
      const s2 = { ...calm, owned: calm.owned.slice() }; s2.owned[gi] += n;
      const d = value(s2, calm); if (d <= 0) continue;
      const score = Math.max(0, (cost - s.cash) / income) + cost / d;
      if (!best || score < best.score) best = { score, type: 'gen', gi, n, cost };
    }
  }
  for (const u of E.availableUpgrades(calm)) {
    if (u.kind === 'offline') continue;
    const d = value({ ...calm, upgrades: { ...calm.upgrades, [u.id]: true } }, calm); if (d <= 0) continue;
    const cost = E.upgradeCost(calm, u);
    const score = Math.max(0, (cost - s.cash) / income) + cost / d;
    if (!best || score < best.score) best = { score, type: 'upg', id: u.id, cost, name: u.name };
  }
  if (best && best.cost <= s.cash) {
    if (best.type === 'gen') {
      if (s.owned[best.gi] === 0) firstBuy[E.GENS[best.gi].name] = t;
      s = E.buyGen(s, best.gi, best.n);
    } else { s = E.buyUpgrade(s, best.id); upgAt.push(best.name + '@' + Math.round(t / 60)); }
    s.events = [];
    continue;
  }
  s = E.step(s, DT, rng);
  if (s.gold && s.gold.until - s.playtime < 4 && rng() < CATCH) { s = E.catchGold(s); golds++; }
  for (let k = 0; k < tps(t) * DT; k++) s = E.tap(s)[0];
  s.events = [];
  t += DT;
  if (!hit && s.lifetime >= E.PRESTIGE_UNIT) hit = t;
  if (t >= nextLog) {
    nextLog += 300;
    console.log(`t=${(t / 60).toFixed(0).padStart(3)}m  cash=${E.fmtCash(s.cash).padEnd(10)} $/s=${E.fmt(E.cashPerSec(s)).padEnd(9)} lifetime=${E.fmt(s.lifetime).padEnd(9)} owned=${s.owned.join('/')}  price=x${E.fmt(E.priceMult(s))} ach=${E.achCount(s)}`);
  }
}
console.log('\nfirst of each tier (min):', Object.entries(firstBuy).map(([k, v]) => `${k} ${(v / 60).toFixed(1)}`).join(', '));
console.log('upgrades (min):', upgAt.join(', '));
console.log('golden beans caught:', golds, '| achievements:', E.achCount(s) + '/' + E.ACH.length);
console.log('\n$1T lifetime reached at', hit ? (hit / 60).toFixed(1) + ' min' : 'never', '| Roast Points banked by the end:', E.rpFor(s.lifetime));
