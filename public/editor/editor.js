import {
  MAX_ANSWERS,
  TARGET_TOTAL,
  filenameForName,
  isSafeFilename,
  parsePackText,
  normalizePack,
  validatePack,
  hasErrors,
  formatPackJson,
  scalePointsTo100,
} from '/shared/packFormat.js';

const $ = (sel) => document.querySelector(sel);
const DRAFT_KEY = 'feud-editor-draft-v1';

// ── State ────────────────────────────────────────────────────────────
let pack = blankPack();
let file = '';
let fileTouched = false; // user typed their own filename
let loadedFrom = null; // filename on the server this pack was opened from
let dirty = false;
let focusQ = 0;
let cloud = false;
let packFiles = [];
let issues = [];

function blankQuestion() {
  return { question: '', answers: Array.from({ length: 4 }, () => ({ text: '', points: null })) };
}

function blankPack() {
  return { name: '', questions: [blankQuestion()] };
}

// ── Helpers ──────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast toast--${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 3800);
}

async function copyText(text) {
  // navigator.clipboard needs a secure context (localhost / https); LAN IPs fall back
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ pack, file, fileTouched, loadedFrom, dirty }));
  } catch {
    // storage unavailable (private window) — editing still works
  }
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function markDirty() {
  dirty = true;
  saveDraft();
}

function confirmDiscard() {
  return !dirty || confirm('You have unsaved changes in this pack. Discard them?');
}

function cleanPack() {
  // drop fully blank answer rows / questions so "Download" and "Save" don't trip on leftovers
  return {
    name: pack.name.trim(),
    questions: pack.questions
      .map((q) => ({
        question: q.question.trim(),
        answers: q.answers
          .filter((a) => String(a.text ?? '').trim() || (a.points !== null && a.points !== ''))
          .map((a) => ({ text: String(a.text ?? '').trim(), points: a.points })),
      }))
      .filter((q) => q.question || q.answers.length),
  };
}

// ── Loading packs ────────────────────────────────────────────────────
function loadPack(newPack, { from = null, filename = null, markClean = true } = {}) {
  pack = normalizePack(newPack);
  if (pack.questions.length === 0) pack.questions.push(blankQuestion());
  loadedFrom = from;
  file = filename ?? (from || filenameForName(pack.name));
  fileTouched = Boolean(filename || from);
  focusQ = 0;
  dirty = !markClean;
  renderAll();
  saveDraft();
}

