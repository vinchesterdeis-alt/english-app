'use strict';

// ================= Сохранение прогресса =================
const STORE_KEY = 'duyuspik-v1';
const DAILY_GOAL = 50;                       // XP в день
const INTERVALS = [0, 1, 2, 4, 8, 16, 32];   // дней до следующего показа карточки по «коробкам»

function freshState() {
  return { xp: 0, today: { date: null, xp: 0 }, streak: { last: null, count: 0 },
    cards: {}, mistakes: {}, lessons: {}, games: {}, sound: true, autoSpeak: true, slow: false };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) return { ...freshState(), ...s };
  } catch (e) {}
  return freshState();
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

let state = loadState();

// ================= Помощники =================
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Создаёт элемент страницы: el('div', {class: 'x', onclick: f}, 'текст', другойЭлемент)
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) e.append(c.nodeType ? c : String(c));
  }
  return e;
}

// Текст с **жирным** → элемент
function rich(text, tag = 'p') {
  return el(tag, {}, text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? el('b', {}, part) : part)));
}

let timers = [];
function later(fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; }
function every(fn, ms) { const id = setInterval(fn, ms); timers.push(id); return id; }
function stopTimers() {
  timers.forEach(id => { clearTimeout(id); clearInterval(id); });
  timers = [];
}

function flash(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  later(() => node.classList.remove(cls), 350);
}

function buzz(ms = 60) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// ================= Звуки эффектов =================
let audio = null;
function tone(freq, start = 0, dur = 0.15, vol = 0.05, type = 'sine') {
  if (!state.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + start;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch (e) {}
}
const sfx = {
  right: () => { tone(660, 0, 0.1); tone(880, 0.07, 0.12); },
  wrong: () => tone(170, 0, 0.25, 0.07, 'triangle'),
  tap: () => tone(520, 0, 0.06, 0.03),
  finish: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.35)),
  rankup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.5, 0.07)),
};

// ================= Озвучка (встроенный синтез речи Android) =================
let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => /en[-_]GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/…/g, ''));
    u.lang = voice ? voice.lang : 'en-GB';
    if (voice) u.voice = voice;
    u.rate = state.slow ? 0.7 : 0.95;
    speechSynthesis.speak(u);
  } catch (e) {}
}

function sayButton(text, cls = 'say-btn') {
  return el('button', { class: cls, 'aria-label': 'Послушать', onclick: e => { e.stopPropagation(); speak(text); } }, '🔊');
}

// ================= Слова =================
const ALL_WORDS = THEMES.flatMap(t => WORDS[t.id].map(([en, ru, note, example]) =>
  ({ id: `${t.id}:${en}`, theme: t.id, en, ru, note: note || '', example: example || '' })));
const WORD_BY_ID = Object.fromEntries(ALL_WORDS.map(w => [w.id, w]));
const themeById = id => THEMES.find(t => t.id === id);

function explainWord(w) {
  const parts = [`«${w.en}» — это «${w.ru}».`];
  if (w.note) parts.push(w.note);
  if (w.example) parts.push('Пример: ' + w.example);
  return parts.join(' ');
}

// ================= Опыт, звания, серия дней =================
function rankIndex(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  return i;
}

function todayXP() {
  return state.today.date === dayKey() ? state.today.xp : 0;
}

function currentStreak() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return [dayKey(), dayKey(y)].includes(state.streak.last) ? state.streak.count : 0;
}

// Начислить опыт; вернуть новое звание, если оно получено
function addXP(n) {
  if (n <= 0) return null;
  const before = rankIndex(state.xp);
  state.xp += n;
  if (state.today.date !== dayKey()) state.today = { date: dayKey(), xp: 0 };
  state.today.xp += n;
  if (state.streak.last !== dayKey()) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    state.streak.count = state.streak.last === dayKey(y) ? state.streak.count + 1 : 1;
    state.streak.last = dayKey();
  }
  saveState();
  const after = rankIndex(state.xp);
  return after > before ? RANKS[after] : null;
}

