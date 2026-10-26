'use strict';

// ================= Сохранение прогресса =================
const STORE_KEY = 'duyuspik-v1';
const DAILY_GOAL = 50;                       // XP в день
const INTERVALS = [0, 1, 2, 4, 8, 16, 32];   // дней до следующего показа карточки по «коробкам»

function freshState() {
  return { xp: 0, today: { date: null, xp: 0 }, streak: { last: null, count: 0 },
    cards: {}, mistakes: {}, lessons: {}, games: {}, sound: true, autoSpeak: true, slow: false,
    daily: null, courseDays: 0 };
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

// Порядок слов в «Уроке дня»: от простых тем к профессиональным, по 5 слов из темы вперемешку
const COURSE_THEMES = ['basic', 'series', 'kitchen', 'sport', 'games', 'it', 'ai', 'python', 'video', 'irregular', 'phrasal',
  'work', 'emotions', 'city', 'shopping', 'health', 'time', 'family', 'slang'];
const COURSE_ORDER = (() => {
  const queues = [...COURSE_THEMES, ...THEMES.map(t => t.id).filter(id => !COURSE_THEMES.includes(id))]
    .map(id => ALL_WORDS.filter(w => w.theme === id));
  const order = [];
  while (queues.some(q => q.length)) {
    for (const q of queues) order.push(...q.splice(0, 5));
  }
  return order;
})();
const WORDS_PER_DAY = 10;
const COURSE_DAYS = Math.ceil(COURSE_ORDER.length / WORDS_PER_DAY);

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

// Начислить опыт (или снять за плохой результат); вернуть новое звание, если оно сменилось
const MAX_PENALTY = 30;   // больше 30 XP за одно задание не снимаем
function addXP(n) {
  n = Math.round(n);
  if (!n) return null;
  const before = rankIndex(state.xp);
  state.xp = Math.max(0, state.xp + n);
  if (state.today.date !== dayKey()) state.today = { date: dayKey(), xp: 0 };
  state.today.xp = Math.max(0, state.today.xp + n);
  if (n < 0) {
    saveState();
    const after = rankIndex(state.xp);
    return after < before ? { ...RANKS[after], down: true } : null;
  }
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
// Неправильные глаголы: спрашиваем 2-ю или 3-ю форму. Для burn, learn… форма на -ed тоже верна — её не подсовываем
const ED_ALSO_OK = ['burn', 'learn', 'dream', 'fit', 'quit', 'bet'];
function irregularQuestion(w) {
  const [base, past, part] = w.en.split(' – ');
  const second = Math.random() < 0.5;
  const answer = second ? past : part;
  const fake = ED_ALSO_OK.includes(base) ? null : base + (base.endsWith('e') ? 'd' : 'ed');
  const others = shuffle(ALL_WORDS.filter(x => x.theme === 'irregular' && x.id !== w.id)).map(x => x.en.split(' – ')[second ? 1 : 2]);
  const options = [answer];
  for (const o of [fake, second ? part : past, base, ...others]) if (o && !options.includes(o) && options.length < 4) options.push(o);
  return { q: second ? `Прошедшее время (2-я форма) от «${base}» — «${w.ru}»?` : `Третья форма от «${base}» (I have …)?`,
    say: w.en, options: shuffle(options), answer, key: 'w:' + w.id,
    explain: `${w.en} — «${w.ru}». ${second ? 'Вторая форма — для прошедшего: вчера, год назад.' : 'Третья форма — после have/has и was/were.'}` +
      (w.note ? ' ' + w.note : '') + (w.example ? ' Пример: ' + w.example : '') };
}

function wordQuestion(w) {
  if (w.theme === 'irregular' && Math.random() < 0.6) return irregularQuestion(w);
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
    (() => {
      const d = state.daily && state.daily.date === dayKey() ? state.daily : null;
      const sub = d && d.done ? '✅ на сегодня пройден — новые слова завтра'
        : `день ${state.courseDays + 1} из ${COURSE_DAYS} · ${WORDS_PER_DAY} новых слов` +
          (d ? ` · шагов ${Object.keys(d.steps).length} из ${DAILY_STEPS.length}` : '');
      return el('button', { class: 'tile daily-tile', onclick: renderDaily },
        el('div', { class: 'tile-icon' }, '📅'), el('div', { class: 'tile-name' }, 'Урок дня'), el('div', { class: 'tile-sub' }, sub));
    })(),
    el('div', { class: 'tiles' },
      tile('📝', 'Тест', '10 вопросов с объяснениями', () => runQuiz('📝 Тест', mixedTest(), renderHome), '#ece6ff'),
      tile('🃏', 'Карточки', due ? `${due} ждут повторения` : 'учить новые слова', () => startCards(null, renderHome), '#ffe1ec'),
      tile('📚', 'Грамматика', `${LESSONS.length} уроков простыми словами`, renderLessons, '#dff3ff'),
      tile('🎮', 'Игры', `${GAMES.length} игр`, renderGames, '#e2f7e8'),
      tile('🗂', 'Темы', 'сериалы, игры, спорт…', renderThemes, '#fff1d6'),
      tile('❌', 'Мои ошибки', mistakes ? `${mistakes} на проработку` : 'пока пусто', renderMistakes, '#fde4dc')));
}

// ================= Тест =================
// next = {label, fn} — кнопка продолжения вместо «Ещё раз» (нужна «Уроку дня»)
function runQuiz(title, questions, back, onFinish, next_) {
  let i = 0, right = 0;
  const wrongList = [], results = [];
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
      results.push({ q, ok });
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
    const xp = Math.max(-MAX_PENALTY, right * 5 - wrongList.length * 3);   // ошибка −3
    const rank = addXP(xp);
    if (onFinish) onFinish(right, questions.length, results);
    renderResult({
      title, xp, rank,
      summary: `Верно ${right} из ${questions.length}.` + (wrongList.length ? ' Ошибки попали в «Мои ошибки» — их можно прогнать отдельно.' : ' Без единой ошибки! 🔥'),
      again: () => runQuiz(title, questions.map(q => ({ ...q, options: shuffle(q.options) })), back, onFinish, next_),
      back, next: next_,
    });
  }

  show(topbar(title, back), counter, box);
  next();
}