async function openServerPack(name) {
  if (name === loadedFrom && !dirty) return;
  if (!confirmDiscard()) return;
  try {
    const res = await fetch(`/api/question-packs/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not open pack');
    loadPack(data.pack, { from: name });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function refreshPackList() {
  try {
    const res = await fetch('/api/question-files', { cache: 'no-store' });
    const data = await res.json();
    packFiles = data.files ?? [];
  } catch {
    packFiles = [];
  }
  renderPackList();
}

// ── Rendering ────────────────────────────────────────────────────────
function renderPackList() {
  const list = $('#pack-list');
  if (packFiles.length === 0) {
    list.innerHTML = '<li class="muted small">No packs found.</li>';
    return;
  }
  list.innerHTML = packFiles
    .map((f) => {
      const label = f.replace(/^-/, '').replace(/\.json$/i, '');
      const active = f === loadedFrom ? ' is-active' : '';
      return `<li><button class="pack-item${active}" data-file="${esc(f)}" title="${esc(f)}">${esc(label)}</button></li>`;
    })
    .join('');
}

function answerRow(a, qi, ai, max) {
  const pts = a.points ?? '';
  const pct = max > 0 && Number(a.points) > 0 ? Math.max(4, Math.round((Number(a.points) / max) * 100)) : 0;
  return `
    <li class="ans" data-q="${qi}" data-a="${ai}">
      <span class="ans-rank">${ai + 1}</span>
      <input class="ans-text" data-field="text" value="${esc(a.text)}" placeholder="Answer" aria-label="Answer ${ai + 1} text" />
      <div class="ans-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <input class="ans-pts" data-field="points" type="number" min="1" step="1" inputmode="numeric" value="${esc(pts)}" placeholder="pts" aria-label="Answer ${ai + 1} points" />
      <div class="row-tools">
        <button type="button" class="icon-btn" data-act="ans-up" title="Move up" ${ai === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="ans-down" title="Move down">↓</button>
        <button type="button" class="icon-btn icon-btn--danger" data-act="ans-del" title="Delete answer">✕</button>
      </div>
    </li>`;
}

function questionCard(q, qi) {
  const max = Math.max(0, ...q.answers.map((a) => Number(a.points) || 0));
  const full = q.answers.length >= MAX_ANSWERS;
  return `
    <article class="q-card${qi === focusQ ? ' is-focused' : ''}" data-q="${qi}" id="q-${qi}">
      <header class="q-card__head">
        <span class="q-num">Q${qi + 1}</span>
        <input class="q-text" data-field="question" value="${esc(q.question)}" placeholder="Name something people…" aria-label="Question ${qi + 1}" />
        <div class="row-tools">
          <button type="button" class="icon-btn" data-act="q-up" title="Move question up" ${qi === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-act="q-down" title="Move question down" ${qi === pack.questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn" data-act="q-dup" title="Duplicate question">⧉</button>
          <button type="button" class="icon-btn icon-btn--danger" data-act="q-del" title="Delete question">🗑</button>
        </div>
      </header>
      <div class="ans-head" aria-hidden="true"><span>#</span><span>Answer</span><span></span><span>Points</span><span></span></div>
      <ol class="answers">${q.answers.map((a, ai) => answerRow(a, qi, ai, max)).join('')}</ol>
      <footer class="q-card__foot">
        <button type="button" class="ed-btn ed-btn--small" data-act="ans-add" ${full ? 'disabled title="The board holds 8 answers"' : ''}>+ Answer</button>
        <button type="button" class="ed-btn ed-btn--small ed-btn--ghost" data-act="sort">Sort by points</button>
        <button type="button" class="ed-btn ed-btn--small ed-btn--ghost" data-act="scale">Make it ${TARGET_TOTAL}</button>
        <span class="q-total" data-total></span>
      </footer>
    </article>`;
}

function renderQuestions() {
  $('#questions').innerHTML = pack.questions.map(questionCard).join('');
}

function renderHead() {
  $('#pack-name').value = pack.name;
  $('#pack-file').value = file;
}

function updateTotals() {
  pack.questions.forEach((q, qi) => {
    const card = document.getElementById(`q-${qi}`);
    if (!card) return;
    const total = q.answers.reduce((s, a) => s + (Number(a.points) || 0), 0);
    const el = card.querySelector('[data-total]');
    el.innerHTML = `Total <b>${total}</b> / ${TARGET_TOTAL}`;
    el.className = `q-total ${total === TARGET_TOTAL ? 'is-good' : total === 0 ? '' : 'is-off'}`;

    const max = Math.max(0, ...q.answers.map((a) => Number(a.points) || 0));
    card.querySelectorAll('.ans').forEach((row, ai) => {
      const p = Number(q.answers[ai]?.points) || 0;
      row.querySelector('.ans-bar span').style.width = max > 0 && p > 0 ? `${Math.max(4, Math.round((p / max) * 100))}%` : '0%';
    });
    const addBtn = card.querySelector('[data-act="ans-add"]');
    addBtn.disabled = q.answers.length >= MAX_ANSWERS;
  });
}

function updateIssues() {
  issues = validatePack(cleanPack());
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;

  $('#check-summary').innerHTML = issues.length === 0
    ? '<span class="pill pill--good">All good</span>'
    : `${errors ? `<span class="pill pill--error">${errors} to fix</span>` : ''}${warnings ? `<span class="pill pill--warning">${warnings} tip${warnings === 1 ? '' : 's'}</span>` : ''}`;

  $('#issues').innerHTML = issues.length === 0
    ? '<li class="issue issue--good">Ready to save. Every question follows the rules.</li>'
    : issues
      .map((i) => `<li class="issue issue--${i.level}" ${i.q != null ? `data-jump="${i.q}"` : ''}>${esc(i.message)}</li>`)
      .join('');

  // highlight fields. cleanPack() drops blank rows, so map answer indexes back by position
  document.querySelectorAll('.has-error, .has-warning').forEach((el) => el.classList.remove('has-error', 'has-warning'));
  const cleanedIndex = pack.questions.map((q) => {
    const map = [];
    q.answers.forEach((a, ai) => {
      if (String(a.text ?? '').trim() || (a.points !== null && a.points !== '')) map.push(ai);
    });
    return map;
  });
  for (const i of issues) {
    if (i.q == null) continue;
    const card = document.getElementById(`q-${i.q}`);
    if (!card) continue;
    const cls = i.level === 'error' ? 'has-error' : 'has-warning';
    if (i.a != null) {
      const realA = cleanedIndex[i.q]?.[i.a] ?? i.a;
      card.querySelector(`.ans[data-a="${realA}"]`)?.classList.add(cls);
    } else if (/question text/.test(i.message)) {
      card.querySelector('.q-text')?.classList.add(cls);
    }
  }

  // answers past the 8th won't fit on the board
  pack.questions.forEach((q, qi) => {
    if (q.answers.length <= MAX_ANSWERS) return;
    document.querySelectorAll(`#q-${qi} .ans`).forEach((row) => {
      if (Number(row.dataset.a) >= MAX_ANSWERS) row.classList.add('has-error');
    });
  });

  $('#btn-save').disabled = cloud;
}

function updateStats() {
  const n = pack.questions.length;
  const answers = pack.questions.reduce((s, q) => s + q.answers.filter((a) => String(a.text ?? '').trim()).length, 0);
  $('#pack-stats').textContent = `${n} question${n === 1 ? '' : 's'} · ${answers} answers`;
  $('#dirty-flag').classList.toggle('hidden', !dirty);
  document.title = `${dirty ? '• ' : ''}${pack.name || 'New pack'} — Question Bank Editor`;
}

function renderPreview() {
  const q = pack.questions[focusQ] ?? pack.questions[0];
  if (!q) {
    $('#preview').innerHTML = '';
    return;
  }
  const slots = Array.from({ length: MAX_ANSWERS }, (_, i) => q.answers[i]);
  const slot = (a, i) => {
    if (!a) return '<div class="pv-slot pv-slot--empty"></div>';
    const text = String(a.text ?? '').trim();
    return `<div class="pv-slot"><span class="pv-text">${esc(text || '—')}</span><span class="pv-pts">${esc(a.points ?? '')}</span></div>`;
  };
  $('#preview').innerHTML = `
    <p class="pv-question">${esc(q.question || 'Your question appears here')}</p>
    <div class="pv-board">
      <div class="pv-col">${slots.slice(0, 4).map(slot).join('')}</div>
      <div class="pv-col">${slots.slice(4).map((a, i) => slot(a, i + 4)).join('')}</div>
    </div>
    <p class="pv-caption">Q${focusQ + 1} — click a question to preview it</p>`;
}

function updateDerived() {
  updateTotals();
  updateIssues();
  updateStats();
  renderPreview();
}

function renderAll() {
  renderHead();
  renderQuestions();
  renderPackList();
  updateDerived();
}

// ── Editing events ───────────────────────────────────────────────────
$('#questions').addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  const card = e.target.closest('.q-card');
  if (!field || !card) return;
  const qi = Number(card.dataset.q);
  if (field === 'question') {
    pack.questions[qi].question = e.target.value;
  } else {
    const ai = Number(e.target.closest('.ans').dataset.a);
    const answer = pack.questions[qi].answers[ai];
    if (field === 'text') answer.text = e.target.value;
    if (field === 'points') answer.points = e.target.value === '' ? null : Math.round(Number(e.target.value));
  }
  markDirty();
  updateDerived();
});

