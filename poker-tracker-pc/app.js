'use strict';
/* Покерный трекер — интерфейс. Данные хранятся в IndexedDB браузера на этом компьютере. */

// ───────────────────────── утилиты ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sum = (arr, fn) => arr.reduce((a, x) => a + (fn(x) || 0), 0);
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toNum = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : null; };

function fmtNum(v, d = 2) { return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function sign(v) { return v > 0 ? '+' : v < 0 ? '−' : ''; }
function money(v, opts = {}) {
  if (v == null || !isFinite(v)) return '—';
  const cur = opts.cur ?? state.settings.currency;
  const d = opts.d ?? 2;
  return (opts.signed === false ? (v < 0 ? '−' : '') : sign(v)) + cur + fmtNum(Math.abs(v), d);
}
function signed(v, d = 2) { return v == null || !isFinite(v) ? '—' : sign(v) + fmtNum(Math.abs(v), d); }
function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
function pct(a, b) { return b ? (a / b) * 100 : null; }
function fmtPct(v, d = 1) { return v == null ? '—' : fmtNum(v, d) + '%'; }
function fmtDur(min) { if (!min) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return `${h}ч ${pad(m)}м`; }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
function fmtDateTime(iso) { return iso ? `${fmtDate(iso)} ${iso.slice(11, 16)}` : ''; }
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; }

function toast(msg, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };
function cardsHTML(cards) {
  if (!cards) return '<span class="muted">—</span>';
  return cards.split(/\s+/).map((c) => {
    const r = c.slice(0, -1).replace('T', '10'), s = c.slice(-1).toLowerCase();
    const red = s === 'h' || s === 'd';
    return `<span style="${red ? 'color:var(--neg)' : ''}">${esc(r)}${SUITS[s] || esc(s)}</span>`;
  }).join(' ');
}

// ───────────────────────── хранилище ─────────────────────────
// Данные лежат в файле data/poker.db на компьютере; страница общается с ним через server.py.
const NO_SERVER = 'Нет связи с программой. Запусти «Запустить трекер.bat» — изменения не сохранены.';
async function api(method, path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method,
      headers: { 'X-Tracker': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(NO_SERVER);
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.error) || `Ошибка ${r.status}`);
  return data;
}
const enc = encodeURIComponent;
const DB = {
  async open() { await api('GET', 'info'); },
  all(store) { return api('GET', `store/${store}`); },
  get(store, key) { return api('GET', `store/${store}/${enc(key)}`); },
  put(store, val, key) { return api('PUT', `store/${store}/${enc(key === undefined ? val.id : key)}`, val); },
  async putMany(store, arr) { for (let i = 0; i < arr.length; i += 2000) await api('POST', `store/${store}`, arr.slice(i, i + 2000)); },
  del(store, key) { return api('DELETE', `store/${store}/${enc(key)}`); },
  clear(store) { return api('DELETE', `store/${store}`); },
};
window.addEventListener('unhandledrejection', (e) => { toast(e.reason?.message || String(e.reason), 6000); });

// Старая браузерная версия хранила данные в IndexedDB — читаем их только для переноса.
function readBrowserData() {
  return new Promise((res) => {
    let r;
    try { r = indexedDB.open('poker-tracker'); } catch (e) { return res(null); }
    r.onupgradeneeded = () => { r.transaction.abort(); };
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const db = r.result;
      const names = ['sessions', 'hands', 'raw', 'meta'].filter((n) => db.objectStoreNames.contains(n));
      if (!names.includes('sessions')) { db.close(); return res(null); }
      const t = db.transaction(names, 'readonly');
      const out = {};
      for (const n of names) {
        const q = n === 'meta' ? t.objectStore(n).get('settings') : t.objectStore(n).getAll();
        q.onsuccess = () => { out[n] = q.result; };
      }
      t.oncomplete = () => { db.close(); res(out); };
      t.onerror = () => res(null);
    };
  });
}

// ───────────────────────── состояние ─────────────────────────
const DEFAULT_F = {
  ov: { period: 'all', format: 'all', site: 'all' },
  hh: { period: 'all', type: 'all', stakes: 'all', site: 'all', hero: 'all', unit: 'bb', list: 'win' },
  opp: { type: 'all', min: 20, q: '', sort: 'n', dir: -1 },
  ses: { sort: 'date', dir: -1 },
  tr: { period: 'all', format: 'all', site: 'all', bi: 'all', q: '', sort: 'date', dir: -1 },
};
const state = {
  sessions: [],
  hands: [],
  settings: { startBankroll: 0, currency: '$' },
  timer: null,
  tab: 'overview',
  editing: null,
  prefill: null,
  f: JSON.parse(JSON.stringify(DEFAULT_F)),
};
function saveUI() {
  try { localStorage.setItem('pt-ui', JSON.stringify({ tab: state.tab, f: state.f })); } catch (e) { /* не критично */ }
}
function loadUI() {
  try {
    const u = JSON.parse(localStorage.getItem('pt-ui') || 'null');
    if (u) {
      state.tab = u.tab || state.tab;
      for (const k of Object.keys(DEFAULT_F)) state.f[k] = { ...DEFAULT_F[k], ...(u.f?.[k] || {}) };
    }
  } catch (e) { /* не критично */ }
}

const FORMATS = { cash: 'Кэш', mtt: 'MTT', sng: 'SNG', spin: 'Spin & Go' };
const isTourneyFmt = (f) => f !== 'cash';
const profitOf = (s) => (s.cashout || 0) - (s.buyin || 0);
const sortSessions = () => state.sessions.sort((a, b) => (a.date + (a.created || '')).localeCompare(b.date + (b.created || '')));
const sortHands = () => state.hands.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));

const PERIODS = [['all', 'Всё время'], ['today', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['month', 'Этот месяц'], ['year', 'Этот год']];
function periodStart(p) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === 'today') return d;
  if (p === '7') { d.setDate(d.getDate() - 6); return d; }
  if (p === '30') { d.setDate(d.getDate() - 29); return d; }
  if (p === 'month') { d.setDate(1); return d; }
  if (p === 'year') { d.setMonth(0, 1); return d; }
  return null;
}
function inPeriod(iso, p) {
  const s = periodStart(p);
  if (!s) return true;
  if (!iso) return false;
  return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso) >= s;
}
function options(list, val) {
  return list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

// ───────────────────────── подсказка ─────────────────────────
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
}
function hideTip() { tip.style.display = 'none'; }
const tipRow = (color, label, value) => `<div class="r"><span>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><b>${value}</b></div>`;

// ───────────────────────── графики ─────────────────────────
const charts = [];
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const e = step0 / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
function shortNum(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return sign(v) + fmtNum(a / 1e6, 1) + 'M';
  if (a >= 1e4) return sign(v) + fmtNum(a / 1e3, 0) + 'k';
  if (a >= 100 || Number.isInteger(v)) return (v < 0 ? '−' : '') + fmtNum(a, 0);
  return (v < 0 ? '−' : '') + fmtNum(a, a < 1 ? 2 : 1);
}
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

/** Линейный график накопленного результата. series: [{name, color, values}] — values[0] = 0 (старт). */
function lineChart(el, opts) {
  const draw = () => {
    const { series, xLabel, yFmt, height = 260 } = opts;
    el.innerHTML = '';
    const W = el.clientWidth || 600, H = height;
    const m = { l: 52, r: 12, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = series[0].values.length - 1;
    let lo = 0, hi = 0;
    for (const s of series) for (const v of s.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const ticks = niceTicks(lo, hi);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = (i) => m.l + (n ? (i / n) * pw : pw / 2);
    const Y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
    const ax = svgEl('g', { class: 'axis' });
    for (const t of ticks) {
      ax.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'gridline' }));
      const tx = svgEl('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = shortNum(t); ax.appendChild(tx);
    }
    const xt = n <= 1 ? [n] : [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n];
    for (const i of [...new Set(xt)]) {
      const tx = svgEl('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle' });
      tx.textContent = fmtNum(i, 0); ax.appendChild(tx);
    }
    svg.appendChild(ax);
    const step = Math.max(1, Math.ceil((n + 1) / (pw * 1.5)));
    for (const s of series) {
      let d = '';
      for (let i = 0; i <= n; i += step) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(s.values[i]).toFixed(1);
      if (n % step) d += 'L' + X(n).toFixed(1) + ',' + Y(s.values[n]).toFixed(1);
      svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    const cross = svgEl('line', { y1: m.t, y2: m.t + ph, stroke: 'var(--text-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    svg.appendChild(cross);
    const dots = series.map((s) => { const c = svgEl('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }); svg.appendChild(c); return c; });
    const hit = svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
    svg.appendChild(hit);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n, Math.round(((px - m.l) / pw) * n)));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      series.forEach((s, k) => { dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(s.values[i])); dots[k].setAttribute('visibility', 'visible'); });
      showTip(`<div class="t">${esc(xLabel(i))}</div>` + series.map((s) => tipRow(s.color, s.name, yFmt(s.values[i]))).join(''), ev.clientX, ev.clientY);
    };
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); });
    el.appendChild(svg);
  };
  draw();
  charts.push({ el, draw });
}

/** Столбики: положительные — синим, отрицательные — красным. bars: [{label, value, tip}] */
function barChart(el, { bars, yFmt, height = 220 }) {
  const draw = () => {
    el.innerHTML = '';
    const W = el.clientWidth || 600, H = height;
    const m = { l: 52, r: 8, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    let lo = 0, hi = 0;
    for (const b of bars) { lo = Math.min(lo, b.value); hi = Math.max(hi, b.value); }
    const ticks = niceTicks(lo, hi, 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const Y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
    const ax = svgEl('g', { class: 'axis' });
    for (const t of ticks) {
      ax.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'gridline' }));
      const tx = svgEl('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = shortNum(t); ax.appendChild(tx);
    }
    svg.appendChild(ax);
    const slot = pw / Math.max(bars.length, 1);
    const bw = Math.max(3, Math.min(42, slot - 2));
    const every = Math.ceil(bars.length / Math.max(1, Math.floor(pw / 56)));
    bars.forEach((b, i) => {
      const cx = m.l + slot * i + slot / 2;
      const top = Math.min(Y(b.value), Y(0)), h = Math.max(1, Math.abs(Y(b.value) - Y(0)));
      const color = b.value >= 0 ? 'rgb(var(--div-pos))' : 'rgb(var(--div-neg))';
      const r = Math.min(4, bw / 2, h);
      // скругление только у конца столбика, основание прямое
      const x = cx - bw / 2;
      const d = b.value >= 0
        ? `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${top + h}Z`
        : `M${x},${top}H${x + bw}V${top + h - r}Q${x + bw},${top + h} ${x + bw - r},${top + h}H${x + r}Q${x},${top + h} ${x},${top + h - r}Z`;
      svg.appendChild(svgEl('path', { d, fill: color }));
      const hit = svgEl('rect', { x: m.l + slot * i, y: m.t, width: slot, height: ph, fill: 'transparent' });
      hit.addEventListener('mousemove', (ev) => showTip(b.tip, ev.clientX, ev.clientY));
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
      if (i % every === 0) {
        const tx = svgEl('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: '' });
        tx.setAttribute('fill', 'var(--text-3)'); tx.setAttribute('font-size', '11'); tx.textContent = b.label;
        svg.appendChild(tx);
      }
    });
    el.appendChild(svg);
  };
  draw();
  charts.push({ el, draw });
}
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { for (const c of charts) if (document.body.contains(c.el)) c.draw(); }, 120);
});