function renderResult({ title, xp, rank, summary, again, back, next }) {
  if (rank && !rank.down) { sfx.rankup(); buzz([80, 60, 80]); } else if (xp < 0) { sfx.wrong(); buzz(); } else sfx.finish();
  show(
    topbar(title, back),
    el('div', { class: 'result' },
      rank ? el('div', { class: 'rankup' + (rank.down ? ' rankdown' : '') },
        el('div', { class: 'rankup-icon' }, rank.icon),
        el('div', {}, rank.down ? 'Звание понижено 😬' : 'Новое звание!'),
        el('div', { class: 'rank-name' }, rank.name),
        el('div', {}, rank.down ? 'Ничего, отыграешься — следующий тест поднимет обратно.' : rank.quote)) : null,
      el('div', { class: 'result-xp' + (xp < 0 ? ' minus' : '') }, `${xp < 0 ? '−' + -xp : '+' + xp} XP`),
      xp < 0 ? el('p', { class: 'muted small' }, 'Слабый результат — опыт снят. Ошибки из тестов ждут в «Мои ошибки», прогони их — и всё вернётся.') : null,
      el('p', {}, summary),
      rankCard(),
      next
        ? el('button', { class: 'btn primary big', onclick: next.fn }, next.label)
        : el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: renderHome }, 'На главную'),
          again ? el('button', { class: 'btn primary', onclick: again }, 'Ещё раз') : null)));
}