$('#questions').addEventListener('focusin', (e) => {
  const card = e.target.closest('.q-card');
  if (!card) return;
  const qi = Number(card.dataset.q);
  if (qi !== focusQ) {
    document.querySelector('.q-card.is-focused')?.classList.remove('is-focused');
    card.classList.add('is-focused');
    focusQ = qi;
    renderPreview();
  }
});

$('#questions').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const row = e.target.closest('.ans');
  const card = e.target.closest('.q-card');
  if (!card) return;
  e.preventDefault();
  const qi = Number(card.dataset.q);
  if (e.target.classList.contains('q-text')) {
    card.querySelector('.ans .ans-text')?.focus();
  } else if (e.target.classList.contains('ans-text')) {
    row.querySelector('.ans-pts').focus();
  } else if (e.target.classList.contains('ans-pts')) {
    const ai = Number(row.dataset.a);
    const nextRow = card.querySelector(`.ans[data-a="${ai + 1}"]`);
    if (nextRow) nextRow.querySelector('.ans-text').focus();
    else if (pack.questions[qi].answers.length < MAX_ANSWERS) {
      pack.questions[qi].answers.push({ text: '', points: null });
      markDirty();
      rerenderKeepingFocus(qi, ai + 1, 'ans-text');
    }
  }
});