// ================= Ошибки =================
function markMistake(key, wrong) {
  if (!key) return;
  if (wrong) {
    state.mistakes[key] = (state.mistakes[key] || 0) + 1;
  } else if (state.mistakes[key]) {
    state.mistakes[key] -= 1;            // ответил верно — ошибка «заживает»
    if (state.mistakes[key] <= 0) delete state.mistakes[key];
  }
  saveState();
}

// ================= Вопросы для теста =================
function wordQuestion(w) {
  const sameTheme = ALL_WORDS.filter(x => x.theme === w.theme && x.en !== w.en && x.ru !== w.ru);
  const pool = sameTheme.length >= 3 ? sameTheme : ALL_WORDS.filter(x => x.en !== w.en && x.ru !== w.ru);
  const others = shuffle(pool).slice(0, 3);
  const isPhrase = /[ .!?]/.test(w.en.trim());
  if (Math.random() < 0.6) {
    // sayFirst: озвучку можно включить ещё до ответа — она не подсказывает
    return { q: isPhrase ? `Что значит «${w.en}»?` : `Как переводится «${w.en}»?`, say: w.en, sayFirst: true,
      options: shuffle([w.ru, ...others.map(o => o.ru)]), answer: w.ru, explain: explainWord(w), key: 'w:' + w.id };
  }
  return { q: `Как по-английски «${w.ru}»?`, say: w.en,
    options: shuffle([w.en, ...others.map(o => o.en)]), answer: w.en, explain: explainWord(w), key: 'w:' + w.id };
}

function grammarQuestion(lessonId, i) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  const [q, options, answer, explain] = lesson.questions[i];
  return { q, options: shuffle(options), answer, explain, key: `g:${lessonId}:${i}`,
    say: q.includes('___') ? q.replace('___', answer) : answer };
}

function questionFromKey(key) {
  const [type, a, b] = key.split(':');
  if (type === 'w') {
    const w = WORD_BY_ID[key.slice(2)];
    return w ? wordQuestion(w) : null;
  }
  if (type === 'g' && LESSONS.some(l => l.id === a)) return grammarQuestion(a, +b);
  return null;
}

function mixedTest(themeId) {
  const words = themeId ? ALL_WORDS.filter(w => w.theme === themeId) : ALL_WORDS;
  const qs = shuffle(words).slice(0, themeId ? 10 : 7).map(wordQuestion);
  if (!themeId) {
    const g = shuffle(LESSONS.flatMap(l => l.questions.map((_, i) => [l.id, i]))).slice(0, 3);
    qs.push(...g.map(([id, i]) => grammarQuestion(id, i)));
  }
  return shuffle(qs);
}

// ================= Экраны: общее =================
const app = document.getElementById('app');

function show(...nodes) {
  stopTimers();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  app.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo(0, 0);
}

function topbar(title, back, right) {
  return el('header', { class: 'topbar' },
    el('button', { class: 'icon-btn', onclick: () => back(), 'aria-label': 'Назад' }, '←'),
    el('div', { class: 'topbar-title' }, title),
    right || el('div', { style: 'width:40px' }));
}