// ───────────────────────── общие куски разметки ─────────────────────────
function kpi(label, value, sub = '', valueCls = '') {
  return `<div class="kpi"><div class="lbl">${esc(label)}</div><div class="val ${valueCls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
function sel(id, label, list, val) { return `<label>${esc(label)}<select data-f="${id}">${options(list, val)}</select></label>`; }

// ───────────────────────── Обзор ─────────────────────────
function filteredSessions() {
  const f = state.f.ov;
  return state.sessions.filter((s) => inPeriod(s.date, f.period) && (f.format === 'all' || s.format === f.format) && (f.site === 'all' || s.site === f.site));
}
function sessionFilters() {
  const f = state.f.ov;
  return `<div class="filters" data-scope="ov">
    ${sel('period', 'Период', PERIODS, f.period)}
    ${sel('format', 'Формат', [['all', 'Все'], ...Object.entries(FORMATS)], f.format)}
    ${sel('site', 'Рум', [['all', 'Все'], ...uniq(state.sessions.map((s) => s.site)).map((x) => [x, x])], f.site)}
  </div>`;
}

function viewOverview() {
  const list = filteredSessions();
  const allProfit = sum(state.sessions, profitOf);
  const bankroll = (state.settings.startBankroll || 0) + allProfit;

  if (!state.sessions.length) {
    return `<div class="kpis">${kpi('Банкролл', money(bankroll, { signed: false }), 'стартовый — в Настройках')}</div>
      <div class="card"><h2>С чего начать</h2>
      <ol class="help">
        <li><b>Сессии</b> — после каждой игровой сессии записывай рум, лимит, сколько внёс и сколько вывел, сколько играл. Отсюда считаются профит, банкролл, заработок в час и ROI турниров.</li>
        <li><b>Анализ раздач</b> — загрузи файлы истории раздач из клиента (PokerStars, GGPoker и др.). Программа посчитает VPIP, PFR, 3-бет, bb/100, графики выигрыша и статистику по оппонентам.</li>
        <li>В <b>Настройках</b> укажи стартовый банкролл и валюту. Там же — резервная копия данных в файл.</li>
      </ol>
      <div class="btn-row"><button class="btn primary" data-go="sessions">Добавить сессию</button><button class="btn" data-go="hands">Загрузить раздачи</button></div>
      </div>`;
  }

  const profit = sum(list, profitOf);
  const minutes = sum(list, (s) => s.minutes);
  const wins = list.filter((s) => profitOf(s) > 0).length;
  const cash = list.filter((s) => s.format === 'cash');
  const bbSessions = cash.filter((s) => s.bb > 0 && s.hands > 0);
  const bb100 = bbSessions.length ? (sum(bbSessions, (s) => profitOf(s) / s.bb) / sum(bbSessions, (s) => s.hands)) * 100 : null;
  const tours = list.filter((s) => isTourneyFmt(s.format));
  const tBuy = sum(tours, (s) => s.buyin);
  const roi = tBuy ? (sum(tours, profitOf) / tBuy) * 100 : null;
  const itm = tours.length ? (tours.filter((s) => s.cashout > 0).length / tours.length) * 100 : null;
  const best = list.reduce((a, s) => (!a || profitOf(s) > profitOf(a) ? s : a), null);
  const worst = list.reduce((a, s) => (!a || profitOf(s) < profitOf(a) ? s : a), null);

  let html = sessionFilters();
  html += `<div class="kpis">
    ${kpi('Банкролл', money(bankroll, { signed: false }), `старт ${money(state.settings.startBankroll || 0, { signed: false })}`)}
    ${kpi('Профит за период', money(profit), `${list.length} ${plural(list.length, 'сессия', 'сессии', 'сессий')}`, cls(profit))}
    ${kpi('В час', minutes ? money(profit / (minutes / 60)) : '—', `сыграно ${fmtDur(minutes)}`, minutes ? cls(profit) : '')}
    ${kpi('Сессий в плюс', fmtPct(pct(wins, list.length), 0), `${wins} из ${list.length}`)}
    ${cash.length ? kpi('Кэш: bb/100', bb100 == null ? '—' : signed(bb100), bb100 == null ? 'укажи BB и число раздач в сессиях' : `${fmtNum(sum(bbSessions, (s) => s.hands), 0)} раздач`, bb100 == null ? '' : cls(bb100)) : ''}
    ${tours.length ? kpi('Турниры: ROI', fmtPct(roi), `${tours.length} шт., ITM ${fmtPct(itm, 0)}`, cls(roi)) : ''}
    ${best ? kpi('Лучшая / худшая', `<span class="${cls(profitOf(best))}">${money(profitOf(best))}</span>`, `худшая <span class="${cls(profitOf(worst))}">${money(profitOf(worst))}</span>`) : ''}
  </div>`;

  if (!list.length) return html + `<div class="card empty">За выбранный период сессий нет</div>`;

  html += `<div class="card"><div class="card-head"><h2>Профит по сессиям, накопительно</h2></div><div class="chart" id="ch-cum"></div></div>`;
  html += `<div class="card"><div class="card-head"><h2>Профит по месяцам</h2></div><div class="chart" id="ch-month"></div></div>`;
  html += `<div class="grid2">${breakdown(list, (s) => FORMATS[s.format] || s.format, 'По формату')}${breakdown(list, (s) => s.site || '—', 'По румам')}</div>`;
  html += `<div style="height:16px"></div>${breakdown(list, (s) => s.stakes || '—', 'По лимитам и бай-инам')}`;
  return html;
}
function afterOverview() {
  const list = filteredSessions();
  if (!list.length) return;
  const vals = [0];
  for (const s of list) vals.push(vals[vals.length - 1] + profitOf(s));
  lineChart($('#ch-cum'), {
    series: [{ name: 'Профит', color: 'var(--s1)', values: vals }],
    xLabel: (i) => (i ? `Сессия ${i} · ${fmtDate(list[i - 1].date)} · ${list[i - 1].site || ''} ${list[i - 1].stakes || ''}` : 'Старт'),
    yFmt: (v) => money(v),
  });
  const byM = new Map();
  for (const s of list) { const k = s.date.slice(0, 7); byM.set(k, (byM.get(k) || 0) + profitOf(s)); }
  const keys = [...byM.keys()].sort();
  // заполняем пропущенные месяцы нулями
  const months = [];
  if (keys.length) {
    let [y, m] = keys[0].split('-').map(Number);
    const [ey, em] = keys[keys.length - 1].split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  }
  barChart($('#ch-month'), {
    bars: months.map((k) => {
      const v = byM.get(k) || 0; const [y, m] = k.split('-');
      const cnt = list.filter((s) => s.date.startsWith(k)).length;
      return { label: `${MONTHS[+m - 1]} ${y.slice(2)}`, value: v, tip: `<div class="t">${MONTHS[+m - 1]} ${y}</div>${tipRow('', 'Профит', money(v))}${tipRow('', 'Сессий', cnt)}` };
    }),
  });
}
function breakdown(list, keyFn, title) {
  const g = new Map();
  for (const s of list) {
    const k = keyFn(s);
    const r = g.get(k) || { k, n: 0, min: 0, p: 0, tb: 0, tp: 0 };
    r.n++; r.min += s.minutes || 0; r.p += profitOf(s);
    if (isTourneyFmt(s.format)) { r.tb += s.buyin || 0; r.tp += profitOf(s); }
    g.set(k, r);
  }
  const rows = [...g.values()].sort((a, b) => b.p - a.p);
  return `<div class="card"><h2>${esc(title)}</h2><div class="table-wrap"><table>
    <thead><tr><th>Название</th><th>Сессий</th><th>Время</th><th>Профит</th><th>В час</th><th>ROI</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.k)}</td><td>${r.n}</td><td>${fmtDur(r.min)}</td><td class="${cls(r.p)}">${money(r.p)}</td>
      <td>${r.min ? money(r.p / (r.min / 60)) : '—'}</td><td>${r.tb ? fmtPct((r.tp / r.tb) * 100) : '—'}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