function rerenderKeepingFocus(qi, ai, cls) {
  renderQuestions();
  updateDerived();
  const card = document.getElementById(`q-${qi}`);
  const target = ai == null ? card?.querySelector(`.${cls}`) : card?.querySelector(`.ans[data-a="${ai}"] .${cls}`);
  target?.focus();
}

$('#questions').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.q-card');
  const qi = Number(card.dataset.q);
  const q = pack.questions[qi];
  const ai = btn.closest('.ans') ? Number(btn.closest('.ans').dataset.a) : null;
  const swap = (arr, i, j) => {
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  };

  switch (btn.dataset.act) {
    case 'ans-add':
      if (q.answers.length >= MAX_ANSWERS) return;
      q.answers.push({ text: '', points: null });
      markDirty();
      rerenderKeepingFocus(qi, q.answers.length - 1, 'ans-text');
      return;
    case 'ans-del':
      q.answers.splice(ai, 1);
      break;
    case 'ans-up':
      if (!swap(q.answers, ai, ai - 1)) return;
      break;
    case 'ans-down':
      if (!swap(q.answers, ai, ai + 1)) return;
      break;
    case 'sort':
      q.answers.sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
      toast(`Q${qi + 1} sorted by points.`);
      break;
    case 'scale': {
      const filled = q.answers.filter((a) => Number(a.points) > 0);
      if (filled.length === 0) {
        toast('Give the answers some points first.', 'error');
        return;
      }
      const scaled = scalePointsTo100(filled);
      let k = 0;
      q.answers = q.answers.map((a) => (Number(a.points) > 0 ? scaled[k++] : a));
      toast(`Q${qi + 1} points now add up to ${TARGET_TOTAL}.`);
      break;
    }
    case 'q-up':
      if (!swap(pack.questions, qi, qi - 1)) return;
      focusQ = qi - 1;
      break;
    case 'q-down':
      if (!swap(pack.questions, qi, qi + 1)) return;
      focusQ = qi + 1;
      break;
    case 'q-dup':
      pack.questions.splice(qi + 1, 0, structuredClone(q));
      focusQ = qi + 1;
      break;
    case 'q-del':
      if ((q.question.trim() || q.answers.some((a) => String(a.text ?? '').trim())) && !confirm(`Delete question ${qi + 1}?`)) return;
      pack.questions.splice(qi, 1);
      if (pack.questions.length === 0) pack.questions.push(blankQuestion());
      focusQ = Math.min(focusQ, pack.questions.length - 1);
      break;
    default:
      return;
  }
  markDirty();
  renderQuestions();
  updateDerived();
});