// ================= Карточки (умное повторение) =================
// opts: {onlyDue — без новых слов, next — {label, fn} для «Урока дня»}
function startCards(themeId, back, opts = {}) {
  const queue = [...shuffle(dueCards(themeId)).slice(0, 20), ...(opts.onlyDue ? [] : shuffle(newCards(themeId)).slice(0, 10))];
  if (!queue.length && opts.next) return opts.next.fn();
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
      return renderResult({ title: '🃏 Карточки', xp: done * 2, rank, back, next: opts.next,
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
  { id: 'dialog', icon: '💬', name: 'Диалог-квест', start: gameDialog,
    rules: ['Живые сцены: пиццерия, собеседование, заказчик, лобби CS, аэропорт и даже полиция Лос-Сантоса.', 'Собеседник говорит фразу — выбери, что ответишь. Не понял — нажми «Перевод».', 'Неверный ответ не провал: увидишь, почему так не говорят, и диалог пойдёт дальше.'] },
  { id: 'hero', icon: '🎭', name: 'Что сказал герой?', start: gameHero,
    rules: ['Фразы героев «Теории большого взрыва», «Офиса», «Во все тяжкие», «Очень странных дел», «Сверхъестественного», «Бесстыжих», GTA и CS.', 'Выбери верный перевод.', 'После ответа — пояснение: какое правило или сленг спрятан во фразе.'] },
  { id: 'speed', icon: '⚡', name: 'Скоростной перевод', start: gameSpeed,
    rules: ['60 секунд: переведи как можно больше слов.', 'Ошибка отнимает 3 секунды.', 'Слова берутся из тех, что ты уже начал учить, — отличная тренировка памяти.'] },
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
  xp = Math.max(-MAX_PENALTY, Math.round(xp));
  state.games[g.id] = Math.max(state.games[g.id] || 0, xp);
  const rank = addXP(xp);
  renderResult({ title: g.icon + ' ' + g.name, xp, rank, summary, again: () => g.start(g), back: renderGames });
}

function gameHeader(g, info) {
  return [topbar(g.icon + ' ' + g.name, g.back || (() => renderGameIntro(g))), info];
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
// opts: {set — свои фразы, onDone(right) — вместо обычного итога игры (для «Урока дня»)}
function gameBuilder(g, opts = {}) {
  const info = el('div', { class: 'muted small' });
  const area = el('div');
  show(...gameHeader(g, info), area);
  const set = opts.set || shuffle(SENTENCES).slice(0, 6);
  let i = 0, right = 0, mistakes = 0, skipped = 0;

  function next() {
    if (i === set.length && opts.onDone) return opts.onDone(right);
    if (i === set.length) return finishGame(g, right * 8 - mistakes * 2 - skipped * 4,
      `Собрано фраз: ${right} из ${set.length}, ошибок: ${mistakes}, пропущено: ${skipped}.`);
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
      el('button', { class: 'btn', onclick: () => { skipped++; i++; next(); } }, 'Пропустить'));
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
    if (i === set.length) return finishGame(g, right * 6 - (set.length - right) * 3, `Угадано на слух: ${right} из ${set.length}.`);
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

// --- Диалог-квест ---
function gameDialog(g) {
  show(topbar(g.icon + ' ' + g.name, () => renderGameIntro(g)),
    el('p', { class: 'muted' }, 'Выбери сцену:'),
    DIALOGS.map(d => {
      const best = state.games['dialog:' + d.id];
      return el('button', { class: 'theme-row', onclick: () => playDialog(g, d) },
        el('div', { class: 'theme-icon' }, d.icon),
        el('div', { class: 'theme-info' },
          el('div', { class: 'tile-name' }, d.name),
          el('div', { class: 'small muted' }, best != null ? `лучший результат: ${best} из ${d.steps.length}` : 'не пройдена')));
    }));
}

function playDialog(g, d) {
  const info = el('div', { class: 'muted small' });
  const chat = el('div', { class: 'chat' });
  const area = el('div');
  show(topbar(d.icon + ' ' + d.name, () => gameDialog(g)), info, el('p', { class: 'muted' }, d.intro), chat, area);
  let i = 0, right = 0;

  function next() {
    if (i === d.steps.length) {
      state.games['dialog:' + d.id] = Math.max(state.games['dialog:' + d.id] || 0, right);
      return finishGame({ ...g, start: () => playDialog(g, d) }, right * 6 - (d.steps.length - right) * 3,
        `Сцена «${d.name}»: удачных ответов ${right} из ${d.steps.length}.` + (right === d.steps.length ? ' Как носитель! 🔥' : ''));
    }
    const [who, en, ru, replies] = d.steps[i];
    info.textContent = `Реплика ${i + 1} из ${d.steps.length} · удачно ${right}`;
    const tr = el('div', { class: 'small muted', hidden: '' }, ru);
    chat.append(el('div', { class: 'bubble them' },
      el('div', { class: 'small muted' }, who),
      el('div', { class: 'bubble-row' }, el('span', {}, en), sayButton(en)),
      tr,
      el('button', { class: 'link-btn', onclick: e => { tr.hidden = false; e.target.remove(); } }, 'Перевод')));
    if (state.autoSpeak) later(() => speak(en), 250);
    const explain = el('div', { class: 'explain', hidden: '' });
    const opts = shuffle(replies).map(r => el('button', { class: 'option', onclick: () => answer(r) }, r[0]));
    area.replaceChildren(el('div', { class: 'options' }, opts), explain);
    opts[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function answer(r) {
      const good = replies.find(x => x[1]);
      opts.forEach(b => {
        b.disabled = true;
        if (b.textContent === good[0]) b.classList.add('right');
        else if (b.textContent === r[0]) b.classList.add('wrong');
      });
      if (r[1]) { right++; sfx.right(); } else { sfx.wrong(); buzz(); }
      speak(good[0]);
      explain.hidden = false;
      explain.replaceChildren(
        el('div', { class: 'explain-head' }, r[1] ? '✅ Отличный ответ!' : '❌ Так не скажут'),
        el('p', {}, r[1] ? r[2] : `${r[2]} Лучше: «${good[0]}» — ${good[2]}`),
        el('button', { class: 'btn primary', onclick: () => {
          chat.append(el('div', { class: 'bubble me' }, good[0]));
          i++; next();
        } }, i + 1 < d.steps.length ? 'Дальше →' : 'Итог'));
      explain.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  next();
}

// --- Что сказал герой? ---
function gameHero(g) {
  const qs = shuffle(HERO_LINES).slice(0, 10).map(([who, icon, en, ru, wrong, note]) => ({
    q: `${icon} ${who}: «${en}»`, say: en, sayFirst: true,
    options: shuffle([ru, ...wrong]), answer: ru, explain: `«${en}» — «${ru}». ${note}` }));
  runQuiz(g.icon + ' ' + g.name, qs, renderGames, right => {
    state.games[g.id] = Math.max(state.games[g.id] || 0, right * 5);
    saveState();
  });
}

// --- Скоростной перевод ---
function gameSpeed(g) {
  const info = el('div', { class: 'speed-info' });
  const area = el('div');
  show(...gameHeader(g, info), area);
  const short = w => w.en.length <= 22 && w.ru.length <= 30;
  const started = ALL_WORDS.filter(w => state.cards[w.id] && short(w));
  const pool = started.length >= 20 ? started : ALL_WORDS.filter(w => ['basic', 'series', 'kitchen'].includes(w.theme) && short(w));
  let left = 60, right = 0, wrong = 0, last = null;
  let deadline = Date.now() + 60000;

  every(() => {
    left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    draw();
    if (left === 0) finishGame(g, right * 3 - wrong * 2, `Переведено: ${right}, ошибок: ${wrong}.` + (right >= 20 ? ' Скорость огонь! ⚡' : ''));
  }, 200);

  function draw() { info.textContent = `⏱ ${left} с · ✅ ${right} · ❌ ${wrong}`; }

  function next() {
    let w;
    do { w = pick(pool); } while (w === last && pool.length > 1);
    last = w;
    const others = shuffle(pool.filter(x => x.ru !== w.ru)).slice(0, 3);
    const opts = shuffle([w, ...others]).map(o => el('button', { class: 'option', onclick: () => answer(o, opts) }, o.ru));
    area.replaceChildren(el('div', { class: 'card-en speed-word' }, w.en), el('div', { class: 'options' }, opts));

    function answer(o, btns) {
      const ok = o.ru === w.ru;
      markMistake('w:' + w.id, !ok);
      btns.forEach(b => { b.disabled = true; if (b.textContent === w.ru) b.classList.add('right'); else if (b.textContent === o.ru) b.classList.add('wrong'); });
      if (ok) { right++; sfx.right(); } else { wrong++; deadline -= 3000; sfx.wrong(); buzz(); }
      draw();
      later(next, ok ? 250 : 700);
    }
  }
  draw();
  next();
}

// ================= Урок дня: 10 новых слов + повторение + грамматика + фраза =================
const DAILY_STEPS = [
  { id: 'intro', icon: '🆕', name: 'Новые слова' },
  { id: 'quiz', icon: '✅', name: 'Проверка новых слов' },
  { id: 'repeat', icon: '🔁', name: 'Повторение старых слов' },
  { id: 'grammar', icon: '📚', name: '5 вопросов по грамматике' },
  { id: 'phrase', icon: '🧱', name: 'Фраза дня' },
];

function ensureDaily() {
  if (state.daily && state.daily.date === dayKey()) return state.daily;
  const words = COURSE_ORDER.filter(w => !state.cards[w.id]).slice(0, WORDS_PER_DAY).map(w => w.id);
  state.daily = { date: dayKey(), words, steps: {}, done: false, sentence: state.courseDays % SENTENCES.length };
  saveState();
  return state.daily;
}

function dailyStepDone(id) {
  const d = ensureDaily();
  d.steps[id] = true;
  if (!d.done && DAILY_STEPS.every(s => d.steps[s.id])) {
    d.done = true;
    state.courseDays += 1;
    saveState();
    const rank = addXP(20);
    return renderResult({ title: '📅 Урок дня', xp: 20, rank, back: renderHome,
      summary: `День ${state.courseDays} из ${COURSE_DAYS} пройден! Бонус за весь урок. Завтра — следующие ${WORDS_PER_DAY} слов.`,
      next: { label: 'На главную', fn: renderHome } });
  }
  saveState();
  renderDaily();
}

function renderDaily() {
  const d = ensureDaily();
  const words = d.words.map(id => WORD_BY_ID[id]).filter(Boolean);
  const dayNo = state.courseDays + (d.done ? 0 : 1);
  const steps = DAILY_STEPS.map(s => {
    const done = !!d.steps[s.id];
    const locked = s.id === 'quiz' && !d.steps.intro;
    return el('button', { class: 'theme-row step' + (done ? ' done' : '') + (locked ? ' locked' : ''),
      onclick: () => !locked && startDailyStep(s.id, words, d) },
      el('div', { class: 'theme-icon' }, done ? '✅' : s.icon),
      el('div', { class: 'theme-info' },
        el('div', { class: 'tile-name' }, s.name),
        el('div', { class: 'small muted' }, locked ? 'сначала посмотри новые слова' : done ? 'готово' : 'нажми, чтобы начать')));
  });
  show(topbar('📅 Урок дня', renderHome),
    el('div', { class: 'goal' },
      el('div', { class: 'goal-row' }, el('b', {}, `День ${Math.min(dayNo, COURSE_DAYS)} из ${COURSE_DAYS}`),
        el('span', {}, `${Object.keys(d.steps).length} из ${DAILY_STEPS.length} шагов`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill goal-fill', style: `width:${state.courseDays / COURSE_DAYS * 100}%` })),
      el('div', { class: 'small muted' }, words.length
        ? `Сегодня: ${words.map(w => w.en).slice(0, 4).join(', ')}${words.length > 4 ? '…' : ''}`
        : 'Все слова курса уже пройдены — повторяй карточки, чтобы не забыть!')),
    d.done ? el('div', { class: 'explain' }, el('div', { class: 'explain-head' }, '🎉 Урок дня пройден!'),
      el('p', {}, 'Можно повторить любой шаг ещё раз. Новые слова — завтра.')) : null,
    steps);
}

function startDailyStep(id, words, d) {
  const back = renderDaily;
  const toDaily = { label: 'Дальше →', fn: () => dailyStepDone(id) };
  if (id === 'intro') {
    if (!words.length) return dailyStepDone('intro');
    return showNewWords(words, 0);
  }
  if (id === 'quiz') {
    if (!words.length) return dailyStepDone('quiz');
    return runQuiz('✅ Проверка новых слов', words.map(wordQuestion), back, (right, total, results) => {
      // кто ответил верно — увидит слово завтра, ошибся — ещё сегодня в повторении
      results.forEach(({ q, ok }) => {
        const wid = q.key.slice(2);
        state.cards[wid] = { b: ok ? 1 : 0, due: daysFromNow(ok ? 1 : 0) };
      });
      saveState();
    }, toDaily);
  }
  if (id === 'repeat') return startCards(null, back, { onlyDue: true, next: toDaily });
  if (id === 'grammar') {
    const qs = shuffle(LESSONS.flatMap(l => l.questions.map((_, i) => [l.id, i]))).slice(0, 5)
      .map(([lid, i]) => grammarQuestion(lid, i));
    return runQuiz('📚 Грамматика дня', qs, back, null, toDaily);
  }
  if (id === 'phrase') {
    const g = { ...GAMES.find(x => x.id === 'builder'), name: 'Фраза дня', back };
    return gameBuilder(g, { set: [SENTENCES[d.sentence]], onDone: () => { addXP(8); dailyStepDone('phrase'); } });
  }
}

function showNewWords(words, i) {
  const w = words[i];
  const t = themeById(w.theme);
  show(topbar('🆕 Новые слова', renderDaily),
    el('div', { class: 'muted small' }, `Слово ${i + 1} из ${words.length}`),
    el('div', { class: 'flashcard', style: `background:${t.color}` },
      el('div', { class: 'small muted' }, t.icon + ' ' + t.name),
      el('div', { class: 'card-en' }, w.en),
      sayButton(w.en, 'say-btn big-say'),
      el('div', { class: 'card-back' },
        el('div', { class: 'card-ru' }, w.ru),
        w.note ? el('p', { class: 'muted' }, w.note) : null,
        w.example ? el('p', { class: 'example' }, w.example) : null)),
    el('div', { class: 'row' },
      i > 0 ? el('button', { class: 'btn', onclick: () => showNewWords(words, i - 1) }, '← Назад') : null,
      el('button', { class: 'btn primary', onclick: () => {
        sfx.tap();
        if (i + 1 < words.length) return showNewWords(words, i + 1);
        // слова попадают в карточки: дальше их будет приводить умное повторение
        words.forEach(x => { if (!state.cards[x.id]) state.cards[x.id] = { b: 0, due: daysFromNow(0) }; });
        saveState();
        dailyStepDone('intro');
      } }, i + 1 < words.length ? 'Дальше →' : 'Запомнил, к проверке →')));
  if (state.autoSpeak) later(() => speak(w.en), 250);
}

// ================= Звания и настройки =================
function renderRanks() {
  const cur = rankIndex(state.xp);
  show(topbar('Звания', renderHome),
    el('p', { class: 'muted' }, `У тебя ${state.xp} XP. Опыт даётся за тесты, карточки и игры, а за плохой результат снимается (не больше ${MAX_PENALTY} XP за раз).`),
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
