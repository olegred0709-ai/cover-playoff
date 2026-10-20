// Плей-офф обложек: пары → победители проходят дальше → одна обложка.
// Результат уходит POST-запросом в Google Apps Script, который пишет строки в таблицу.

// URL веб-приложения Apps Script (Развертывание → Веб-приложение → URL, заканчивается на /exec)
const SCRIPT_URL = '';

const STORE_KEY = 'cover-playoff-v1';
const COOKIE_KEY = 'cp_done';

const covers = window.COVERS;
const byId = Object.fromEntries(covers.map(c => [c.id, c]));
const $ = sel => document.querySelector(sel);

// ---------- хранилище ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
function markDoneCookie() {
  document.cookie = `${COOKIE_KEY}=1; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
}
function hasDoneCookie() {
  return document.cookie.split('; ').some(c => c.startsWith(COOKIE_KEY + '='));
}

// ---------- сетка ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Если участников не степень двойки — отборочный раунд, остальные проходят без игры.
function buildRound(entrants) {
  const n = entrants.length;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  const playing = n === p ? n : 2 * (n - p);
  const pairs = [];
  for (let i = 0; i < playing; i += 2) pairs.push([entrants[i], entrants[i + 1]]);
  return { pairs, byes: entrants.slice(playing), name: roundName(n, playing) };
}

function roundName(n, playing) {
  if (playing !== n) return 'Отборочный раунд';
  return { 2: 'Финал', 4: 'Полуфинал', 8: '1/4 финала', 16: '1/8 финала', 32: '1/16 финала', 64: '1/32 финала' }[n] || 'Раунд';
}

function newState(name) {
  return {
    deviceId: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2),
    name,
    startedAt: new Date().toISOString(),
    round: buildRound(shuffle(covers.map(c => c.id))),
    pos: 0,
    winners: [],
    matches: [],
    history: [],
    champion: null,
    finishedAt: null,
    sent: false,
  };
}

let state = load();

// ---------- экраны ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function renderDuel() {
  const { round, pos } = state;
  const pair = round.pairs[pos];
  const total = covers.length - 1;
  const done = state.matches.length;

  $('#round-name').textContent = round.name;
  $('#counter').textContent = `Пара ${done + 1} из ${total}`;
  $('#progress-bar').style.width = `${(done / total) * 100}%`;
  $('#undo').disabled = state.history.length === 0;

  document.querySelectorAll('.card').forEach((card, i) => {
    const c = byId[pair[i]];
    card.classList.remove('won', 'lost');
    card.dataset.id = c.id;
    card.querySelector('img').src = c.img;
    card.querySelector('img').alt = c.title;
    card.querySelector('.title').textContent = c.title;
  });
  $('#duel').classList.remove('busy');
  preloadNext();
}

function preloadNext() {
  const next = state.round.pairs[state.pos + 1];
  if (next) next.forEach(id => { new Image().src = byId[id].img; });
}

function choose(side) {
  if (state.champion) return;
  const pair = state.round.pairs[state.pos];
  const winner = pair[side];
  const loser = pair[1 - side];

  const duel = $('#duel');
  duel.classList.add('busy');
  $('#undo').disabled = true;
  duel.querySelectorAll('.card').forEach((card, i) => card.classList.add(i === side ? 'won' : 'lost'));

  // снимок для «Назад» (без самой истории, чтобы не раздувать хранилище)
  const { history, ...snap } = state;
  state.history.push(JSON.stringify(snap));

  state.matches.push({ round: state.round.name, winner, loser });
  state.winners.push(winner);
  state.pos++;

  if (state.pos === state.round.pairs.length) {
    const next = state.round.byes.concat(state.winners);
    if (next.length === 1) {
      state.champion = next[0];
      state.finishedAt = new Date().toISOString();
      state.history = [];
    } else {
      state.round = buildRound(shuffle(next));
      state.pos = 0;
      state.winners = [];
    }
  }
  save();

  setTimeout(() => {
    if (state.champion) finish();
    else renderDuel();
  }, 320);
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  state = { ...JSON.parse(prev), history: state.history };
  save();
  renderDuel();
}

// ---------- итог и отправка ----------
function lossesIn(roundName) {
  return state.matches.filter(m => m.round === roundName).map(m => byId[m.loser].title);
}

function renderResult() {
  const c = byId[state.champion];
  $('#result-title').textContent = c.title;
  $('#result-img').src = c.img;
  $('#result-img').alt = c.title;
  const finalist = lossesIn('Финал')[0];
  $('#result-runnerup').textContent = finalist ? `В финале обошла: ${finalist}` : '';
  show('screen-result');
}

function payload() {
  const title = id => byId[id].title;
  return {
    voteId: state.deviceId,
    name: state.name || '',
    champion: title(state.champion),
    finalist: lossesIn('Финал')[0] || '',
    semifinalists: lossesIn('Полуфинал').join(', '),
    matches: state.matches.map(m => ({ round: m.round, winner: title(m.winner), loser: title(m.loser) })),
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    durationSec: Math.round((Date.parse(state.finishedAt) - Date.parse(state.startedAt)) / 1000),
    userAgent: navigator.userAgent,
  };
}

function setStatus(text, kind) {
  const el = $('#send-status');
  el.textContent = text;
  el.className = 'send-status ' + (kind || '');
}

async function send() {
  $('#retry').hidden = true;
  if (!SCRIPT_URL) {
    setStatus('Отправка ещё не настроена (нет адреса таблицы)', 'err');
    return;
  }
  setStatus('Отправляем голос…');
  try {
    // text/plain + no-cors: Apps Script не отвечает на preflight, поэтому «простой» запрос
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload()),
    });
    state.sent = true;
    save();
    setStatus('Голос учтён ✓ Спасибо!', 'ok');
  } catch {
    setStatus('Не получилось отправить — проверь интернет', 'err');
    $('#retry').hidden = false;
  }
}

function finish() {
  markDoneCookie();
  renderResult();
  send();
}

// ---------- лайтбокс ----------
function openLightbox(id) {
  const c = byId[id];
  const lb = $('#lightbox');
  lb.querySelector('img').src = c.img;
  lb.querySelector('.lb-title').textContent = c.title;
  lb.showModal();
}

// ---------- запуск ----------
function init() {
  $('#fact-count').textContent = covers.length;
  $('#fact-matches').textContent = covers.length - 1;

  $('#start').addEventListener('click', () => {
    state = newState($('#name').value.trim());
    save();
    show('screen-duel');
    renderDuel();
  });
  document.querySelectorAll('.card').forEach((card, i) => {
    card.querySelector('.pick').addEventListener('click', () => choose(i));
    card.querySelector('.zoom').addEventListener('click', () => openLightbox(Number(card.dataset.id)));
  });
  $('#undo').addEventListener('click', undo);
  $('#retry').addEventListener('click', send);
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') e.target.close(); });

  document.addEventListener('keydown', e => {
    if ($('#screen-duel').hidden || $('#lightbox').open || $('#duel').classList.contains('busy')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') choose(0);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') choose(1);
    else if (e.key === 'Backspace') undo();
  });

  if (state && state.champion) {
    // уже прошёл: показываем его выбор, дотправляем, если не ушло
    renderResult();
    $('#result-eyebrow').textContent = 'Ты уже голосовал(а) · твой выбор';
    if (state.sent) setStatus('Голос учтён ✓ Пройти ещё раз нельзя', 'ok');
    else send();
  } else if (state && state.round) {
    show('screen-duel');
    renderDuel();
  } else if (hasDoneCookie()) {
    show('screen-result');
    $('#result-eyebrow').textContent = 'Ты уже голосовал(а)';
    $('#result-title').textContent = 'Пройти можно только один раз';
    $('#result-img').hidden = true;
  } else {
    show('screen-intro');
  }
}

init();