// ───────────────────────── Сессии ─────────────────────────
function sessionForm() {
  const e = state.editing ? state.sessions.find((s) => s.id === state.editing) : null;
  const last = state.sessions[state.sessions.length - 1] || {};
  const pre = !e && state.prefill ? state.prefill : null;
  const s = e || pre || { date: todayISO(), site: last.site || '', format: last.format || 'cash', game: last.game || 'NLH', stakes: last.stakes || '', bb: last.bb ?? '', buyin: '', cashout: '', minutes: 0, hands: '', tables: last.tables ?? '', place: '', notes: '' };
  const tour = isTourneyFmt(s.format);
  const h = Math.floor((s.minutes || 0) / 60), m = (s.minutes || 0) % 60;
  const sites = uniq(['PokerStars', 'GGPoker', '888poker', 'partypoker', 'Winamax', 'iPoker', 'ACR', 'PokerOK', 'Покердом', ...state.sessions.map((x) => x.site)]);
  const stakes = uniq(state.sessions.map((x) => x.stakes));
  const timerBlock = state.timer
    ? `<span class="timer" id="timer-label">Идёт сессия: ${fmtDur((Date.now() - state.timer) / 60000) === '—' ? '0ч 00м' : fmtDur((Date.now() - state.timer) / 60000)}</span><button class="btn" id="timer-stop" type="button">Стоп — заполнить время</button><button class="btn sm" id="timer-cancel" type="button">Сбросить</button>`
    : `<button class="btn" id="timer-start" type="button">⏱ Начать сессию (таймер)</button>`;
  return `<div class="card" id="session-form">
    <div class="card-head"><h2>${e ? (isTourneyFmt(e.format) ? 'Редактирование турнира' : 'Редактирование сессии') : pre ? `Результат турнира #${esc(pre.tid)}` : 'Новая сессия'}</h2><div class="btn-row">${e || pre ? '' : timerBlock}</div></div>
    <form id="sf" autocomplete="off">
    <div class="form-grid">
      <label>Дата<input type="date" name="date" value="${esc(s.date)}" required></label>
      <label>Рум<input name="site" list="dl-sites" value="${esc(s.site)}" placeholder="PokerStars"></label>
      <label>Формат<select name="format">${options(Object.entries(FORMATS), s.format)}</select></label>
      <label>Игра<select name="game">${options([['NLH', 'Холдем NL'], ['PLO', 'Омаха PLO'], ['other', 'Другое']], s.game)}</select></label>
      <label>${tour ? 'Турнир / бай-ин' : 'Лимит'}<input name="stakes" list="dl-stakes" value="${esc(s.stakes)}" placeholder="${tour ? '$5.50 Bounty' : 'NL10'}"></label>
      <label class="${tour ? 'hidden' : ''}" data-cash>Большой блайнд<input name="bb" inputmode="decimal" value="${esc(s.bb ?? '')}" placeholder="0.10"></label>
      <label><span data-lbl-in>${tour ? 'Бай-ин + ребаи' : 'Внёс за стол'}</span><input name="buyin" inputmode="decimal" value="${esc(s.buyin)}" placeholder="0" required></label>
      <label><span data-lbl-out>${tour ? 'Выигрыш' : 'Снял со стола'}</span><input name="cashout" inputmode="decimal" value="${esc(s.cashout)}" placeholder="0" required></label>
      <label>Часы<input name="h" type="number" min="0" value="${h || ''}" placeholder="0"></label>
      <label>Минуты<input name="m" type="number" min="0" max="59" value="${m || ''}" placeholder="0"></label>
      <label class="${tour ? 'hidden' : ''}" data-cash>Раздач сыграно<input name="hands" type="number" min="0" value="${esc(s.hands ?? '')}" placeholder="необязательно"></label>
      <label>Столов<input name="tables" type="number" min="1" value="${esc(s.tables ?? '')}" placeholder="1"></label>
      <label class="${tour ? '' : 'hidden'}" data-tour>Место<input name="place" value="${esc(s.place ?? '')}" placeholder="12"></label>
      <label class="${tour ? '' : 'hidden'}" data-tour>Игроков в турнире<input name="entrants" type="number" min="2" value="${esc(s.entrants ?? '')}" placeholder="необязательно"></label>
      <label class="wide">Заметки<textarea name="notes" rows="2" placeholder="Тилт, ключевые раздачи, что улучшить…">${esc(s.notes || '')}</textarea></label>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" type="submit">${e ? 'Сохранить' : pre ? 'Сохранить результат' : 'Добавить сессию'}</button>
      ${e || pre ? '<button class="btn" type="button" id="sf-cancel">Отмена</button>' : ''}
      <span class="small muted" id="sf-profit"></span>
    </div>
    </form>
    <datalist id="dl-sites">${sites.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <datalist id="dl-stakes">${stakes.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
  </div>`;
}
function viewSessions() {
  const list = filteredSessions();
  const f = state.f.ses;
  const key = {
    date: (s) => s.date + (s.created || ''), site: (s) => s.site, format: (s) => s.format, stakes: (s) => s.stakes,
    minutes: (s) => s.minutes || 0, buyin: (s) => s.buyin, cashout: (s) => s.cashout, profit: profitOf,
    hourly: (s) => (s.minutes ? profitOf(s) / s.minutes : -Infinity), hands: (s) => s.hands || 0,
  }[f.sort] || ((s) => s.date);
  const rows = [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * f.dir; });
  const th = (k, l, extra = '') => `<th class="sortable ${extra}" data-sort="${k}">${l}${f.sort === k ? (f.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  return sessionForm() + sessionFilters() + `<div class="card"><div class="card-head"><h2>Сессии <span class="muted small">${rows.length}</span></h2>
    <span class="small muted">Итого: <b class="${cls(sum(rows, profitOf))}">${money(sum(rows, profitOf))}</b> за ${fmtDur(sum(rows, (s) => s.minutes))}</span></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr>${th('date', 'Дата')}${th('site', 'Рум', 'l')}${th('format', 'Формат', 'l')}${th('stakes', 'Лимит', 'l')}${th('minutes', 'Время')}${th('buyin', 'Вход')}${th('cashout', 'Выход')}${th('profit', 'Профит')}${th('hourly', 'В час')}${th('hands', 'Раздач')}<th class="l">Заметка</th><th></th></tr></thead>
      <tbody>${rows.map((s) => `<tr>
        <td>${fmtDate(s.date)}</td><td class="l">${esc(s.site)}</td><td class="l"><span class="tag">${esc(FORMATS[s.format] || s.format)}</span></td>
        <td class="l">${esc(s.stakes)}${s.place ? ` <span class="muted small">· ${esc(s.place)}</span>` : ''}</td>
        <td>${fmtDur(s.minutes)}</td><td>${money(s.buyin, { signed: false })}</td><td>${money(s.cashout, { signed: false })}</td>
        <td class="${cls(profitOf(s))}"><b>${money(profitOf(s))}</b></td>
        <td>${s.minutes ? money(profitOf(s) / (s.minutes / 60)) : '—'}</td><td>${s.hands ? fmtNum(s.hands, 0) : '—'}</td>
        <td class="note l" title="${esc(s.notes)}">${esc(s.notes)}</td>
        <td><button class="btn sm" data-edit="${s.id}" title="Изменить">✎</button> <button class="btn sm danger" data-del="${s.id}" title="Удалить">✕</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Сессий пока нет — добавь первую в форме выше</div>'}
  </div>`;
}
let timerInt;
function afterSessions() {
  const form = $('#sf');
  const upd = () => {
    const fd = new FormData(form);
    const tour = isTourneyFmt(fd.get('format'));
    $$('[data-cash]', form).forEach((e) => e.classList.toggle('hidden', tour));
    $$('[data-tour]', form).forEach((e) => e.classList.toggle('hidden', !tour));
    $('[data-lbl-in]', form).textContent = tour ? 'Бай-ин + ребаи' : 'Внёс за стол';
    $('[data-lbl-out]', form).textContent = tour ? 'Выигрыш' : 'Снял со стола';
    const p = (toNum(fd.get('cashout')) ?? 0) - (toNum(fd.get('buyin')) ?? 0);
    $('#sf-profit').innerHTML = fd.get('buyin') || fd.get('cashout') ? `Профит: <b class="${cls(p)}">${money(p)}</b>` : '';
  };
  form.addEventListener('input', upd);
  upd();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const buyin = toNum(fd.get('buyin')), cashout = toNum(fd.get('cashout'));
    if (buyin == null || cashout == null) { toast('Укажи суммы входа и выхода (можно 0)'); return; }
    const old = state.editing ? state.sessions.find((s) => s.id === state.editing) : null;
    const pre = !old && state.prefill ? state.prefill : null;
    const s = {
      ...(old || pre || {}),
      id: old ? old.id : pre ? pre.id : uid(),
      created: old ? old.created : new Date().toISOString(),
      date: fd.get('date') || todayISO(),
      site: String(fd.get('site') || '').trim(),
      format: fd.get('format'),
      game: fd.get('game'),
      stakes: String(fd.get('stakes') || '').trim(),
      bb: toNum(fd.get('bb')),
      buyin, cashout,
      minutes: (toNum(fd.get('h')) || 0) * 60 + (toNum(fd.get('m')) || 0),
      hands: toNum(fd.get('hands')),
      tables: toNum(fd.get('tables')),
      place: String(fd.get('place') || '').trim(),
      entrants: toNum(fd.get('entrants')),
      notes: String(fd.get('notes') || '').trim(),
    };
    if (isTourneyFmt(s.format)) { s.bb = null; s.hands = null; } else { s.place = ''; s.entrants = null; }
    if (old && s.buyin !== old.buyin && !s.reentries) s.unitBuyin = null;
    await saveSessions([s]);
    state.editing = null;
    state.prefill = null;
    toast(old ? 'Сохранено' : pre ? `Турнир добавлен в историю: ${money(profitOf(s))}` : `Сессия добавлена: ${money(profitOf(s))}`);
    if (pre) { state.tab = 'tourneys'; saveUI(); }
    render();
  });
  $('#sf-cancel')?.addEventListener('click', () => { state.editing = null; state.prefill = null; render(); });
  $('#timer-start')?.addEventListener('click', async () => { state.timer = Date.now(); await DB.put('meta', state.timer, 'timer'); render(); });
  $('#timer-cancel')?.addEventListener('click', async () => { state.timer = null; await DB.put('meta', null, 'timer'); render(); });
  $('#timer-stop')?.addEventListener('click', async () => {
    const start = new Date(state.timer);
    const min = Math.max(1, Math.round((Date.now() - state.timer) / 60000));
    state.timer = null; await DB.put('meta', null, 'timer');
    render();
    const f = $('#sf');
    f.elements.h.value = Math.floor(min / 60) || '';
    f.elements.m.value = min % 60 || '';
    f.elements.date.value = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    f.elements.buyin.focus();
    toast(`Время сессии: ${fmtDur(min)}. Осталось вписать суммы.`);
  });
  clearInterval(timerInt);
  if (state.timer) timerInt = setInterval(() => { const l = $('#timer-label'); if (l) l.textContent = 'Идёт сессия: ' + fmtDur(Math.max(1, (Date.now() - state.timer) / 60000)); else clearInterval(timerInt); }, 15000);
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => { state.editing = b.dataset.edit; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const s = state.sessions.find((x) => x.id === b.dataset.del);
    if (!s || !confirm(`Удалить сессию ${fmtDate(s.date)} ${s.site} ${s.stakes} (${money(profitOf(s))})?`)) return;
    await DB.del('sessions', s.id);
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    if (state.editing === s.id) state.editing = null;
    render();
  }));
  bindSort('ses');
}
function bindSort(scope) {
  $$('th[data-sort]').forEach((t) => t.addEventListener('click', () => {
    const f = state.f[scope];
    if (f.sort === t.dataset.sort) f.dir *= -1; else { f.sort = t.dataset.sort; f.dir = -1; }
    saveUI(); render();
  }));
}

// ───────────────────────── Анализ раздач ─────────────────────────
const STATS = [
  ['VPIP', 'vpip', 'n', 'Добровольно вложил деньги до флопа'],
  ['PFR', 'pfr', 'n', 'Рейз до флопа'],
  ['3-бет', 'd3b', 'o3b', 'Ререйз против одного рейза'],
  ['Фолд на 3-бет', 'f3b', 'of3b', 'Сбросил свой рейз под 3-бет'],
  ['Стил (ATS)', 'st', 'ost', 'Открыл рейзом с CO/BTN/SB, когда все до тебя сбросили'],
  ['Контбет на флопе', 'cb', 'ocb', 'Поставил на флопе после своего рейза до флопа'],
  ['Фолд на контбет', 'fcb', 'ofcb', 'Сбросил против контбета на флопе'],
  ['WTSD', 'sd', 'sf', 'Дошёл до вскрытия из тех раздач, где видел флоп'],
  ['W$SD', 'wsd', 'sd', 'Выиграл на вскрытии'],
  ['WWSF', 'wsf', 'sf', 'Выиграл банк, увидев флоп'],
];
const STAT_KEYS = ['vpip', 'pfr', 'o3b', 'd3b', 'of3b', 'f3b', 'ost', 'st', 'ocb', 'cb', 'ofcb', 'fcb', 'agg', 'calls', 'sf', 'sd', 'wsd', 'wsf'];
function agg(statObjs) {
  const a = { n: 0 };
  for (const k of STAT_KEYS) a[k] = 0;
  for (const s of statObjs) { a.n++; for (const k of STAT_KEYS) if (s[k]) a[k] += s[k]; }
  return a;
}
const af = (a) => (a.calls ? a.agg / a.calls : a.agg ? Infinity : null);
const fmtAF = (v) => (v == null ? '—' : v === Infinity ? '∞' : fmtNum(v, 2));
const stakeKey = (h) => (h.tourney ? 'Турниры' : `${h.game === 'PLO' ? 'PLO' : 'NL'} ${h.cur}${h.sb}/${h.cur}${h.bb}`);

function heroHands() {
  const f = state.f.hh;
  return state.hands.filter((h) => h.hero && inPeriod(h.date, f.period)
    && (f.type === 'all' || (f.type === 'cash') === !h.tourney)
    && (f.stakes === 'all' || stakeKey(h) === f.stakes)
    && (f.site === 'all' || h.site === f.site)
    && (f.hero === 'all' || h.hero === f.hero));
}
function importBox() {
  return `<div class="card"><div class="drop" id="drop">
    <p><b>Перетащи сюда файлы истории раздач</b> (.txt) или выбери их</p>
    <div class="btn-row" style="justify-content:center">
      <label class="btn primary">Выбрать файлы<input type="file" id="hh-files" accept=".txt,.log,text/plain" multiple hidden></label>
      <label class="btn">Выбрать папку<input type="file" id="hh-dir" webkitdirectory multiple hidden></label>
    </div>
    <p class="small muted" style="margin:10px 0 0">История раздач и сводки турниров PokerStars, GGPoker (выгрузка из PokerCraft) и румов с таким же форматом. Повторная загрузка тех же файлов не создаёт дублей.</p>
    <div id="import-status" class="small" style="margin-top:8px"></div>
  </div></div>`;
}
function viewHands() {
  const f = state.f.hh;
  const withHero = state.hands.filter((h) => h.hero);
  if (!withHero.length) {
    return importBox() + `<div class="card"><h2>Где взять историю раздач</h2><ul class="help">
      <li><b>PokerStars:</b> Настройки → Воспроизведение и история → включить «Сохранять историю раздач». Файлы лежат в <code>%LOCALAPPDATA%\\PokerStars\\HandHistory\\&lt;ник&gt;</code> — можно выбрать эту папку целиком.</li>
      <li><b>GGPoker:</b> PokerCraft → Game Session / Hand History → скачать архив и распаковать.</li>
      <li>Пример для проверки лежит в папке программы: <code>samples\\sample_hands.txt</code>.</li>
    </ul></div>`;
  }
  const list = heroHands();
  const allCash = list.length && list.every((h) => !h.tourney);
  const unit = allCash ? f.unit : 'bb';
  const filters = `<div class="filters" data-scope="hh">
    ${sel('period', 'Период', PERIODS, f.period)}
    ${sel('type', 'Тип', [['all', 'Всё'], ['cash', 'Кэш'], ['tour', 'Турниры']], f.type)}
    ${sel('stakes', 'Лимит', [['all', 'Все'], ...uniq(withHero.map(stakeKey)).map((x) => [x, x])], f.stakes)}
    ${sel('site', 'Рум', [['all', 'Все'], ...uniq(withHero.map((h) => h.site)).map((x) => [x, x])], f.site)}
    ${uniq(withHero.map((h) => h.hero)).length > 1 ? sel('hero', 'Ник', [['all', 'Все'], ...uniq(withHero.map((h) => h.hero)).map((x) => [x, x])], f.hero) : ''}
  </div>`;
  if (!list.length) return importBox() + filters + '<div class="card empty">Нет раздач под выбранные фильтры</div>';

  const a = agg(list.map((h) => h.players[h.hero]));
  const netBB = sum(list, (h) => h.netBB);
  const cashList = list.filter((h) => !h.tourney);
  const cashNet = sum(cashList, (h) => h.net);
  const curs = uniq(cashList.map((h) => h.cur));
  const cur = curs.length === 1 ? curs[0] : '';
  const bb100 = (netBB / list.length) * 100;
  const rake = sum(cashList.filter((h) => h.net > 0), (h) => h.rake);

  let html = importBox() + filters;
  html += `<div class="kpis">
    ${kpi('Раздач', fmtNum(list.length, 0), `${fmtDate(list[0].date)} — ${fmtDate(list[list.length - 1].date)}`)}
    ${cashList.length ? kpi('Выигрыш в кэше', money(cashNet, { cur }), `рейк в выигранных банках ${money(rake, { cur, signed: false })}`, cls(cashNet)) : ''}
    ${kpi('bb/100', signed(bb100), `всего ${signed(netBB, 1)} bb`, cls(bb100))}
    ${kpi('VPIP / PFR', `${fmtNum(pct(a.vpip, a.n), 1)} / ${fmtNum(pct(a.pfr, a.n), 1)}`, 'добровольно / рейз до флопа')}
    ${kpi('3-бет', fmtPct(pct(a.d3b, a.o3b)), `из ${a.o3b} возможностей`)}
    ${kpi('AF', fmtAF(af(a)), 'агрессия после флопа')}
    ${kpi('WTSD / W$SD', `${fmtNum(pct(a.sd, a.sf) ?? 0, 0)} / ${fmtNum(pct(a.wsd, a.sd) ?? 0, 0)}`, 'до вскрытия / выиграл на нём, %')}
  </div>`;

  html += `<div class="card"><div class="card-head"><h2>График выигрыша</h2>
    ${allCash ? `<div class="seg" data-unit><button data-u="bb" class="${unit === 'bb' ? 'on' : ''}">в bb</button><button data-u="money" class="${unit === 'money' ? 'on' : ''}">в деньгах</button></div>` : '<span class="small muted">в больших блайндах (bb)</span>'}</div>
    <div class="legend"><span><i style="background:var(--s1)"></i>Общий</span><span><i style="background:var(--s2)"></i>На вскрытии</span><span><i style="background:var(--s3)"></i>Без вскрытия</span></div>
    <div class="chart" id="ch-hands"></div>
    <div class="small muted">Если линия «без вскрытия» уходит вниз сильнее обычного — ты слишком часто сдаёшься без вскрытия; если проседает «на вскрытии» — платишь слишком лёгкими руками.</div>
  </div>`;

  // статистика
  html += `<div class="grid2"><div class="card"><h2>Статистика</h2><div class="table-wrap"><table>
    <thead><tr><th>Показатель</th><th>Значение</th><th>Выборка</th><th class="l">Что значит</th></tr></thead><tbody>
    ${STATS.map(([name, k, base, hint]) => `<tr><td class="stat-name">${name}</td><td><b>${fmtPct(pct(a[k], base === 'n' ? a.n : a[base]))}</b></td><td class="muted">${fmtNum(a[k], 0)}/${fmtNum(base === 'n' ? a.n : a[base], 0)}</td><td class="stat-hint">${hint}</td></tr>`).join('')}
    <tr><td class="stat-name">AF</td><td><b>${fmtAF(af(a))}</b></td><td class="muted">${a.agg}/${a.calls}</td><td class="stat-hint">(ставки + рейзы) / коллы после флопа</td></tr>
    </tbody></table></div></div>`;

  // по позициям
  const POS = ['BTN', 'CO', 'MP', 'EP', 'SB', 'BB'];
  html += `<div class="card"><h2>По позициям</h2><div class="table-wrap"><table>
    <thead><tr><th>Позиция</th><th>Раздач</th><th>VPIP</th><th>PFR</th><th>bb/100</th><th>${cashList.length ? 'Кэш' : 'bb'}</th></tr></thead><tbody>
    ${POS.map((p) => {
      const hs = list.filter((h) => h.heroPos === p);
      if (!hs.length) return '';
      const pa = agg(hs.map((h) => h.players[h.hero]));
      const nb = sum(hs, (h) => h.netBB);
      const cn = sum(hs.filter((h) => !h.tourney), (h) => h.net);
      return `<tr><td><b>${p}</b></td><td>${fmtNum(hs.length, 0)}</td><td>${fmtPct(pct(pa.vpip, pa.n))}</td><td>${fmtPct(pct(pa.pfr, pa.n))}</td>
        <td class="${cls(nb)}">${signed((nb / hs.length) * 100)}</td><td class="${cashList.length ? cls(cn) : cls(nb)}">${cashList.length ? money(cn, { cur }) : signed(nb, 1)}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="small muted" style="margin:10px 0 0">EP — ранние позиции, MP — средние. Нормально, что блайнды в минусе: там ты платишь обязательные ставки.</p></div></div>`;

  // сетка стартовых рук
  html += `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Стартовые руки — выигрыш в bb</h2><span class="small muted">наведи на клетку</span></div>
    <div class="hgrid" id="hgrid"></div>
    <div class="scale"><span>минус</span><div class="bar" style="background:linear-gradient(90deg, rgb(var(--div-neg)), var(--div-mid), rgb(var(--div-pos)))"></div><span>плюс</span></div></div>`;

  // список раздач
  const L = f.list;
  const sorted = [...list].sort(L === 'win' ? (x, y) => y.netBB - x.netBB : L === 'loss' ? (x, y) => x.netBB - y.netBB : (x, y) => (y.date || '').localeCompare(x.date || ''));
  html += `<div class="card"><div class="card-head"><h2>Раздачи</h2>
    <div class="seg" data-list><button data-l="win" class="${L === 'win' ? 'on' : ''}">Крупные выигрыши</button><button data-l="loss" class="${L === 'loss' ? 'on' : ''}">Крупные проигрыши</button><button data-l="recent" class="${L === 'recent' ? 'on' : ''}">Последние</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Дата</th><th class="l">Рум</th><th class="l">Лимит</th><th class="l">Позиция</th><th class="l">Карты</th><th>Банк</th><th>bb</th><th>Результат</th></tr></thead>
    <tbody>${sorted.slice(0, 50).map((h) => `<tr class="click" data-hand="${esc(h.id)}"><td>${fmtDateTime(h.date)}</td><td class="l">${esc(h.site)}</td><td class="l">${esc(stakeKey(h))}</td><td class="l">${esc(h.heroPos || '')}</td>
      <td class="l">${cardsHTML(h.heroCards)}</td><td>${h.tourney ? fmtNum(h.pot, 0) : money(h.pot, { cur: h.cur, signed: false })}</td><td class="${cls(h.netBB)}">${signed(h.netBB, 1)}</td>
      <td class="${cls(h.net)}"><b>${h.tourney ? signed(h.net, 0) + ' фиш.' : money(h.net, { cur: h.cur })}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin:10px 0 0">Нажми на раздачу, чтобы посмотреть её полный текст.</p></div>`;
  return html;
}
function afterHands() {
  bindImport();
  const list = heroHands();
  if (!list.length) return;
  const allCash = list.every((h) => !h.tourney);
  const unit = allCash ? state.f.hh.unit : 'bb';
  const cur = uniq(list.map((h) => h.cur))[0] || '';
  const val = (h) => (unit === 'money' ? h.net : h.netBB);
  const tot = [0], sd = [0], nsd = [0];
  for (const h of list) {
    const v = val(h); const went = h.players[h.hero].sd;
    tot.push(tot[tot.length - 1] + v);
    sd.push(sd[sd.length - 1] + (went ? v : 0));
    nsd.push(nsd[nsd.length - 1] + (went ? 0 : v));
  }
  const fmtV = unit === 'money' ? (v) => money(v, { cur }) : (v) => signed(v, 1) + ' bb';
  lineChart($('#ch-hands'), {
    height: 300,
    series: [
      { name: 'Общий', color: 'var(--s1)', values: tot },
      { name: 'На вскрытии', color: 'var(--s2)', values: sd },
      { name: 'Без вскрытия', color: 'var(--s3)', values: nsd },
    ],
    xLabel: (i) => (i ? `Раздача ${fmtNum(i, 0)} · ${fmtDateTime(list[i - 1].date)}` : 'Старт'),
    yFmt: fmtV,
  });

  // сетка рук
  const R = PokerParser.RANKS;
  const g = {};
  for (const h of list) if (h.heroClass) { const c = g[h.heroClass] || (g[h.heroClass] = { n: 0, bb: 0 }); c.n++; c.bb += h.netBB; }
  const maxAbs = Math.max(1, ...Object.values(g).map((c) => Math.abs(c.bb)));
  const grid = $('#hgrid');
  let cells = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const lbl = i === j ? R[i] + R[j] : i < j ? R[i] + R[j] + 's' : R[j] + R[i] + 'o';
    const c = g[lbl];
    if (!c) { cells += `<div class="none" data-c="${lbl}">${lbl}</div>`; continue; }
    const t = Math.sqrt(Math.abs(c.bb) / maxAbs);
    const alpha = 0.12 + 0.88 * t;
    const rgb = c.bb >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
    cells += `<div data-c="${lbl}" style="background:rgba(${rgb},${alpha.toFixed(2)});${alpha > 0.6 ? 'color:#fff' : ''}">${lbl}</div>`;
  }
  grid.innerHTML = cells;
  grid.addEventListener('mousemove', (ev) => {
    const d = ev.target.closest('[data-c]'); if (!d) return hideTip();
    const c = g[d.dataset.c];
    showTip(`<div class="t">${d.dataset.c}</div>` + (c ? tipRow('', 'Раздач', c.n) + tipRow('', 'Итого', signed(c.bb, 1) + ' bb') + tipRow('', 'В среднем', signed(c.bb / c.n, 2) + ' bb') : '<span class="muted">не было</span>'), ev.clientX, ev.clientY);
  });
  grid.addEventListener('mouseleave', hideTip);

  $$('[data-unit] button').forEach((b) => b.addEventListener('click', () => { state.f.hh.unit = b.dataset.u; saveUI(); render(); }));
  $$('[data-list] button').forEach((b) => b.addEventListener('click', () => { state.f.hh.list = b.dataset.l; saveUI(); render(); }));
  $$('[data-hand]').forEach((r) => r.addEventListener('click', () => openHand(r.dataset.hand)));
}
async function openHand(id) {
  const r = await DB.get('raw', id);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><div class="modal-head"><b>Раздача ${esc(id.split(':').pop())}</b><button class="btn sm" data-close>Закрыть</button></div><pre>${esc(r ? r.raw : 'Текст раздачи не сохранён')}</pre></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.dataset.close !== undefined) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
}

async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}
async function importFiles(fileList) {
  const files = [...fileList].filter((f) => /\.(txt|log)$/i.test(f.name) || f.type === 'text/plain');
  const status = $('#import-status');
  if (!files.length) { toast('Не нашёл .txt файлов с раздачами'); return; }
  const existing = new Set(state.hands.map((h) => h.id));
  const added = [], raws = [], summaries = new Map();
  let dup = 0, failed = 0, done = 0;
  for (const file of files) {
    try {
      const r = PokerParser.parseFile(await readText(file));
      failed += r.failed;
      for (const t of r.tournaments) if (!t.still) summaries.set(t.id, t);
      for (const h of r.hands) {
        if (existing.has(h.id)) { dup++; continue; }
        existing.add(h.id);
        const { raw, ...rest } = h;
        added.push(rest); raws.push({ id: h.id, raw });
      }
    } catch (e) { failed++; }
    done++;
    if (status && done % 20 === 0) status.textContent = `Обработано файлов: ${done} из ${files.length}…`;
  }
  for (let i = 0; i < added.length; i += 5000) {
    await DB.putMany('hands', added.slice(i, i + 5000));
    await DB.putMany('raw', raws.slice(i, i + 5000));
  }
  state.hands.push(...added);
  sortHands();
  tHandsCache = null;
  // сводки турниров становятся записями в истории (тот же список, что и сессии)
  const tSaved = [];
  let tNew = 0;
  for (const t of summaries.values()) {
    const old = state.sessions.find((s) => s.id === 'T:' + t.id);
    if (!old) tNew++;
    tSaved.push(summaryToSession(t, old));
  }
  if (tSaved.length) await saveSessions(tSaved);
  await fillTourneyDurations();
  const parts = [];
  if (added.length || dup || !summaries.size) parts.push(`Добавлено раздач: ${fmtNum(added.length, 0)}` + (dup ? `, уже были: ${fmtNum(dup, 0)}` : ''));
  if (summaries.size) parts.push(`турниров: ${tNew} новых` + (summaries.size - tNew ? `, ${summaries.size - tNew} обновлено` : ''));
  if (failed) parts.push(`не распознано: ${failed}`);
  const msg = parts.join(' · ');
  render();
  toast(msg, 5000);
  const st = $('#import-status'); if (st) st.textContent = msg;
}
function bindImport() {
  const drop = $('#drop');
  if (!drop) return;
  $('#hh-files').addEventListener('change', (e) => importFiles(e.target.files));
  $('#hh-dir').addEventListener('change', (e) => importFiles(e.target.files));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => importFiles(e.dataTransfer.files));
}

// ───────────────────────── Турниры ─────────────────────────
// Турнир — это запись в общем списке сессий с форматом MTT / SNG / Spin.
// Сводки турниров из рума создают такие записи сами (id «T:рум:номер»), раздачи турнира привязываются по номеру.
const tKey = (site, tid) => `${site}:${tid}`;
let tHandsCache = null;
function handsByTourney() {
  if (tHandsCache) return tHandsCache;
  const map = new Map();
  for (const h of state.hands) {
    if (!h.tourney || !h.tourneyId || !h.hero) continue;
    const k = tKey(h.site, h.tourneyId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(h);
  }
  tHandsCache = map;
  return map;
}
function handsDuration(hs) {
  if (!hs.length) return 0;
  const a = new Date(hs[0].date), b = new Date(hs[hs.length - 1].date);
  return Math.max(1, Math.round((b - a) / 60000) + 1);
}
function summaryToSession(t, old) {
  const label = t.name || `${t.cur}${fmtNum(t.buyin)}${t.format === 'spin' ? ' Spin' : ''}`;
  return {
    ...(old || {}),
    id: 'T:' + t.id,
    created: old?.created || new Date().toISOString(),
    date: (t.date || old?.date || todayISO()).slice(0, 10),
    start: t.date || old?.start || null,
    site: t.site, format: t.format, game: t.game,
    stakes: old?.stakes || label,
    tname: t.name || old?.tname || '',
    tid: t.tid,
    buyin: t.totalBuyin, unitBuyin: t.buyin, reentries: t.reentries,
    cashout: t.prize,
    entrants: t.entrants, pool: t.pool,
    place: t.finish ? String(t.finish) : (old?.place || ''),
    minutes: old?.minutes || 0,
    tables: old?.tables ?? null, bb: null, hands: null,
    notes: old?.notes || '',
    source: 'summary',
  };
}
async function saveSessions(list) {
  await DB.putMany('sessions', list);
  for (const s of list) {
    const i = state.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) state.sessions[i] = s; else state.sessions.push(s);
  }
  sortSessions();
}
/** Если у турнира не указано время, берём его по первой и последней раздаче. */
async function fillTourneyDurations() {
  const map = handsByTourney();
  const upd = [];
  for (const s of state.sessions) {
    if (!s.tid || s.minutes) continue;
    const hs = map.get(tKey(s.site, s.tid));
    if (hs && hs.length) upd.push({ ...s, minutes: handsDuration(hs) });
  }
  if (upd.length) await saveSessions(upd);
}
function tInfo(s) {
  const m = String(s.place || '').match(/^\s*(\d+)(?:\s*\/\s*(\d+))?/);
  const finish = m ? +m[1] : null;
  const entrants = s.entrants || (m && m[2] ? +m[2] : null);
  const hs = s.tid ? handsByTourney().get(tKey(s.site, s.tid)) || [] : [];
  return { s, finish, entrants, hs, unit: s.unitBuyin || s.buyin || 0, profit: profitOf(s), name: s.tname || s.stakes || '—' };
}
const BI_BUCKETS = [0, 2, 10, 30, 100, Infinity];
function biBucket(v) { for (let i = 0; i < BI_BUCKETS.length - 1; i++) if (v < BI_BUCKETS[i + 1]) return i; return BI_BUCKETS.length - 2; }
function biLabel(i) {
  const c = state.settings.currency, a = BI_BUCKETS[i], b = BI_BUCKETS[i + 1];
  return b === Infinity ? `${c}${a}+` : a === 0 ? `до ${c}${b}` : `${c}${a}–${b}`;
}
const pctOf = (x) => (x.finish && x.entrants ? x.finish / x.entrants : null);

function filteredTourneys() {
  const f = state.f.tr;
  const q = f.q.trim().toLowerCase();
  return state.sessions.filter((s) => isTourneyFmt(s.format)).map(tInfo).filter((x) => inPeriod(x.s.date, f.period)
    && (f.format === 'all' || x.s.format === f.format)
    && (f.site === 'all' || x.s.site === f.site)
    && (f.bi === 'all' || biBucket(x.unit) === +f.bi)
    && (!q || x.name.toLowerCase().includes(q) || String(x.s.tid || '').includes(q)));
}
function unmatchedTourneys() {
  const known = new Set(state.sessions.filter((s) => s.tid).map((s) => tKey(s.site, s.tid)));
  const out = [];
  for (const [k, hs] of handsByTourney()) {
    if (known.has(k)) continue;
    const h = hs[0];
    out.push({ k, hs, site: h.site, tid: h.tourneyId, name: h.tname || `#${h.tourneyId}`, date: h.date, buyin: h.buyin, chips: sum(hs, (x) => x.net) });
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function viewTourneys() {
  const f = state.f.tr;
  const allT = state.sessions.filter((s) => isTourneyFmt(s.format));
  const unmatched = unmatchedTourneys();
  const help = `<div class="card"><h2>Как пополнять историю турниров</h2><ul class="help">
    <li><b>Автоматически:</b> загрузи сводки турниров (tournament summary). В PokerStars включи в настройках «Воспроизведение и история» сохранение сводок турниров — файлы <code>TS…txt</code> лягут в ту же папку, что и история раздач, и подхватятся при выборе папки. В GGPoker сводки скачиваются в PokerCraft.</li>
    <li><b>Вручную:</b> во вкладке «Сессии» выбери формат MTT, SNG или Spin & Go и укажи бай-ин, выигрыш, место и число участников.</li>
    <li>Если загрузить ещё и раздачи турнира, тут появятся график стека и статистика игры по каждому турниру.</li>
  </ul></div>`;
  let html = importBox();
  if (unmatched.length) {
    html += `<div class="card"><div class="card-head"><h2>Турниры из раздач без результата <span class="muted small">${unmatched.length}</span></h2>
      <span class="small muted">Раздачи есть, а места и выигрыша нет — загрузи сводку или впиши вручную</span></div>
      <div class="table-wrap" style="max-height:260px"><table><thead><tr><th>Дата</th><th class="l">Рум</th><th class="l">Турнир</th><th>Бай-ин</th><th>Раздач</th><th>Фишки</th><th></th></tr></thead><tbody>
      ${unmatched.slice(0, 100).map((u) => `<tr><td>${fmtDateTime(u.date)}</td><td class="l">${esc(u.site)}</td><td class="l">${esc(u.name)} <span class="muted small">#${esc(u.tid)}</span></td>
        <td>${u.buyin != null ? money(u.buyin, { signed: false }) : '—'}</td><td>${u.hs.length}</td><td class="${cls(u.chips)}">${signed(u.chips, 0)}</td>
        <td><button class="btn sm" data-fill="${esc(u.k)}">Вписать результат</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (!allT.length) return html + help;

  const list = filteredTourneys();
  const sites = uniq(allT.map((s) => s.site));
  html += `<div class="filters" data-scope="tr">
    ${sel('period', 'Период', PERIODS, f.period)}
    ${sel('format', 'Формат', [['all', 'Все'], ['mtt', 'MTT'], ['sng', 'SNG'], ['spin', 'Spin & Go']], f.format)}
    ${sel('site', 'Рум', [['all', 'Все'], ...sites.map((x) => [x, x])], f.site)}
    ${sel('bi', 'Бай-ин', [['all', 'Все'], ...BI_BUCKETS.slice(0, -1).map((_, i) => [String(i), biLabel(i)])], f.bi)}
    <label>Поиск<input data-f="q" value="${esc(f.q)}" placeholder="название или номер" style="width:190px"></label>
  </div>`;
  if (!list.length) return html + '<div class="card empty">Нет турниров под выбранные фильтры</div>';

  const n = list.length;
  const invested = sum(list, (x) => x.s.buyin);
  const profit = sum(list, (x) => x.profit);
  const itm = list.filter((x) => x.s.cashout > 0).length;
  const timed = list.filter((x) => x.s.minutes > 0);
  const minutes = sum(timed, (x) => x.s.minutes);
  const timedProfit = sum(timed, (x) => x.profit);
  const mttLike = list.filter((x) => x.entrants > 9);
  const ft = mttLike.filter((x) => x.finish && x.finish <= 9).length;
  const wins = list.filter((x) => x.finish === 1).length;
  const best = list.reduce((a, x) => (!a || x.s.cashout > a.s.cashout ? x : a), null);
  const pcts = mttLike.map(pctOf).filter((v) => v != null && v <= 1);
  const avgPct = pcts.length ? (sum(pcts, (v) => v) / pcts.length) * 100 : null;
  const entries = sum(list, (x) => 1 + (x.s.reentries || 0));

  html += `<div class="kpis">
    ${kpi('Турниров', fmtNum(n, 0), `средний бай-ин ${money(sum(list, (x) => x.unit) / n, { signed: false })}`)}
    ${kpi('Профит', money(profit), `вложено ${money(invested, { signed: false })}`, cls(profit))}
    ${kpi('ROI', fmtPct(pct(profit, invested)), entries > n ? `${entries} входов с ре-энтри` : 'профит / вложено', cls(profit))}
    ${kpi('В деньгах (ITM)', fmtPct(pct(itm, n), 0), `${itm} из ${n}`)}
    ${kpi('Финальных столов', mttLike.length ? fmtNum(ft, 0) : '—', `побед: ${wins}`)}
    ${best && best.s.cashout > 0 ? kpi('Лучший занос', money(best.s.cashout, { signed: false }), `${esc(best.name)}${best.finish ? ` · ${best.finish} место` : ''}`) : ''}
    ${kpi('Средний финиш', avgPct == null ? '—' : `топ ${fmtNum(avgPct, 0)}%`, 'в турнирах от 10 игроков')}
    ${minutes ? kpi('В час', money(timedProfit / (minutes / 60)), `${timed.length} из ${n} турниров с известным временем, ${fmtDur(minutes)}`, cls(timedProfit)) : ''}
  </div>`;

  html += `<div class="card"><div class="card-head"><h2>Профит по турнирам, накопительно</h2></div><div class="chart" id="ch-tcum"></div></div>`;
  html += `<div class="grid2">
    <div class="card"><div class="card-head"><h2>Где вылетаю</h2><span class="small muted">турниры от 10 игроков, место в % от поля</span></div><div class="chart" id="ch-tfin"></div></div>
    ${tBreakdown(list, (x) => biBucket(x.unit), 'По бай-инам', biLabel)}
  </div><div style="height:16px"></div>
  <div class="grid2">${tBreakdown(list, (x) => x.s.format, 'По формату', (k) => FORMATS[k] || k)}${tBreakdown(list, (x) => x.s.site || '—', 'По румам', (k) => k)}</div>`;

  // список
  const key = {
    date: (x) => (x.s.start || x.s.date) + (x.s.created || ''), name: (x) => x.name.toLowerCase(), site: (x) => x.s.site, buyin: (x) => x.s.buyin,
    entrants: (x) => x.entrants || 0, finish: (x) => (x.finish ? x.finish : Infinity), cashout: (x) => x.s.cashout, profit: (x) => x.profit,
    roi: (x) => (x.s.buyin ? x.profit / x.s.buyin : -Infinity), hands: (x) => x.hs.length,
  }[f.sort] || ((x) => x.s.date);
  const rows = [...list].sort((a, b) => { const p = key(a), q = key(b); return (p < q ? -1 : p > q ? 1 : 0) * f.dir; });
  const th = (k, l, c = '') => `<th class="sortable ${c}" data-sort="${k}">${l}${f.sort === k ? (f.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  html += `<div class="card" style="margin-top:16px"><div class="card-head"><h2>История турниров <span class="muted small">${rows.length}</span></h2><span class="small muted">нажми на турнир, чтобы открыть подробности</span></div>
    <div class="table-wrap" style="max-height:75vh"><table><thead><tr>
      ${th('date', 'Дата')}${th('site', 'Рум', 'l')}${th('name', 'Турнир', 'l')}${th('buyin', 'Бай-ин')}${th('entrants', 'Игроков')}${th('finish', 'Место')}${th('cashout', 'Выигрыш')}${th('profit', 'Профит')}${th('roi', 'ROI')}${th('hands', 'Раздач')}<th></th>
    </tr></thead><tbody>${rows.slice(0, 500).map((x) => `<tr class="click" data-t="${esc(x.s.id)}">
      <td>${fmtDate(x.s.date)}${x.s.start ? ` <span class="muted small">${x.s.start.slice(11, 16)}</span>` : ''}</td>
      <td class="l">${esc(x.s.site)}</td>
      <td class="l">${esc(x.name)} <span class="tag">${esc(FORMATS[x.s.format] || x.s.format)}</span>${x.s.reentries ? ` <span class="muted small">+${x.s.reentries} ре-энтри</span>` : ''}</td>
      <td>${money(x.s.buyin, { signed: false })}</td><td>${x.entrants ? fmtNum(x.entrants, 0) : '—'}</td>
      <td>${x.finish ? `<b>${x.finish}</b>${x.finish === 1 ? ' 🏆' : ''}` : '—'}</td>
      <td>${x.s.cashout > 0 ? money(x.s.cashout, { signed: false }) : '<span class="muted">—</span>'}</td>
      <td class="${cls(x.profit)}"><b>${money(x.profit)}</b></td>
      <td class="${cls(x.profit)}">${x.s.buyin ? fmtPct((x.profit / x.s.buyin) * 100, 0) : '—'}</td>
      <td>${x.hs.length || '—'}</td>
      <td><button class="btn sm" data-tedit="${esc(x.s.id)}" title="Изменить">✎</button></td>
    </tr>`).join('')}</tbody></table></div></div>`;
  return html + help;
}
function tBreakdown(list, keyFn, title, labelFn) {
  const g = new Map();
  for (const x of list) {
    const k = keyFn(x);
    const r = g.get(k) || { k, n: 0, inv: 0, p: 0, itm: 0 };
    r.n++; r.inv += x.s.buyin || 0; r.p += x.profit; if (x.s.cashout > 0) r.itm++;
    g.set(k, r);
  }
  const rows = [...g.values()].sort((a, b) => (typeof a.k === 'number' ? a.k - b.k : b.n - a.n));
  return `<div class="card"><h2>${esc(title)}</h2><div class="table-wrap"><table>
    <thead><tr><th>Группа</th><th>Турниров</th><th>Вложено</th><th>Профит</th><th>ROI</th><th>ITM</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(labelFn(r.k))}</td><td>${r.n}</td><td>${money(r.inv, { signed: false })}</td>
      <td class="${cls(r.p)}">${money(r.p)}</td><td class="${cls(r.p)}">${fmtPct(pct(r.p, r.inv))}</td><td>${fmtPct(pct(r.itm, r.n), 0)}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}
function afterTourneys() {
  bindImport();
  bindSort('tr');
  $$('[data-fill]').forEach((b) => b.addEventListener('click', () => {
    const u = unmatchedTourneys().find((x) => x.k === b.dataset.fill);
    if (!u) return;
    const h = u.hs[0];
    state.prefill = {
      id: 'T:' + u.k, date: (u.date || todayISO()).slice(0, 10), start: u.date, site: u.site,
      format: h.maxPlayers === 3 ? 'spin' : 'mtt', game: h.game, stakes: u.name, tname: h.tname || '', tid: u.tid,
      buyin: u.buyin ?? '', unitBuyin: u.buyin ?? null, cashout: '', minutes: handsDuration(u.hs), place: '', entrants: '', notes: '', tables: null,
    };
    state.editing = null; state.tab = 'sessions'; saveUI(); render(); window.scrollTo(0, 0);
    toast('Впиши выигрыш (0, если без призовых), место и число игроков');
  }));
  $$('[data-tedit]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    state.editing = b.dataset.tedit; state.prefill = null; state.tab = 'sessions'; saveUI(); render(); window.scrollTo(0, 0);
  }));
  $$('[data-t]').forEach((r) => r.addEventListener('click', () => openTourney(r.dataset.t)));

  const list = filteredTourneys();
  if (!list.length) return;
  const ordered = [...list].sort((a, b) => ((a.s.start || a.s.date) + (a.s.created || '')).localeCompare((b.s.start || b.s.date) + (b.s.created || '')));
  const vals = [0];
  for (const x of ordered) vals.push(vals[vals.length - 1] + x.profit);
  lineChart($('#ch-tcum'), {
    series: [{ name: 'Профит', color: 'var(--s1)', values: vals }],
    xLabel: (i) => (i ? `Турнир ${i} · ${fmtDate(ordered[i - 1].s.date)} · ${ordered[i - 1].name}` : 'Старт'),
    yFmt: (v) => money(v),
  });
  const FB = [[0.01, 'топ 1%'], [0.05, '1–5%'], [0.1, '5–10%'], [0.15, '10–15%'], [0.25, '15–25%'], [0.5, '25–50%'], [1.0001, '50–100%']];
  const counts = FB.map(() => 0);
  const mtt = list.filter((x) => x.entrants > 9 && pctOf(x) != null);
  for (const x of mtt) { const p = pctOf(x); counts[FB.findIndex(([b]) => p <= b)]++; }
  const el = $('#ch-tfin');
  if (!mtt.length) { el.innerHTML = '<div class="empty">Нужны турниры с известным местом и числом игроков</div>'; return; }
  barChart(el, {
    height: 200,
    bars: FB.map(([, l], i) => ({ label: l, value: counts[i], tip: `<div class="t">${l} поля</div>${tipRow('', 'Турниров', counts[i])}${tipRow('', 'Доля', fmtPct(pct(counts[i], mtt.length), 0))}` })),
  });
}
function openModal(title, html, wide) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" style="${wide ? 'max-width:920px' : ''}"><div class="modal-head"><b>${title}</b><button class="btn sm" data-close>Закрыть</button></div><div class="modal-body" style="overflow:auto;padding:16px">${html}</div></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && document.querySelectorAll('.modal-back').length === 1) close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.dataset.close !== undefined) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  return back;
}
function openTourney(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const x = tInfo(s);
  const hs = x.hs;
  const a = hs.length ? agg(hs.map((h) => h.players[h.hero])) : null;
  const row = (l, v) => `<tr><td class="l muted">${l}</td><td class="l"><b>${v}</b></td></tr>`;
  let html = `<div class="grid2"><div><table>
    ${row('Рум', esc(s.site))}${s.tid ? row('Номер', '#' + esc(s.tid)) : ''}
    ${row('Начало', s.start ? fmtDateTime(s.start) : fmtDate(s.date))}${row('Формат', esc(FORMATS[s.format] || s.format))}
    ${row('Бай-ин', money(x.unit, { signed: false }) + (s.reentries ? ` × ${1 + s.reentries} входа = ${money(s.buyin, { signed: false })}` : ''))}
    ${row('Игроков', x.entrants ? fmtNum(x.entrants, 0) : '—')}${s.pool ? row('Призовой фонд', money(s.pool, { signed: false })) : ''}
  </table></div><div><table>
    ${row('Место', x.finish ? `${x.finish}${x.entrants ? ` из ${fmtNum(x.entrants, 0)} (топ ${fmtNum((x.finish / x.entrants) * 100, 1)}%)` : ''}` : '—')}
    ${row('Выигрыш', money(s.cashout, { signed: false }))}
    ${row('Профит', `<span class="${cls(x.profit)}">${money(x.profit)}</span>`)}
    ${row('ROI', s.buyin ? fmtPct((x.profit / s.buyin) * 100, 0) : '—')}
    ${row('Длительность', fmtDur(s.minutes))}
  </table></div></div>`;
  if (s.notes) html += `<p class="help">📝 ${esc(s.notes)}</p>`;
  if (hs.length) {
    html += `<div class="kpis" style="margin-top:16px">
      ${kpi('Раздач', fmtNum(hs.length, 0), `${fmtDateTime(hs[0].date).slice(11)} — ${fmtDateTime(hs[hs.length - 1].date).slice(11)}`)}
      ${kpi('VPIP / PFR', `${fmtNum(pct(a.vpip, a.n), 0)} / ${fmtNum(pct(a.pfr, a.n), 0)}`)}
      ${kpi('Выиграно', signed(sum(hs, (h) => h.netBB), 1) + ' bb', `${signed(sum(hs, (h) => h.net), 0)} фишек`, cls(sum(hs, (h) => h.net)))}
    </div>`;
    if (hs.some((h) => h.heroStack != null)) html += `<h3>Стек по раздачам</h3><div class="chart" id="ch-stack"></div>`;
    const big = [...hs].sort((p, q) => Math.abs(q.net) - Math.abs(p.net)).slice(0, 10);
    html += `<h3 style="margin-top:16px">Крупнейшие раздачи</h3><div class="table-wrap"><table><thead><tr><th>Время</th><th class="l">Позиция</th><th class="l">Карты</th><th>Блайнды</th><th>bb</th><th>Фишки</th></tr></thead><tbody>
      ${big.map((h) => `<tr class="click" data-hand="${esc(h.id)}"><td>${fmtDateTime(h.date).slice(11)}</td><td class="l">${esc(h.heroPos || '')}</td><td class="l">${cardsHTML(h.heroCards)}</td>
        <td>${fmtNum(h.sb, 0)}/${fmtNum(h.bb, 0)}</td><td class="${cls(h.netBB)}">${signed(h.netBB, 1)}</td><td class="${cls(h.net)}"><b>${signed(h.net, 0)}</b></td></tr>`).join('')}
    </tbody></table></div>`;
  } else if (s.tid) {
    html += `<p class="help muted">Раздач этого турнира нет. Загрузи историю раздач — появятся график стека и статистика.</p>`;
  }
  const m = openModal(esc(x.name), html, true);
  $$('[data-hand]', m).forEach((r) => r.addEventListener('click', () => openHand(r.dataset.hand)));
  const el = $('#ch-stack', m);
  if (el) {
    const st = hs.filter((h) => h.heroStack != null);
    const values = [...st.map((h) => h.heroStack), Math.max(0, st[st.length - 1].heroStack + st[st.length - 1].net)];
    lineChart(el, {
      height: 220,
      series: [{ name: 'Стек', color: 'var(--s1)', values }],
      xLabel: (i) => (i < st.length ? `Раздача ${i + 1} · блайнды ${fmtNum(st[i].sb, 0)}/${fmtNum(st[i].bb, 0)}` : 'После последней раздачи'),
      yFmt: (v) => fmtNum(v, 0) + ' фиш.',
    });
  }
}

// ───────────────────────── Оппоненты ─────────────────────────
function playerType(v, p, n) {
  if (n < 30) return 'мало раздач';
  if (v >= 45 && p >= 30) return 'Маньяк';
  if (v >= 35 && p < v * 0.45) return 'Фиш';
  if (v >= 28 && p < v * 0.6) return 'Лузово-пассивный';
  if (v >= 25 && p >= 18) return 'LAG';
  if (v < 14) return 'Нит';
  if (v >= 15 && p >= 11 && v - p <= 8) return 'TAG / рег';
  return 'Рег';
}
let oppCache = null;
function opponents() {
  const f = state.f.opp;
  const key = state.hands.length + '|' + f.type;
  if (oppCache && oppCache.key === key) return oppCache.rows;
  const heroes = new Set(state.hands.map((h) => h.hero).filter(Boolean));
  const map = new Map();
  for (const h of state.hands) {
    if (f.type !== 'all' && (f.type === 'cash') !== !h.tourney) continue;
    for (const name in h.players) {
      if (heroes.has(name)) continue;
      let r = map.get(name);
      if (!r) { r = { name, list: [], bb: 0, sites: new Set() }; map.set(name, r); }
      r.list.push(h.players[name]); r.bb += h.players[name].net / h.bb; r.sites.add(h.site);
    }
  }
  const rows = [...map.values()].map((r) => {
    const a = agg(r.list);
    const v = pct(a.vpip, a.n), p = pct(a.pfr, a.n);
    return { name: r.name, site: [...r.sites].join(', '), n: a.n, vpip: v, pfr: p, t3b: pct(a.d3b, a.o3b), f3b: pct(a.f3b, a.of3b), cb: pct(a.cb, a.ocb), af: af(a), wtsd: pct(a.sd, a.sf), wsd: pct(a.wsd, a.sd), bb100: (r.bb / a.n) * 100, type: playerType(v, p, a.n) };
  });
  oppCache = { key, rows };
  return rows;
}
function viewOpponents() {
  const f = state.f.opp;
  if (!state.hands.length) return `<div class="card empty">Сначала загрузи историю раздач во вкладке «Анализ раздач» — тут появится статистика по каждому сопернику.</div>`;
  const q = f.q.trim().toLowerCase();
  const all = opponents();
  const rows = all.filter((r) => r.n >= f.min && (!q || r.name.toLowerCase().includes(q)));
  const val = (r) => { const v = r[f.sort]; return v == null ? -Infinity : v; };
  rows.sort((a, b) => (f.sort === 'name' || f.sort === 'type' ? String(a[f.sort]).localeCompare(String(b[f.sort])) : val(a) - val(b)) * f.dir);
  const th = (k, l, c = '') => `<th class="sortable ${c}" data-sort="${k}">${l}${f.sort === k ? (f.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const p = (v) => (v == null ? '<span class="muted">—</span>' : fmtNum(v, 0));
  return `<div class="filters" data-scope="opp">
      ${sel('type', 'Тип игр', [['all', 'Всё'], ['cash', 'Кэш'], ['tour', 'Турниры']], f.type)}
      <label>Мин. раздач<input type="number" min="1" data-f="min" value="${f.min}" style="width:90px"></label>
      <label>Поиск по нику<input data-f="q" value="${esc(f.q)}" placeholder="ник…" style="width:180px"></label>
    </div>
    <div class="card"><div class="card-head"><h2>Оппоненты <span class="muted small">${rows.length} из ${all.length}</span></h2>
    <span class="small muted">Значения в %, кроме AF. Чем больше раздач, тем точнее.</span></div>
    ${rows.length ? `<div class="table-wrap" style="max-height:70vh"><table><thead><tr>
      ${th('name', 'Ник')}${th('type', 'Тип', 'l')}${th('n', 'Раздач')}${th('vpip', 'VPIP')}${th('pfr', 'PFR')}${th('t3b', '3-бет')}${th('f3b', 'Фолд 3б')}${th('cb', 'Контбет')}${th('af', 'AF')}${th('wtsd', 'WTSD')}${th('wsd', 'W$SD')}${th('bb100', 'Его bb/100')}
    </tr></thead><tbody>${rows.slice(0, 500).map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="muted small">${esc(r.site)}</span></td><td class="l"><span class="tag">${esc(r.type)}</span></td>
      <td>${fmtNum(r.n, 0)}</td><td>${p(r.vpip)}</td><td>${p(r.pfr)}</td><td>${p(r.t3b)}</td><td>${p(r.f3b)}</td><td>${p(r.cb)}</td><td>${fmtAF(r.af)}</td><td>${p(r.wtsd)}</td><td>${p(r.wsd)}</td>
      <td class="${cls(r.bb100)}">${signed(r.bb100, 1)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Нет игроков с ${f.min}+ раздачами. Уменьши «Мин. раздач».</div>`}
    </div>
    <div class="card"><h2>Как читать типы</h2><ul class="help">
      <li><b>Фиш</b> — играет очень много рук и редко рейзит. Против него — вэлью-ставки, меньше блефов.</li>
      <li><b>Лузово-пассивный</b> — много коллирует. Не блефуй, ставь крупно с сильными руками.</li>
      <li><b>Нит</b> — играет только сильные руки. Чаще воруй его блайнды, уважай его рейзы.</li>
      <li><b>TAG / рег</b> — тайтово-агрессивный, обычно грамотный игрок. <b>LAG</b> — то же, но шире и агрессивнее. <b>Маньяк</b> — рейзит почти всё.</li>
    </ul></div>`;
}
function afterOpponents() { bindSort('opp'); }

// ───────────────────────── Настройки ─────────────────────────
function viewSettings() {
  const st = state.settings;
  return `<div class="grid2"><div class="card"><h2>Банкролл</h2>
    <form id="set-form" class="form-grid">
      <label>Стартовый банкролл<input name="start" inputmode="decimal" value="${esc(st.startBankroll || '')}" placeholder="0"></label>
      <label>Валюта<select name="cur">${options([['$', '$ доллар'], ['€', '€ евро'], ['₽', '₽ рубль'], ['£', '£ фунт'], ['', 'без знака']], st.currency)}</select></label>
      <div class="wide"><button class="btn primary" type="submit">Сохранить</button></div>
    </form></div>
    <div class="card"><h2>Данные</h2>
      <p class="help">Сессий: <b>${state.sessions.length}</b> · раздач: <b>${fmtNum(state.hands.length, 0)}</b>.<br>
      Всё хранится в файле на компьютере: <code id="db-path">…</code></p>
      <p class="help small" id="db-backups"></p>
      <div class="btn-row">
        <button class="btn primary" id="open-dir">Открыть папку с данными</button>
        <button class="btn" id="backup-now">Сделать копию сейчас</button>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" id="exp">Скачать копию в JSON</button>
        <label class="btn">Загрузить из JSON-копии<input type="file" id="imp" accept=".json,application/json" hidden></label>
        <button class="btn" id="exp-csv">Сессии в CSV (Excel)</button>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn danger" id="clr-s">Удалить все сессии</button>
        <button class="btn danger" id="clr-h">Удалить все раздачи</button>
      </div>
    </div></div>`;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function showDbInfo() {
  const i = await api('GET', 'info');
  const p = $('#db-path'); if (!p) return;
  p.textContent = i.dbPath;
  $('#db-backups').textContent = `Размер: ${i.size < 1048576 ? fmtNum(i.size / 1024, 0) + ' КБ' : fmtNum(i.size / 1048576, 1) + ' МБ'}. Резервные копии делаются сами раз в день при запуске (хранятся последние 14, в папке backups)`
    + (i.lastBackup ? `; последняя — ${fmtDate(i.lastBackup)}.` : '.');
}
function afterSettings() {
  showDbInfo();
  $('#open-dir').addEventListener('click', () => api('POST', 'open-folder'));
  $('#backup-now').addEventListener('click', async () => {
    const r = await api('POST', 'backup');
    toast(r.file ? 'Копия сохранена: ' + r.file : 'Пока нечего сохранять — данных нет');
    showDbInfo();
  });
  $('#set-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.settings.startBankroll = toNum(fd.get('start')) || 0;
    state.settings.currency = fd.get('cur');
    await DB.put('meta', state.settings, 'settings');
    toast('Настройки сохранены');
  });
  $('#exp').addEventListener('click', async () => {
    const raw = await DB.all('raw');
    const data = { app: 'poker-tracker', version: 1, exported: new Date().toISOString(), settings: state.settings, sessions: state.sessions, hands: state.hands, raw };
    download(`poker-tracker-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  });
  $('#exp-csv').addEventListener('click', () => {
    const head = ['Дата', 'Рум', 'Формат', 'Игра', 'Лимит', 'BB', 'Вход', 'Выход', 'Профит', 'Минут', 'Раздач', 'Столов', 'Место', 'Заметки'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v) => (v == null ? '' : String(v).replace('.', ','));
    const lines = state.sessions.map((s) => [s.date, q(s.site), FORMATS[s.format], s.game, q(s.stakes), n(s.bb), n(s.buyin), n(s.cashout), n(+profitOf(s).toFixed(2)), s.minutes, s.hands ?? '', s.tables ?? '', q(s.place), q(s.notes)].join(';'));
    download(`poker-sessions-${todayISO()}.csv`, '﻿' + [head.join(';'), ...lines].join('\r\n'), 'text/csv');
  });
  $('#imp').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'poker-tracker') throw new Error('не тот файл');
      if (d.settings) { state.settings = { ...state.settings, ...d.settings }; await DB.put('meta', state.settings, 'settings'); }
      await DB.putMany('sessions', d.sessions || []);
      await DB.putMany('hands', d.hands || []);
      await DB.putMany('raw', d.raw || []);
      await loadData();
      toast(`Восстановлено: ${(d.sessions || []).length} сессий, ${(d.hands || []).length} раздач`);
      render();
    } catch (err) { toast('Не удалось прочитать файл копии: ' + err.message); }
  });
  $('#clr-s').addEventListener('click', async () => {
    if (!confirm(`Удалить все ${state.sessions.length} сессий? Это нельзя отменить (если нет резервной копии).`)) return;
    await DB.clear('sessions'); state.sessions = []; render();
  });
  $('#clr-h').addEventListener('click', async () => {
    if (!confirm(`Удалить все ${state.hands.length} раздач? Файлы истории можно будет загрузить заново.`)) return;
    await DB.clear('hands'); await DB.clear('raw'); state.hands = []; oppCache = null; tHandsCache = null; render();
  });
}

