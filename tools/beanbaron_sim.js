// Balance check for Bean Baron. Loads the economy block straight out of the
// page so the simulation can never drift from what players run, then plays a
// greedy "best payback first" strategy with a plausible tapping rate.
//
//   node tools/beanbaron_sim.js [minutes] [BeanBaron.html]
const fs = require('fs'), path = require('path');
const MIN = +process.argv[2] || 90;
const page = fs.readFileSync(process.argv[3] || path.join(__dirname, '..', 'BeanBaron.html'), 'utf8');
const a = page.indexOf('// ---- Bean Baron economy'), b = page.indexOf('// ---- end economy');
if (a < 0 || b < 0) throw new Error('economy block not found in page');
const E = new Function('module', page.slice(a, b) + '\nreturn BeanBaronEconomy;')({});

let s = E.newState(0);
let t = 0; const DT = 0.5;
const firstBuy = {}; const upgAt = [];
let nextLog = 0, hit = null;
// taps per second: eager at first, then the occasional poke
const tps = t => t < 180 ? 5 : t < 900 ? 3 : t < 1800 ? 1.5 : 0.8;
const value = (s2, s1) => E.cashPerSec(s2) - E.cashPerSec(s1) + (E.tapValue(s2) - E.tapValue(s1)) * tps(t);

while (t < MIN * 60) {
  const income = E.cashPerSec(s) + E.tapValue(s) * tps(t);
  let best = null;
  for (let gi = 0; gi < E.GENS.length; gi++) {
    const owned = s.owned[gi];
    for (const n of [1, Math.max(1, (E.nextMilestone(owned) || owned + 1) - owned)]) {
      const cost = E.genCost(gi, owned, n);
      const s2 = { ...s, owned: s.owned.slice() }; s2.owned[gi] += n;
      const d = value(s2, s); if (d <= 0) continue;
      const score = Math.max(0, (cost - s.cash) / income) + cost / d;
      if (!best || score < best.score) best = { score, type: 'gen', gi, n, cost };
    }
  }
  for (const u of E.availableUpgrades(s)) {
    if (u.kind === 'offline') continue;
    const d = value({ ...s, upgrades: { ...s.upgrades, [u.id]: true } }, s); if (d <= 0) continue;
    const score = Math.max(0, (u.cost - s.cash) / income) + u.cost / d;
    if (!best || score < best.score) best = { score, type: 'upg', id: u.id, cost: u.cost, name: u.name };
  }
  if (best && best.cost <= s.cash) {
    if (best.type === 'gen') {
      if (s.owned[best.gi] === 0) firstBuy[E.GENS[best.gi].name] = t;
      s = E.buyGen(s, best.gi, best.n);
    } else { s = E.buyUpgrade(s, best.id); upgAt.push(best.name + '@' + Math.round(t / 60)); }
    continue;
  }
  s = E.step(s, DT);
  for (let k = 0; k < tps(t) * DT; k++) s = E.tap(s)[0];
  t += DT;
  if (!hit && s.lifetime >= E.PRESTIGE_UNIT) hit = t;
  if (t >= nextLog) {
    nextLog += 300;
    console.log(`t=${(t / 60).toFixed(0).padStart(3)}m  cash=${E.fmtCash(s.cash).padEnd(10)} $/s=${E.fmt(E.cashPerSec(s)).padEnd(9)} lifetime=${E.fmt(s.lifetime).padEnd(9)} owned=${s.owned.join('/')}  price=x${E.fmt(E.priceMult(s))}`);
  }
}
console.log('\nfirst of each tier (min):', Object.entries(firstBuy).map(([k, v]) => `${k} ${(v / 60).toFixed(1)}`).join(', '));
console.log('upgrades (min):', upgAt.join(', '));
console.log('\n$1T lifetime reached at', hit ? (hit / 60).toFixed(1) + ' min' : 'never', '| Roast Points banked by the end:', E.rpFor(s.lifetime));