$('#btn-add-question').addEventListener('click', () => {
  pack.questions.push(blankQuestion());
  focusQ = pack.questions.length - 1;
  markDirty();
  rerenderKeepingFocus(focusQ, null, 'q-text');
  document.getElementById(`q-${focusQ}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#pack-name').addEventListener('input', (e) => {
  pack.name = e.target.value;
  if (!fileTouched && !loadedFrom) {
    file = filenameForName(pack.name);
    $('#pack-file').value = file;
  }
  markDirty();
  updateDerived();
});

$('#pack-file').addEventListener('input', (e) => {
  file = e.target.value.trim();
  fileTouched = true;
  markDirty();
  updateStats();
});

$('#pack-file').addEventListener('change', () => {
  if (file && !file.toLowerCase().endsWith('.json')) {
    file = `${file}.json`;
    $('#pack-file').value = file;
    saveDraft();
  }
});

$('#issues').addEventListener('click', (e) => {
  const li = e.target.closest('[data-jump]');
  if (!li) return;
  const card = document.getElementById(`q-${li.dataset.jump}`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.querySelector('.has-error input, .has-warning input, .q-text')?.focus({ preventScroll: true });
});

$('#pack-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-file]');
  if (btn) openServerPack(btn.dataset.file);
});

// ── Toolbar ──────────────────────────────────────────────────────────
$('#btn-new').addEventListener('click', () => {
  if (!confirmDiscard()) return;
  loadPack(blankPack());
  $('#pack-name').focus();
});

$('#file-open').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f || !confirmDiscard()) return;
  try {
    const parsed = parsePackText(await f.text());
    loadPack(parsed, { filename: isSafeFilename(f.name) ? f.name : filenameForName(parsed.name), markClean: false });
    toast(`Opened ${f.name}. Save to add it to the game.`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#btn-copy').addEventListener('click', async () => {
  const ok = await copyText(formatPackJson(cleanPack()));
  toast(ok ? 'Pack JSON copied.' : 'Copy failed — use Download instead.', ok ? 'ok' : 'error');
});

$('#btn-download').addEventListener('click', () => {
  const name = isSafeFilename(file) ? file : filenameForName(pack.name);
  const blob = new Blob([formatPackJson(cleanPack())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Downloaded ${name}.`);
});