// ───────────────────────── роутер ─────────────────────────
const VIEWS = {
  overview: [viewOverview, afterOverview],
  sessions: [viewSessions, afterSessions],
  tourneys: [viewTourneys, afterTourneys],
  hands: [viewHands, afterHands],
  opponents: [viewOpponents, afterOpponents],
  settings: [viewSettings, afterSettings],
};
function render() {
  hideTip();
  charts.length = 0;
  if (!VIEWS[state.tab]) state.tab = 'overview';
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const [view, after] = VIEWS[state.tab];
  const y = window.scrollY;
  $('#view').innerHTML = view();
  after();
  // фильтры
  $$('.filters[data-scope]').forEach((box) => {
    const scope = box.dataset.scope;
    $$('[data-f]', box).forEach((inp) => {
      const ev = inp.tagName === 'INPUT' ? 'input' : 'change';
      let t;
      inp.addEventListener(ev, () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const k = inp.dataset.f;
          state.f[scope][k] = inp.type === 'number' ? Math.max(1, +inp.value || 1) : inp.value;
          saveUI(); render();
          const again = $(`.filters[data-scope="${scope}"] [data-f="${k}"]`);
          if (again && inp.tagName === 'INPUT') { again.focus(); const L = again.value.length; if (again.type !== 'number') again.setSelectionRange(L, L); }
        }, inp.tagName === 'INPUT' ? 250 : 0);
      });
    });
  });
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.go; saveUI(); render(); window.scrollTo(0, 0); }));
  window.scrollTo(0, y);
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab; state.editing = null; state.prefill = null; saveUI(); render(); window.scrollTo(0, 0);
});

