/*
 * Разбор истории раздач (hand history) в формате PokerStars.
 * Тот же формат используют GGPoker (выгрузка из PokerCraft) и ряд других румов.
 * Работает и в браузере (window.PokerParser), и в Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HAND_START = /Hand #[\w\-]+:/;

  function num(s) {
    if (s == null) return 0;
    const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }
  const r6 = (x) => Math.round(x * 1e6) / 1e6;

  /** Делит текст файла на отдельные раздачи. */
  function splitHands(text) {
    text = String(text).replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    const hands = [];
    let cur = null;
    for (const line of lines) {
      if (HAND_START.test(line) && !/^\s*Seat /.test(line)) {
        if (cur) hands.push(cur);
        cur = [line];
      } else if (cur) cur.push(line);
    }
    if (cur) hands.push(cur);
    return hands.map((ls) => ls.join('\n').trim()).filter(Boolean);
  }

  const RANKS = 'AKQJT98765432';
  /** 'Ah Kd' -> 'AKo', 'Jc Jd' -> 'JJ'. Только для холдема (2 карты). */
  function handClass(cards) {
    if (!cards) return null;
    const cs = cards.trim().split(/\s+/);
    if (cs.length !== 2) return null;
    let [a, b] = cs;
    let ra = RANKS.indexOf(a[0].toUpperCase()), rb = RANKS.indexOf(b[0].toUpperCase());
    if (ra < 0 || rb < 0) return null;
    if (ra > rb) { [a, b] = [b, a]; [ra, rb] = [rb, ra]; }
    if (ra === rb) return RANKS[ra] + RANKS[rb];
    return RANKS[ra] + RANKS[rb] + (a[1] === b[1] ? 's' : 'o');
  }

  /** Назначает позиции по сидящим игрокам и тем, кто поставил блайнды. */
  function assignPositions(dealt, buttonSeat, sbName, bbName) {
    const pos = {};
    const n = dealt.length;
    if (n === 0) return pos;
    const names = dealt.map((p) => p.name);
    if (n === 2) {
      const bb = bbName && names.includes(bbName) ? bbName : names.find((x) => x !== sbName) || names[1];
      for (const x of names) pos[x] = x === bb ? 'BB' : 'BTN';
      return pos;
    }
    let bbIdx = bbName ? names.indexOf(bbName) : -1;
    if (bbIdx < 0) {
      // нет большого блайнда — считаем от баттона
      let btnIdx = dealt.findIndex((p) => p.seat >= buttonSeat);
      if (btnIdx < 0) btnIdx = 0;
      bbIdx = (btnIdx + 2) % n;
    }
    pos[names[bbIdx]] = 'BB';
    const L = [];
    for (let i = 1; i < n; i++) L.push(names[(bbIdx + i) % n]);
    if (L.length && L[L.length - 1] === sbName) pos[L.pop()] = 'SB';
    if (L.length) pos[L.pop()] = 'BTN';
    if (L.length) pos[L.pop()] = 'CO';
    const k = L.length;
    if (k === 1) pos[L[0]] = 'MP';
    else if (k > 1) {
      const mp = k >= 4 ? 2 : 1;
      L.forEach((x, i) => { pos[x] = i < k - mp ? 'EP' : 'MP'; });
    }
    return pos;
  }

  /**
   * Разбирает одну раздачу. Возвращает null, если это не холдем/омаха в известном формате.
   * Для каждого игрока считаются флаги статистики (0/1) и итоговый выигрыш net.
   */
  function parseHand(text) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
    const header = lines[0] || '';
    const idm = header.match(/Hand #([\w\-]+):/);
    if (!idm) return null;

    let site = 'Другой';
    if (/^\s*PokerStars/i.test(header)) site = 'PokerStars';
    else if (/^\s*(Poker Hand #|GGPoker)/i.test(header)) site = 'GGPoker';
    else { const sm = header.match(/^\s*([A-Za-z0-9 ]+?)\s+(?:Game\s+)?Hand #/); if (sm) site = sm[1].trim(); }

    const game = /Omaha|PLO/i.test(header) ? 'PLO' : /Hold'?em/i.test(header) ? 'NLH' : null;
    if (!game) return null;
    const limit = /Pot Limit/i.test(header) ? 'PL' : /No Limit/i.test(header) ? 'NL' : 'FL';
    const tm = header.match(/Tournament #(\d+)/i);
    const tourney = !!tm;
    const bm = header.match(/\(([^()\/]+)\/([^()\/]+?)(?:\(\d+\))?\s*(?:[A-Z]{3})?\)/);
    if (!bm) return null;
    const sb = num(bm[1]), bb = num(bm[2]);
    if (!bb) return null;
    let cur = '';
    if (!tourney) {
      if (/\$/.test(bm[0]) || /USD/.test(header)) cur = '$';
      else if (/€|EUR/.test(header)) cur = '€';
      else if (/£|GBP/.test(header)) cur = '£';
      else cur = '$';
    }
    let buyin = null;
    if (tourney) {
      const bi = header.match(/,\s*([$€£]?[\d.]+)\+([$€£]?[\d.]+)(?:\+([$€£]?[\d.]+))?/);
      if (bi) buyin = r6(num(bi[1]) + num(bi[2]) + (bi[3] ? num(bi[3]) : 0));
    }
    const dm = header.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    const date = dm ? `${dm[1]}-${dm[2]}-${dm[3]}T${dm[4].padStart(2, '0')}:${dm[5]}:${dm[6]}` : null;

    const tl = lines[1] || '';
    const tableM = tl.match(/Table '([^']*)'/);
    const maxM = tl.match(/(\d+)-max/);
    const btnM = tl.match(/Seat #(\d+) is the button/);
    const buttonSeat = btnM ? +btnM[1] : 0;

    // места
    const P = {};
    const seated = [];
    let i = 2;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (/^\*\*\*/.test(l)) break;
      const sm = l.match(/^Seat (\d+): (.+?) \(([^)]*)\)(.*)$/);
      if (sm) {
        const out = /sitting out|out of hand/i.test(sm[4]);
        const p = {
          seat: +sm[1], name: sm[2], stack: num(sm[3]), out,
          invested: 0, commit: 0, collected: 0, returned: 0, folded: out,
          acted: false, actedFlop: false, faced3b: false, facedCb: false, cards: null,
          s: {},
        };
        P[p.name] = p;
        seated.push(p);
      }
    }
    if (!seated.length) return null;
    const names = seated.map((p) => p.name).sort((a, b) => b.length - a.length);
    const who = (line, sep) => names.find((n) => line.startsWith(n + sep));

    // блайнды для позиций
    let sbName = null, bbName = null;
    for (const l of lines) {
      if (/^\*\*\* HOLE CARDS/.test(l)) break;
      const n = who(l, ': ');
      if (!n) continue;
      const rest = l.slice(n.length + 2);
      if (!sbName && /^posts small blind/.test(rest)) sbName = n;
      else if (!bbName && /^posts big blind/.test(rest)) bbName = n;
    }
    const dealt = seated.filter((p) => !p.out).sort((a, b) => a.seat - b.seat);
    const pos = assignPositions(dealt, buttonSeat, sbName, bbName);
    for (const p of dealt) p.s.pos = pos[p.name] || '?';

    let hero = null, heroCards = null;
    let street = 'pre';
    let raiseCount = 0, firstRaiser = null, pfAggr = null, unopened = true;
    let flopBets = 0, cbetLive = false;
    let sawFlopMarked = false, rake = 0, totalPot = 0;
    let summary = false;

    const resetStreet = () => { for (const p of seated) p.commit = 0; };

    for (const l of lines.slice(1)) {
      if (/^\*\*\* SUMMARY/.test(l)) { summary = true; continue; }
      if (summary) {
        const rk = l.match(/Total pot ([^|]+)\|\s*Rake ([^|\s]+)/);
        if (rk) { totalPot = num(rk[1]); rake = num(rk[2]); }
        continue;
      }
      if (/^\*\*\* HOLE CARDS/.test(l)) { street = 'pre'; continue; }
      if (/^\*\*\* (?:FIRST )?FLOP/.test(l)) {
        if (street === 'pre') {
          street = 'flop'; resetStreet();
          if (!sawFlopMarked) { sawFlopMarked = true; for (const p of dealt) if (!p.folded) p.s.sf = 1; }
        }
        continue;
      }
      if (/^\*\*\* (?:FIRST )?TURN/.test(l)) { if (street !== 'turn' && street !== 'river') { street = 'turn'; resetStreet(); } continue; }
      if (/^\*\*\* (?:FIRST )?RIVER/.test(l)) { if (street !== 'river') { street = 'river'; resetStreet(); } continue; }
      if (/^\*\*\*/.test(l)) continue;

      const dt = l.match(/^Dealt to (.+?) \[([^\]]+)\]/);
      if (dt) {
        if (!hero && P[dt[1]]) { hero = dt[1]; heroCards = dt[2]; P[hero].cards = heroCards; }
        continue;
      }
      const un = l.match(/^Uncalled bet \(([^)]+)\) returned to (.+)$/);
      if (un) { if (P[un[2]]) P[un[2]].returned += num(un[1]); continue; }

      const cn = who(l, ' collected ');
      if (cn) { P[cn].collected += num(l.slice(cn.length + 11)); continue; }

      const n = who(l, ': ');
      if (!n) continue;
      const p = P[n];
      const s = p.s;
      const rest = l.slice(n.length + 2);
      let m;

      // обязательные ставки
      if ((m = rest.match(/^posts (?:the )?ante ([^\s]+)/))) { p.invested += num(m[1]); continue; }
      if ((m = rest.match(/^posts small & big blinds ([^\s]+)/))) { p.invested += num(m[1]); p.commit += bb; continue; }
      if ((m = rest.match(/^posts (?:small blind|big blind|straddle) ([^\s]+)/))) { const a = num(m[1]); p.invested += a; p.commit += a; continue; }
      if ((m = rest.match(/^posts .*?([$€£]?[\d,.]+)\s*$/))) { p.invested += num(m[1]); continue; }
      if ((m = rest.match(/^shows \[([^\]]+)\]/))) { p.cards = p.cards || m[1]; continue; }

      let type = null, amt = 0;
      if (/^folds/.test(rest)) type = 'fold';
      else if (/^checks/.test(rest)) type = 'check';
      else if ((m = rest.match(/^calls ([^\s]+)/))) { type = 'call'; amt = num(m[1]); }
      else if ((m = rest.match(/^bets ([^\s]+)/))) { type = 'bet'; amt = num(m[1]); }
      else if ((m = rest.match(/^raises ([^\s]+) to ([^\s]+)/))) { type = 'raise'; amt = num(m[2]); }
      if (!type) continue;

      // деньги
      if (type === 'call' || type === 'bet') { p.invested += amt; p.commit += amt; }
      else if (type === 'raise') { p.invested += amt - p.commit; p.commit = amt; }
      if (type === 'fold') p.folded = true;

      if (street === 'pre') {
        const aggr = type === 'raise' || type === 'bet';
        if (!p.acted) {
          p.acted = true;
          if (unopened && raiseCount === 0 && ['CO', 'BTN', 'SB'].includes(s.pos)) { s.ost = 1; if (aggr) s.st = 1; }
        }
        if (raiseCount === 1 && n !== firstRaiser && !s.o3b) { s.o3b = 1; if (aggr) s.d3b = 1; }
        if (raiseCount === 2 && n === firstRaiser && !p.faced3b) { p.faced3b = true; s.of3b = 1; if (type === 'fold') s.f3b = 1; }
        if (type === 'call' || aggr) { s.vpip = 1; unopened = false; }
        if (aggr) { s.pfr = 1; raiseCount++; if (raiseCount === 1) firstRaiser = n; pfAggr = n; }
      } else {
        if (type === 'bet' || type === 'raise') s.agg = (s.agg || 0) + 1;
        if (type === 'call') s.calls = (s.calls || 0) + 1;
        if (street === 'flop') {
          if (n === pfAggr && !p.actedFlop && flopBets === 0) { s.ocb = 1; if (type === 'bet') { s.cb = 1; cbetLive = true; } }
          else if (cbetLive && flopBets === 1 && n !== pfAggr && !p.facedCb) { p.facedCb = true; s.ofcb = 1; if (type === 'fold') s.fcb = 1; }
          p.actedFlop = true;
          if (type === 'bet' || type === 'raise') flopBets++;
        }
      }
    }

    const live = dealt.filter((p) => !p.folded);
    const showdown = live.length >= 2;
    const players = {};
    for (const p of dealt) {
      const s = p.s;
      s.net = r6(p.collected + p.returned - p.invested);
      if (showdown && !p.folded) { s.sd = 1; if (p.collected > 0) s.wsd = 1; }
      if (s.sf && p.collected > 0) s.wsf = 1;
      if (p.cards) s.cards = p.cards;
      players[p.name] = s;
    }

    const site_ = site;
    const heroS = hero ? players[hero] : null;
    return {
      id: `${site_}:${idm[1]}`,
      handNo: idm[1],
      site: site_,
      date,
      game, limit, tourney,
      tourneyId: tm ? tm[1] : null,
      tname: tm ? ((header.match(/Tournament #\d+,\s*(.*?)\s*(?:Hold'?em|Omaha)/i) || [])[1] || '').trim() : null,
      buyin,
      heroStack: hero ? P[hero].stack : null,
      sb, bb, cur,
      table: tableM ? tableM[1] : '',
      maxPlayers: maxM ? +maxM[1] : dealt.length,
      nPlayers: dealt.length,
      pot: totalPot, rake,
      hero,
      heroCards,
      heroClass: game === 'NLH' ? handClass(heroCards) : null,
      heroPos: heroS ? heroS.pos : null,
      net: heroS ? heroS.net : 0,
      netBB: heroS ? r6(heroS.net / bb) : 0,
      players,
    };
  }

  /*
   * Сводки турниров (tournament summary).
   * PokerStars: «PokerStars Tournament #123, No Limit Hold'em / Buy-In: $1.00/$0.10 USD / … / You finished in 12th place.»
   * GGPoker:    «Tournament #123, Bounty Hunters $5.40, Hold'em No Limit / Buy-in: $2.5+$0.4+$2.5 / … / You finished the tournament in 12th place.»
   */
  const SUMMARY_START = /^\s*(?:PokerStars\s+)?Tournament #\d+,/;
  function parseSummary(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const head = lines[0];
    const hm = head.match(/^(PokerStars\s+)?Tournament #(\d+),\s*(.*)$/);
    if (!hm) return null;
    const site = hm[1] ? 'PokerStars' : 'GGPoker';
    const tid = hm[2];
    const rest = hm[3];
    const game = /Omaha|PLO/i.test(rest) ? 'PLO' : 'NLH';
    // у GG название идёт до последней запятой, у PokerStars названия в сводке нет
    let name = '';
    const ci = rest.lastIndexOf(',');
    if (ci > 0 && /Hold'?em|Omaha/i.test(rest.slice(ci))) name = rest.slice(0, ci).trim();
    const body = lines.join('\n');
    const bi = body.match(/Buy-?In:\s*([^\n]+)/i);
    let buyin = 0, prizePart = 0;
    if (bi) {
      const parts = bi[1].split(/[\/+]/).map((x) => num(x));
      buyin = r6(parts.reduce((a, b) => a + b, 0));
      prizePart = parts[0] || 0;
    }
    const cur = /€|EUR/.test(bi ? bi[1] : '') ? '€' : /£|GBP/.test(bi ? bi[1] : '') ? '£' : '$';
    const pm = body.match(/(\d[\d,]*)\s+players/i);
    const entrants = pm ? num(pm[1]) : null;
    const poolM = body.match(/Total Prize Pool:\s*([^\s]+)/i);
    const pool = poolM ? num(poolM[1]) : null;
    const dm = body.match(/started\s+(\d{4})[\/\-](\d{2})[\/\-](\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/i);
    const date = dm ? `${dm[1]}-${dm[2]}-${dm[3]}T${dm[4].padStart(2, '0')}:${dm[5]}:${dm[6]}` : null;
    const fm = body.match(/You finished (?:the tournament )?in (\d+)(?:st|nd|rd|th)?\s+place/i);
    const finish = fm ? +fm[1] : null;
    const still = /You are still playing/i.test(body);
    const rm = body.match(/You received (?:a total of )?([$€£]?\s?[\d,]+(?:\.\d+)?)/i);
    const prize = rm ? num(rm[1]) : 0;
    const re = body.match(/(\d+)\s+re-?(?:entr|buy)/i);
    const reentries = re ? +re[1] : 0;
    let format = 'mtt';
    if (/spin/i.test(rest)) format = 'spin';
    else if (entrants && entrants <= 10) {
      format = entrants === 3 && pool && prizePart && pool > 3 * prizePart * 1.05 ? 'spin' : 'sng';
    }
    if (!finish && !still && !rm) return null;
    return {
      id: `${site}:${tid}`, site, tid, name, game, format, cur, date,
      buyin, totalBuyin: r6(buyin * (1 + reentries)), reentries,
      entrants, pool, finish, prize, still,
    };
  }
  function splitSummaries(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    const out = [];
    let cur = null;
    for (const l of lines) {
      if (SUMMARY_START.test(l)) { if (cur) out.push(cur); cur = [l]; }
      else if (cur) cur.push(l);
    }
    if (cur) out.push(cur);
    return out.map((x) => x.join('\n'));
  }

  /** Разбирает весь файл: и раздачи, и сводки турниров. */
  function parseFile(text) {
    const out = [];
    const tournaments = [];
    let failed = 0;
    for (const h of splitHands(text)) {
      try {
        const r = parseHand(h);
        if (r) { r.raw = h; out.push(r); } else failed++;
      } catch (e) {
        failed++;
      }
    }
    for (const s of splitSummaries(text)) {
      try {
        const r = parseSummary(s);
        if (r) tournaments.push(r);
      } catch (e) {
        failed++;
      }
    }
    return { hands: out, tournaments, failed };
  }

  return { parseFile, parseHand, parseSummary, splitHands, handClass, RANKS };
});