function rankCard() {
  const i = rankIndex(state.xp), r = RANKS[i], next = RANKS[i + 1];
  const pct = next ? (state.xp - r.xp) / (next.xp - r.xp) * 100 : 100;
  return el('button', { class: 'rank-card', onclick: renderRanks },
    el('div', { class: 'rank-icon' }, r.icon),
    el('div', { class: 'rank-info' },
      el('div', { class: 'rank-level' }, `Звание ${i + 1} из ${RANKS.length}`),
      el('div', { class: 'rank-name' }, r.name),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${pct}%` })),
      el('div', { class: 'small muted' }, next ? `${state.xp} / ${next.xp} XP до «${next.name}»` : `${state.xp} XP — вершина!`)));
}

function dueCards(themeId) {
  const now = Date.now();
  return ALL_WORDS.filter(w => (!themeId || w.theme === themeId) && state.cards[w.id] && state.cards[w.id].due <= now);
}

function newCards(themeId) {
  return ALL_WORDS.filter(w => (!themeId || w.theme === themeId) && !state.cards[w.id]);
}

// ================= Главный экран =================
function renderHome() {
  const goal = Math.min(100, todayXP() / DAILY_GOAL * 100);
  const due = dueCards().length;
  const mistakes = Object.keys(state.mistakes).length;
  const tile = (icon, name, sub, onclick, color) =>
    el('button', { class: 'tile', style: `background:${color}`, onclick },
      el('div', { class: 'tile-icon' }, icon), el('div', { class: 'tile-name' }, name), el('div', { class: 'tile-sub' }, sub));
  show(
    el('header', { class: 'home-head' },
      el('h1', {}, 'Ду Ю Спик?'),
      el('div', { class: 'head-right' },
        el('div', { class: 'pill', title: 'Дней подряд' }, '🔥 ' + currentStreak()),
        el('button', { class: 'icon-btn', onclick: renderSettings, 'aria-label': 'Настройки' }, '⚙️'))),
    rankCard(),
    el('div', { class: 'goal' },
      el('div', { class: 'goal-row' }, el('b', {}, '🎯 Цель дня'), el('span', {}, `${todayXP()} / ${DAILY_GOAL} XP`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill goal-fill', style: `width:${goal}%` }))),
    el('div', { class: 'tiles' },
      tile('📝', 'Тест', '10 вопросов с объяснениями', () => runQuiz('📝 Тест', mixedTest(), renderHome), '#ece6ff'),
      tile('🃏', 'Карточки', due ? `${due} ждут повторения` : 'учить новые слова', () => startCards(null, renderHome), '#ffe1ec'),
      tile('📚', 'Грамматика', `${LESSONS.length} уроков простыми словами`, renderLessons, '#dff3ff'),
      tile('🎮', 'Игры', '3 игры', renderGames, '#e2f7e8'),
      tile('🗂', 'Темы', 'сериалы, игры, спорт…', renderThemes, '#fff1d6'),
      tile('❌', 'Мои ошибки', mistakes ? `${mistakes} на проработку` : 'пока пусто', renderMistakes, '#fde4dc')));
}

// ================= Тест =================
function runQuiz(title, questions, back, onFinish) {
  let i = 0, right = 0;
  const wrongList = [];
  const counter = el('div', { class: 'muted small' });
  const box = el('div');

  function next() {
    if (i >= questions.length) return finish();
    const q = questions[i];
    counter.textContent = `Вопрос ${i + 1} из ${questions.length} · верно ${right}`;
    const explain = el('div', { class: 'explain', hidden: '' });
    const opts = q.options.map(o => el('button', { class: 'option', onclick: () => answer(o) }, o));
    box.replaceChildren(
      el('div', { class: 'question' }, q.q, q.sayFirst ? sayButton(q.say) : null),
      el('div', { class: 'options' }, opts),
      explain);

    function answer(o) {
      const ok = o === q.answer;
      opts.forEach(b => {
        b.disabled = true;
        if (b.textContent === q.answer) b.classList.add('right');
        else if (b.textContent === o) b.classList.add('wrong');
      });
      if (ok) { right++; sfx.right(); } else { sfx.wrong(); buzz(); wrongList.push(q); }
      markMistake(q.key, !ok);
      explain.hidden = false;
      explain.replaceChildren(
        el('div', { class: 'explain-head' }, ok ? '✅ Верно!' : `❌ Правильно: ${q.answer}`),
        el('p', {}, q.explain),
        el('div', { class: 'row' },
          q.say ? el('button', { class: 'btn', onclick: () => speak(q.say) }, '🔊 Послушать') : null,
          el('button', { class: 'btn primary', onclick: () => { i++; next(); } }, i + 1 < questions.length ? 'Дальше →' : 'Итог')));
      if (state.autoSpeak && q.say) speak(q.say);
      explain.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function finish() {
    const rank = addXP(right * 5);
    if (onFinish) onFinish(right, questions.length);
    renderResult({
      title, xp: right * 5, rank,
      summary: `Верно ${right} из ${questions.length}.` + (wrongList.length ? ' Ошибки попали в «Мои ошибки» — их можно прогнать отдельно.' : ' Без единой ошибки! 🔥'),
      again: () => runQuiz(title, questions.map(q => ({ ...q, options: shuffle(q.options) })), back, onFinish),
      back,
    });
  }

  show(topbar(title, back), counter, box);
  next();
}

function renderResult({ title, xp, rank, summary, again, back }) {
  if (rank) { sfx.rankup(); buzz([80, 60, 80]); } else sfx.finish();
  show(
    topbar(title, back),
    el('div', { class: 'result' },
      rank ? el('div', { class: 'rankup' },
        el('div', { class: 'rankup-icon' }, rank.icon),
        el('div', {}, 'Новое звание!'),
        el('div', { class: 'rank-name' }, rank.name),
        el('div', {}, rank.quote)) : null,
      el('div', { class: 'result-xp' }, `+${xp} XP`),
      el('p', {}, summary),
      rankCard(),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: renderHome }, 'На главную'),
        again ? el('button', { class: 'btn primary', onclick: again }, 'Ещё раз') : null)));
}

// ================= Карточки (умное повторение) =================
function startCards(themeId, back) {
  const queue = [...shuffle(dueCards(themeId)).slice(0, 20), ...shuffle(newCards(themeId)).slice(0, 10)];
  if (!queue.length) {
    show(topbar('🃏 Карточки', back),
      el('div', { class: 'empty' }, el('div', { class: 'big-emoji' }, '🎉'),
        el('p', {}, 'На сегодня всё повторено, а новые слова в этой теме закончились.'),
        el('button', { class: 'btn primary', onclick: back }, 'Назад')));
    return;
  }
  let done = 0, again = new Set();
  const counter = el('div', { class: 'muted small' });
  const box = el('div');

  function next() {
    if (!queue.length) {
      const rank = addXP(done * 2);
      return renderResult({ title: '🃏 Карточки', xp: done * 2, rank, back,
        summary: `Пройдено карточек: ${done}. Слова вернутся к тебе, когда начнёшь их забывать.` });
    }
    const w = queue[0];
    const card = state.cards[w.id];
    counter.textContent = `Осталось: ${queue.length} · ${card ? 'повторение' : 'новое слово'}`;
    const back_ = el('div', { class: 'card-back', hidden: '' },
      el('div', { class: 'card-ru' }, w.ru),
      w.note ? el('p', { class: 'muted' }, w.note) : null,
      w.example ? el('p', { class: 'example' }, w.example) : null,
      el('div', { class: 'grade' },
        el('button', { class: 'btn bad', onclick: () => grade(0) }, '😵 Не помню'),
        el('button', { class: 'btn', onclick: () => grade(1) }, '🙂 Помню'),
        el('button', { class: 'btn good', onclick: () => grade(2) }, '😎 Легко')));
    const showBtn = el('button', { class: 'btn primary big', onclick: () => { back_.hidden = false; showBtn.hidden = true; } }, 'Показать перевод');
    box.replaceChildren(
      el('div', { class: 'flashcard', style: `background:${themeById(w.theme).color}` },
        el('div', { class: 'small muted' }, themeById(w.theme).icon + ' ' + themeById(w.theme).name),
        el('div', { class: 'card-en' }, w.en),
        sayButton(w.en, 'say-btn big-say'),
        back_),
      showBtn);
    if (state.autoSpeak) later(() => speak(w.en), 250);

    function grade(g) {
      sfx.tap();
      const c = state.cards[w.id] || { b: 0, due: 0 };
      queue.shift();
      if (g === 0) {
        c.b = 0;
        c.due = daysFromNow(0);
        if (!again.has(w.id)) { again.add(w.id); queue.push(w); }   // не помню — покажем ещё раз в конце
      } else {
        c.b = Math.min(INTERVALS.length - 1, c.b + g);
        c.due = daysFromNow(INTERVALS[c.b]);
      }
      state.cards[w.id] = c;
      saveState();
      done++;
      next();
    }
  }

  show(topbar('🃏 Карточки', back), counter, box);
  next();
}

// ================= Темы =================
function renderThemes() {
  show(topbar('🗂 Темы', renderHome),
    THEMES.map(t => {
      const words = ALL_WORDS.filter(w => w.theme === t.id);
      const learned = words.filter(w => (state.cards[w.id] || {}).b >= 3).length;
      return el('button', { class: 'theme-row', style: `background:${t.color}`, onclick: () => renderTheme(t.id) },
        el('div', { class: 'theme-icon' }, t.icon),
        el('div', { class: 'theme-info' },
          el('div', { class: 'tile-name' }, t.name),
          el('div', { class: 'small muted' }, `${words.length} слов · выучено ${learned}`)));
    }));
}

function renderTheme(id) {
  const t = themeById(id);
  const words = ALL_WORDS.filter(w => w.theme === id);
  show(topbar(t.icon + ' ' + t.name, renderThemes),
    el('p', { class: 'muted' }, t.hint),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => startCards(id, () => renderTheme(id)) }, '🃏 Карточки'),
      el('button', { class: 'btn primary', onclick: () => runQuiz(t.icon + ' Тест', mixedTest(id), () => renderTheme(id)) }, '📝 Тест')),
    el('div', { class: 'word-list' }, words.map(w => {
      const learned = (state.cards[w.id] || {}).b >= 3;
      return el('div', { class: 'word-row' },
        sayButton(w.en),
        el('div', { class: 'word-text' },
          el('div', { class: 'word-en' }, w.en, learned ? ' ✅' : ''),
          el('div', { class: 'small muted' }, w.ru)));
    })));
}

// ================= Грамматика =================
function renderLessons() {
  show(topbar('📚 Грамматика', renderHome),
    el('p', { class: 'muted' }, 'Каждый урок — один экран объяснений и 6 вопросов на закрепление.'),
    LESSONS.map(l => {
      const best = state.lessons[l.id];
      return el('button', { class: 'theme-row', onclick: () => renderLesson(l.id) },
        el('div', { class: 'theme-icon' }, l.icon),
        el('div', { class: 'theme-info' },
          el('div', { class: 'tile-name' }, l.name),
          el('div', { class: 'small muted' }, best != null ? `лучший результат: ${best} из ${l.questions.length}` : 'не пройден')));
    }));
}

function renderLesson(id) {
  const l = LESSONS.find(x => x.id === id);
  show(topbar(l.icon + ' Урок', renderLessons),
    el('h2', {}, l.name),
    el('div', { class: 'lesson' }, l.text.map(t => rich(t))),
    el('h3', {}, 'Примеры'),
    el('div', { class: 'word-list' }, l.examples.map(([en, ru]) =>
      el('div', { class: 'word-row' }, sayButton(en),
        el('div', { class: 'word-text' }, el('div', { class: 'word-en' }, en), el('div', { class: 'small muted' }, ru))))),
    el('button', { class: 'btn primary big', onclick: () =>
      runQuiz(l.icon + ' ' + l.name, l.questions.map((_, i) => grammarQuestion(l.id, i)), () => renderLesson(id),
        right => { state.lessons[id] = Math.max(state.lessons[id] || 0, right); saveState(); }) }, 'Проверить себя →'));
}

// ================= Мои ошибки =================
function renderMistakes() {
  const keys = Object.entries(state.mistakes).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const qs = keys.map(questionFromKey).filter(Boolean);
  if (!qs.length) {
    show(topbar('❌ Мои ошибки', renderHome),
      el('div', { class: 'empty' }, el('div', { class: 'big-emoji' }, '✨'),
        el('p', {}, 'Ошибок нет. Сюда попадают слова и правила, в которых ты ошибся в тестах.')));
    return;
  }
  show(topbar('❌ Мои ошибки', renderHome),
    el('p', { class: 'muted' }, `На проработку: ${qs.length}. Ответишь верно — ошибка уйдёт из списка.`),
    el('button', { class: 'btn primary big', onclick: () => runQuiz('❌ Работа над ошибками', qs.slice(0, 15), renderMistakes) }, 'Начать'),
    el('div', { class: 'word-list' }, keys.slice(0, 40).map(k => {
      const q = questionFromKey(k);
      return q ? el('div', { class: 'word-row' }, el('div', { class: 'word-text' },
        el('div', { class: 'word-en' }, q.say || q.q), el('div', { class: 'small muted' }, `ошибок: ${state.mistakes[k]}`))) : null;
    })));
}

// ================= Игры =================
const GAMES = [
  { id: 'pairs', icon: '🧩', name: 'Найди пару', start: gamePairs,
    rules: ['Слева английские слова, справа — переводы.', 'Нажми слово, потом его перевод.', '3 раунда по 6 пар. Чем быстрее и без ошибок — тем больше опыта.'] },
  { id: 'builder', icon: '🧱', name: 'Собери фразу', start: gameBuilder,
    rules: ['Показан перевод фразы и перемешанные английские слова.', 'Нажимай слова по порядку, чтобы собрать фразу.', 'Ошибся — нажми на слово в ответе, и оно вернётся.'] },
  { id: 'listen', icon: '👂', name: 'Угадай на слух', start: gameListen,
    rules: ['Телефон произносит слово или фразу — выбери, что прозвучало.', 'Можно переслушать кнопкой 🔊.', 'Нет звука? Включи английский голос: Настройки Android → Синтез речи (или «Озвучивание текста») → Google → установить «English».'] },
];

function renderGames() {
  show(topbar('🎮 Игры', renderHome),
    GAMES.map(g => el('button', { class: 'theme-row', onclick: () => renderGameIntro(g) },
      el('div', { class: 'theme-icon' }, g.icon),
      el('div', { class: 'theme-info' },
        el('div', { class: 'tile-name' }, g.name),
        el('div', { class: 'small muted' }, state.games[g.id] ? `рекорд: ${state.games[g.id]} XP` : 'новая')))));
}

function renderGameIntro(g) {
  show(topbar(g.name, renderGames),
    el('div', { class: 'intro' },
      el('div', { class: 'big-emoji' }, g.icon),
      el('h2', {}, g.name),
      el('div', { class: 'lesson' }, g.rules.map(r => el('p', {}, r))),
      el('button', { class: 'btn primary big', onclick: () => g.start(g) }, 'Начать')));
}

function finishGame(g, xp, summary) {
  xp = Math.max(0, Math.round(xp));
  state.games[g.id] = Math.max(state.games[g.id] || 0, xp);
  const rank = addXP(xp);
  renderResult({ title: g.icon + ' ' + g.name, xp, rank, summary, again: () => g.start(g), back: renderGames });
}

function gameHeader(g, info) {
  return [topbar(g.icon + ' ' + g.name, () => renderGameIntro(g)), info];
}

// --- Найди пару ---
function gamePairs(g) {
  const info = el('div', { class: 'muted small' });
  const area = el('div');
  show(...gameHeader(g, info), area);
  const short = ALL_WORDS.filter(w => w.en.length <= 16 && w.ru.length <= 24);
  let round = 0, mistakes = 0;
  const t0 = Date.now();

  function nextRound() {
    if (round === 3) {
      const sec = Math.round((Date.now() - t0) / 1000);
      return finishGame(g, 60 - mistakes * 5 - Math.max(0, sec - 60) / 3, `Время: ${sec} с, ошибок: ${mistakes}.`);
    }
    round++;
    info.textContent = `Раунд ${round} из 3 · ошибок: ${mistakes}`;
    const set = [];
    for (const w of shuffle(short)) {   // без повторов перевода в одном раунде
      if (!set.some(x => x.ru === w.ru || x.en === w.en)) set.push(w);
      if (set.length === 6) break;
    }
    let selEn = null, selRu = null, left = 6;
    const enBtns = shuffle(set).map(w => el('button', { class: 'pair', onclick: () => choose('en', w, enBtns, ruBtns) }, w.en));
    const ruBtns = shuffle(set).map(w => el('button', { class: 'pair', onclick: () => choose('ru', w, enBtns, ruBtns) }, w.ru));
    area.replaceChildren(el('div', { class: 'pairs' }, el('div', {}, enBtns), el('div', {}, ruBtns)));

    function choose(side, w, ens, rus) {
      sfx.tap();
      const btns = side === 'en' ? ens : rus;
      btns.forEach(b => b.classList.remove('sel'));
      const btn = btns.find(b => b.textContent === (side === 'en' ? w.en : w.ru));
      btn.classList.add('sel');
      if (side === 'en') { selEn = { w, btn }; speak(w.en); } else selRu = { w, btn };
      if (!selEn || !selRu) return;
      if (selEn.w.ru === selRu.w.ru) {
        sfx.right();
        [selEn.btn, selRu.btn].forEach(b => { b.classList.remove('sel'); b.classList.add('done'); b.disabled = true; });
        if (--left === 0) later(nextRound, 500);
      } else {
        sfx.wrong();
        buzz();
        mistakes++;
        info.textContent = `Раунд ${round} из 3 · ошибок: ${mistakes}`;
        [selEn.btn, selRu.btn].forEach(b => { b.classList.remove('sel'); flash(b, 'shake'); });
      }
      selEn = selRu = null;
    }
  }
  nextRound();
}

// --- Собери фразу ---
function gameBuilder(g) {
  const info = el('div', { class: 'muted small' });
  const area = el('div');
  show(...gameHeader(g, info), area);
  const set = shuffle(SENTENCES).slice(0, 6);
  let i = 0, right = 0, mistakes = 0;

  function next() {
    if (i === set.length) return finishGame(g, right * 8 - mistakes * 2, `Собрано фраз: ${right} из ${set.length}, ошибок: ${mistakes}.`);
    const [en, ru] = set[i];
    const words = en.split(' ');
    let tiles;
    do { tiles = shuffle(words.map((w, k) => ({ w, k }))); } while (words.length > 1 && tiles.map(t => t.w).join(' ') === en);
    let answer = [];
    info.textContent = `Фраза ${i + 1} из ${set.length} · верно ${right}`;
    const ansRow = el('div', { class: 'answer-line' });
    const pool = el('div', { class: 'word-pool' });

    function draw() {
      ansRow.replaceChildren(...(answer.length ? answer.map((t, k) => el('button', { class: 'tile-word', onclick: () => { answer.splice(k, 1); draw(); } }, t.w))
        : [el('div', { class: 'muted small' }, 'Нажимай слова снизу по порядку')]));
      pool.replaceChildren(...tiles.map(t => el('button', {
        class: 'tile-word' + (answer.includes(t) ? ' used' : ''),
        onclick: () => { if (!answer.includes(t)) { sfx.tap(); answer.push(t); draw(); check(); } } }, t.w)));
    }

    function check() {
      if (answer.length < words.length) return;
      if (answer.map(t => t.w).join(' ') === en) {
        right++;
        sfx.right();
        speak(en);
        ansRow.classList.add('ok');
        later(() => { i++; next(); }, 1200);
      } else {
        mistakes++;
        sfx.wrong();
        buzz();
        flash(ansRow, 'shake');
        later(() => { answer = []; draw(); }, 450);
      }
    }

    area.replaceChildren(
      el('div', { class: 'question' }, ru),
      ansRow, pool,
      el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Пропустить'));
    draw();
  }
  next();
}

// --- Угадай на слух ---
function gameListen(g) {
  const info = el('div', { class: 'muted small' });
  const area = el('div');
  show(...gameHeader(g, info), area);
  if (!('speechSynthesis' in window)) {
    area.append(el('p', {}, 'На этом устройстве нет синтеза речи. Игра не сможет произносить слова.'));
    return;
  }
  const set = shuffle(ALL_WORDS).slice(0, 10);
  let i = 0, right = 0;

  function next() {
    if (i === set.length) return finishGame(g, right * 6, `Угадано на слух: ${right} из ${set.length}.`);
    const w = set[i];
    info.textContent = `Слово ${i + 1} из ${set.length} · верно ${right}`;
    const others = shuffle(ALL_WORDS.filter(x => x.en !== w.en)).slice(0, 3);
    const explain = el('div', { class: 'explain', hidden: '' });
    const opts = shuffle([w, ...others]).map(o => el('button', { class: 'option', onclick: () => answer(o) }, o.en));
    area.replaceChildren(
      el('button', { class: 'listen-btn', onclick: () => speak(w.en) }, '🔊', el('div', { class: 'small' }, 'Нажми, чтобы послушать ещё раз')),
      el('div', { class: 'options' }, opts),
      explain);
    later(() => speak(w.en), 300);

    function answer(o) {
      const ok = o.en === w.en;
      opts.forEach(b => {
        b.disabled = true;
        if (b.textContent === w.en) b.classList.add('right');
        else if (b.textContent === o.en) b.classList.add('wrong');
      });
      if (ok) { right++; sfx.right(); } else { sfx.wrong(); buzz(); }
      explain.hidden = false;
      explain.replaceChildren(
        el('div', { class: 'explain-head' }, ok ? '✅ Верно!' : `❌ Прозвучало: ${w.en}`),
        el('p', {}, explainWord(w)),
        el('button', { class: 'btn primary', onclick: () => { i++; next(); } }, 'Дальше →'));
    }
  }
  next();
}

// ================= Звания и настройки =================
function renderRanks() {
  const cur = rankIndex(state.xp);
  show(topbar('Звания', renderHome),
    el('p', { class: 'muted' }, `У тебя ${state.xp} XP. Опыт даётся за тесты, карточки и игры.`),
    RANKS.map((r, i) => el('div', { class: 'rank-row' + (i > cur ? ' locked' : '') + (i === cur ? ' current' : '') },
      el('div', { class: 'rank-row-icon' }, r.icon),
      el('div', {},
        el('div', { class: 'tile-name' }, `${i + 1}. ${r.name}`),
        el('div', { class: 'small muted' }, i <= cur ? r.quote : `откроется на ${r.xp} XP`)))));
}

function renderSettings() {
  const toggle = (label, key) => {
    const b = el('button', { class: 'setting', onclick: () => {
      state[key] = !state[key];
      saveState();
      b.lastChild.textContent = state[key] ? 'вкл' : 'выкл';
      sfx.tap();
    } }, el('span', {}, label), el('b', {}, state[key] ? 'вкл' : 'выкл'));
    return b;
  };
  let armed = false;
  const reset = el('button', { class: 'btn danger', onclick: () => {
    if (!armed) { armed = true; reset.textContent = 'Точно? Нажми ещё раз — весь прогресс обнулится'; return; }
    state = freshState();
    saveState();
    renderHome();
  } }, 'Сбросить прогресс');
  show(topbar('⚙️ Настройки', renderHome),
    toggle('🔔 Звуки ответов', 'sound'),
    toggle('🗣 Сразу озвучивать слова', 'autoSpeak'),
    toggle('🐢 Медленная озвучка', 'slow'),
    el('button', { class: 'setting', onclick: () => speak('Hello! Do you speak English?') }, el('span', {}, '🔊 Проверить голос'), el('b', {}, '▶')),
    el('div', { class: 'lesson' },
      el('p', {}, el('b', {}, 'Нет звука озвучки?'), ' Приложение говорит голосом самого телефона. Включи английский голос: Настройки Android → поиск «Синтез речи» (или «Озвучивание текста») → движок Google → «Установить голосовые данные» → English. После этого озвучка работает и без интернета.'),
      el('p', { class: 'small muted' }, voice ? `Сейчас голос: ${voice.name} (${voice.lang})` : 'Английский голос на устройстве не найден — будет голос по умолчанию.')),
    reset);
}

// ================= Запуск =================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  });
  let reloaded = !navigator.serviceWorker.controller;   // первая установка — перезагрузка не нужна
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    if (!document.querySelector('.options, .flashcard, .pairs, .answer-line')) location.reload();
  });
}

renderHome();