async function loadData() {
  const [sessions, hands, settings, timer] = await Promise.all([DB.all('sessions'), DB.all('hands'), DB.get('meta', 'settings'), DB.get('meta', 'timer')]);
  state.sessions = sessions || [];
  state.hands = hands || [];
  if (settings) state.settings = { ...state.settings, ...settings };
  state.timer = timer || null;
  oppCache = null; tHandsCache = null;
  sortSessions(); sortHands();
}
async function showLaunchHelp(err) {
  $('#tabs').classList.add('hidden');
  const fromFile = location.protocol === 'file:';
  $('#view').innerHTML = `<div class="card"><h2>${fromFile ? 'Запусти трекер через «Запустить трекер.bat»' : 'Нет связи с программой'}</h2>
    <p class="help">${fromFile
      ? 'Эта версия хранит данные в файле на компьютере, поэтому открывать её нужно не напрямую, а двойным кликом по файлу <b>«Запустить трекер.bat»</b> в папке программы. Он сам откроет трекер в браузере.'
      : `Окно «Запустить трекер.bat» закрыто или программа остановилась (${esc(err?.message || '')}). Запусти его снова и обнови эту страницу.`}</p>
    <div id="migrate"></div></div>`;
  if (!fromFile) return;
  // перенос из старой браузерной версии: её данные доступны только при открытии файла напрямую
  const old = await readBrowserData();
  if (!old || (!old.sessions?.length && !old.hands?.length)) return;
  $('#migrate').innerHTML = `<p class="help">В браузере нашлись данные старой версии: <b>${old.sessions.length}</b> сессий и <b>${fmtNum(old.hands?.length || 0, 0)}</b> раздач.
    Скачай их в файл, затем в запущенном трекере открой «Настройки» → «Загрузить из JSON-копии».</p>
    <button class="btn primary" id="mig-btn">Скачать данные из браузера</button>`;
  $('#mig-btn').addEventListener('click', () => {
    const data = { app: 'poker-tracker', version: 1, exported: new Date().toISOString(), settings: old.meta || undefined, sessions: old.sessions || [], hands: old.hands || [], raw: old.raw || [] };
    download(`poker-tracker-из-браузера-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  });
}
(async function init() {
  loadUI();
  if (location.protocol === 'file:') return showLaunchHelp();
  try {
    await DB.open();
    await loadData();
  } catch (e) {
    return showLaunchHelp(e);
  }
  render();
})();
