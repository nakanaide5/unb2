// Проверка разбора раздач: node test-parser.js
const fs = require('fs');
const path = require('path');
const { parseFile } = require('./parser.js');

const text = fs.readFileSync(path.join(__dirname, 'samples', 'sample_hands.txt'), 'utf8');
const { hands, failed } = parseFile(text);

let errors = 0;
function eq(label, got, want) {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-6 : got === want;
  if (!ok) { errors++; console.log(`  ✗ ${label}: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`); }
}

eq('раздач', hands.length, 4);
eq('ошибок', failed, 0);
const [h1, h2, h3, h4] = hands;

// 1: стил с баттона + контбет
eq('h1 site', h1.site, 'PokerStars');
eq('h1 hero', h1.hero, 'Hero');
eq('h1 net', h1.net, 0.27);
eq('h1 pos', h1.heroPos, 'BTN');
eq('h1 class', h1.heroClass, 'AQo');
const s1 = h1.players.Hero;
eq('h1 steal', s1.st, 1);
eq('h1 cbet', s1.cb, 1);
eq('h1 BB fold to cbet', h1.players.VillainE.fcb, 1);
eq('h1 BB pos', h1.players.VillainE.pos, 'BB');
eq('h1 UTG pos', h1.players.VillainA.pos, 'EP');
eq('h1 HJ pos', h1.players.VillainB.pos, 'MP');
eq('h1 CO pos', h1.players.VillainC.pos, 'CO');
eq('h1 rake', h1.rake, 0.03);

// 2: 3-бет из ББ, проигрыш на вскрытии
eq('h2 net', h2.net, -2.2);
eq('h2 netBB', h2.netBB, -22);
eq('h2 3bet', h2.players.Hero.d3b, 1);
eq('h2 villain faced 3bet', h2.players.VillainA.of3b, 1);
eq('h2 villain folded to 3bet', h2.players.VillainA.f3b, undefined);
eq('h2 hero cbet opp', h2.players.Hero.ocb, 1);
eq('h2 hero cbet', h2.players.Hero.cb, undefined);
eq('h2 hero sd', h2.players.Hero.sd, 1);
eq('h2 hero wsd', h2.players.Hero.wsd, undefined);
eq('h2 villain wsd', h2.players.VillainA.wsd, 1);
eq('h2 villain net', h2.players.VillainA.net, 2.13);
eq('h2 hero agg', h2.players.Hero.agg, 1);
eq('h2 villain calls', h2.players.VillainA.calls, 1);

// 3: GGPoker, ник с пробелом, без вскрытия
eq('h3 site', h3.site, 'GGPoker');
eq('h3 net', h3.net, -0.05);
eq('h3 zz top net', h3.players['zz top'].net, 0.31);
eq('h3 zz top sd', h3.players['zz top'].sd, undefined);
eq('h3 zz top pos', h3.players['zz top'].pos, 'CO');
eq('h3 9x9x pos', h3.players['9x9x'].pos, 'MP');
eq('h3 btn', h3.players.a1b2c3.pos, 'BTN');
eq('h3 cbet', h3.players['9x9x'].cb, 1);
eq('h3 faced cbet', h3.players['zz top'].ofcb, 1);
eq('h3 fold to cbet', h3.players['zz top'].fcb, undefined);

// 4: турнир, анте, олл-ин
eq('h4 tourney', h4.tourney, true);
eq('h4 buyin', h4.buyin, 1.1);
eq('h4 net', h4.net, 2460);
eq('h4 netBB', h4.netBB, 24.6);
eq('h4 hero pos', h4.heroPos, 'BB');
eq('h4 fish pos', h4.players.Fish1.pos, 'BTN');
eq('h4 reg pos', h4.players.Reg2.pos, 'SB');
eq('h4 sitting out ignored', h4.players.Reg3, undefined);
eq('h4 fish steal', h4.players.Fish1.st, 1);
eq('h4 fish net', h4.players.Fish1.net, -2400);
eq('h4 class', h4.heroClass, 'AA');
eq('h4 stack', h4.heroStack, 2400);
eq('h4 tname', h4.tname, '$1.00+$0.10 USD');
eq('h1 stack', h1.heroStack, 10);
eq('сводок в файле раздач', parseFile(text).tournaments.length, 0);

// сводки турниров
const ts = parseFile(fs.readFileSync(path.join(__dirname, 'samples', 'sample_tournaments.txt'), 'utf8'));
eq('турниров', ts.tournaments.length, 4);
eq('раздач в файле сводок', ts.hands.length, 0);
const [t1, t2, t3, t4] = ts.tournaments;
eq('t1 id', t1.id, 'PokerStars:3900000001');
eq('t1 buyin', t1.buyin, 1.1);
eq('t1 entrants', t1.entrants, 1250);
eq('t1 finish', t1.finish, 12);
eq('t1 prize', t1.prize, 9.4);
eq('t1 format', t1.format, 'mtt');
eq('t1 date', t1.date, '2026-10-22T19:00:00');
eq('t2 buyin (PKO)', t2.buyin, 5);
eq('t2 reentries', t2.reentries, 1);
eq('t2 total', t2.totalBuyin, 10);
eq('t2 finish', t2.finish, 301);
eq('t2 prize', t2.prize, 0);
eq('t3 format', t3.format, 'spin');
eq('t3 prize', t3.prize, 20);
eq('t3 finish', t3.finish, 1);
eq('t4 site', t4.site, 'GGPoker');
eq('t4 name', t4.name, 'Bounty Hunters Sunday Special $54');
eq('t4 buyin', t4.buyin, 54);
eq('t4 entrants', t4.entrants, 1234);
eq('t4 pool', t4.pool, 61700);
eq('t4 finish', t4.finish, 12);
eq('t4 prize', t4.prize, 150.2);

console.log(errors ? `\nОшибок: ${errors}` : 'Все проверки пройдены ✓');
process.exit(errors ? 1 : 0);