async function savePack(overwrite = false) {
  const body = cleanPack();
  const current = validatePack(body);
  if (hasErrors(current)) {
    toast('Fix the red items in Check first.', 'error');
    document.querySelector('.issue--error')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (!isSafeFilename(file)) {
    toast('Use a simple file name ending in .json (no slashes or special characters).', 'error');
    $('#pack-file').focus();
    return;
  }
  const res = await fetch(`/api/question-packs/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack: body, overwrite: overwrite || file === loadedFrom }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) {
    if (confirm(`"${file}" already exists in the game. Replace it?`)) await savePack(true);
    return;
  }
  if (!res.ok) {
    toast(data.error || 'Save failed.', 'error');
    return;
  }
  pack = normalizePack(body);
  if (pack.questions.length === 0) pack.questions.push(blankQuestion());
  loadedFrom = file;
  dirty = false;
  saveDraft();
  await refreshPackList();
  renderAll();
  toast(`Saved ${file}. Pick it in the host controller's pack list.`);
}

$('#btn-save').addEventListener('click', () => {
  savePack().catch((err) => toast(err.message, 'error'));
});

// ── Import dialog ────────────────────────────────────────────────────
const dlgImport = $('#dlg-import');
$('#btn-import').addEventListener('click', () => {
  $('#import-error').classList.add('hidden');
  dlgImport.showModal();
  $('#import-text').focus();
});

$('#import-go').addEventListener('click', (e) => {
  e.preventDefault();
  try {
    const parsed = parsePackText($('#import-text').value);
    if (parsed.questions.length === 0) throw new Error('No questions found in that text.');
    if ($('#import-append').checked) {
      const keep = pack.questions.filter((q) => q.question.trim() || q.answers.some((a) => String(a.text ?? '').trim()));
      pack.questions = [...keep, ...parsed.questions];
      if (!pack.name.trim()) pack.name = parsed.name;
      if (!fileTouched && !loadedFrom) file = filenameForName(pack.name);
      markDirty();
      renderAll();
    } else {
      if (!confirmDiscard()) return;
      loadPack(parsed, { markClean: false });
    }
    dlgImport.close();
    $('#import-text').value = '';
    const n = parsed.questions.length;
    const left = validatePack(cleanPack());
    toast(`Imported ${n} question${n === 1 ? '' : 's'}.${hasErrors(left) ? ' Check the red items before saving.' : ''}`);
  } catch (err) {
    const el = $('#import-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

// ── AI prompt dialog ─────────────────────────────────────────────────
const dlgPrompt = $('#dlg-prompt');
let templateText = '';

async function loadTemplate() {
  if (templateText) return templateText;
  const res = await fetch('/editor/ai-template.md');
  const md = await res.text();
  const cut = md.indexOf('\n---\n');
  templateText = (cut === -1 ? md : md.slice(cut + 5)).trim();
  return templateText;
}

function fillPrompt() {
  const topic = $('#p-topic').value.trim() || 'general family fun';
  const audience = $('#p-audience').value.trim() || 'Families with kids 8 and up';
  const count = Math.min(30, Math.max(1, Number($('#p-count').value) || 8));
  const name = $('#p-name').value.trim() || `${topic.replace(/\b\w/g, (c) => c.toUpperCase())} Edition`;
  $('#p-output').value = templateText
    .replaceAll('[[TOPIC]]', topic)
    .replaceAll('[[AUDIENCE]]', audience)
    .replaceAll('[[QUESTION_COUNT]]', String(count))
    .replaceAll('[[PACK_NAME]]', name);
}

$('#btn-ai-prompt').addEventListener('click', async () => {
  try {
    await loadTemplate();
  } catch {
    toast('Could not load the AI template.', 'error');
    return;
  }
  fillPrompt();
  dlgPrompt.showModal();
  $('#p-topic').focus();
});

for (const id of ['#p-topic', '#p-audience', '#p-count', '#p-name']) {
  $(id).addEventListener('input', fillPrompt);
}

$('#p-copy').addEventListener('click', async (e) => {
  e.preventDefault();
  fillPrompt();
  const ok = await copyText($('#p-output').value);
  toast(ok ? 'Prompt copied. Paste it into your AI, then use Import from AI.' : 'Copy failed — select the text and copy it.', ok ? 'ok' : 'error');
});

$('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Start ────────────────────────────────────────────────────────────
async function init() {
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    cloud = Boolean(info.cloud);
  } catch {
    cloud = false;
  }
  const badge = $('#mode-badge');
  badge.textContent = cloud ? 'Cloud · download only' : 'Saves to this game';
  badge.classList.toggle('mode-badge--cloud', cloud);
  $('#btn-save').title = cloud ? 'Saving is off on the cloud version — use Download .json' : 'Save into the game’s question folder';

  await refreshPackList();

  const draft = readDraft();
  if (draft?.pack && draft.dirty) {
    pack = normalizePack(draft.pack);
    // keep blank rows the user was typing into
    pack.questions = draft.pack.questions?.length ? draft.pack.questions.map((q) => ({
      question: String(q.question ?? ''),
      answers: (q.answers ?? []).map((a) => ({ text: String(a.text ?? ''), points: a.points ?? null })),
    })) : [blankQuestion()];
    file = draft.file ?? '';
    fileTouched = Boolean(draft.fileTouched);
    loadedFrom = draft.loadedFrom ?? null;
    dirty = true;
    renderAll();
    toast('Restored your unsaved work.');
  } else {
    renderAll();
  }
}

init();
