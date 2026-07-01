import { connect, sendAction } from '../shared/ws.js';
import { stopAllMusic } from '../shared/audio.js';

const $ = (sel) => document.querySelector(sel);
const EMOJIS = ['🔵', '🔴', '🟢', '🟡', '🟣', '🟠', '⭐', '🔥', '💎', '🎸', '🦁', '🐻'];

let state = null;
let questionFiles = [];
let setupDraft = null;

async function loadQuestionFiles() {
  try {
    const res = await fetch('/api/question-files');
    if (!res.ok) return;
    const data = await res.json();
    questionFiles = data.files ?? [];
  } catch {
    questionFiles = [];
  }
}

function teamById(id) {
  return state?.setup?.teams?.find((t) => t.id === id);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderConnection() {
  const el = $('#connection-status');
  if (!el) return;
  if (!state) {
    el.textContent = 'Connecting…';
    el.className = 'connection-status warn';
    return;
  }
  const displayOk = state?.clients?.display > 0 || state?.displayConnected;
  const parts = [`Phase: ${state?.phase ?? '—'}`];
  if (displayOk) {
    parts.push('Display ✓');
    el.className = 'connection-status ok';
  } else {
    parts.push('Display ✗');
    el.className = 'connection-status warn';
  }
  el.textContent = parts.join(' · ');
}

function getSetupDraft() {
  if (!setupDraft && state?.setup) {
    setupDraft = structuredClone(state.setup);
  }
  return setupDraft;
}

function renderSetup() {
  const setup = getSetupDraft();
  const app = $('#app');

  app.innerHTML = `
    <div class="panel">
      <h2>Game</h2>
      <div class="field">
        <label>Event title (optional)</label>
        <input id="f-title" value="${escapeHtml(setup.title)}" placeholder="Family Feud" />
      </div>
      <div class="field">
        <label>Question pack (JSON)</label>
        <select id="f-question-file">
          ${questionFiles
            .map(
              (f) =>
                `<option value="${escapeHtml(f)}" ${f === setup.questionFile ? 'selected' : ''}>${escapeHtml(f)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label>Number of rounds</label>
        <input id="f-round-count" type="number" min="1" max="20" value="${setup.roundCount}" />
      </div>
      <div class="field">
        <label><input id="f-shuffle" type="checkbox" ${setup.shuffleQuestions ? 'checked' : ''} /> Shuffle questions</label>
      </div>
      <div class="field">
        <label><input id="f-skip-intro" type="checkbox" ${setup.skipIntro ? 'checked' : ''} /> Skip intro</label>
      </div>
    </div>

    <div class="panel team-grid">
      ${setup.teams
        .map(
          (team) => `
        <div class="team-card" style="--team-color: ${team.color}">
          <h2>Team ${team.id.toUpperCase()}</h2>
          <div class="field">
            <label>Name</label>
            <input class="team-name" data-team="${team.id}" value="${escapeHtml(team.name)}" />
          </div>
          <div class="field">
            <label>Color</label>
            <input class="team-color" data-team="${team.id}" type="color" value="${team.color}" />
          </div>
          <div class="field">
            <label>Icon</label>
            <div class="emoji-picker" data-team="${team.id}">
              ${EMOJIS.map(
                (e) =>
                  `<button type="button" class="emoji-btn ${team.emoji === e ? 'selected' : ''}" data-emoji="${e}">${e}</button>`,
              ).join('')}
            </div>
          </div>
        </div>`,
        )
        .join('')}
    </div>

    <div class="panel">
      <h2>Rules</h2>
      <div class="field">
        <label><input id="f-faceoff" type="checkbox" ${setup.faceOffEnabled ? 'checked' : ''} /> Face-off each round</label>
      </div>
      <div class="field" id="first-control-wrap" ${setup.faceOffEnabled ? 'style="display:none"' : ''}>
        <label>First control (no face-off)</label>
        <select id="f-first-control">
          ${setup.teams
            .map(
              (t) =>
                `<option value="${t.id}" ${t.id === setup.firstControlTeamId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <details class="advanced">
        <summary>Custom rules text</summary>
        <div class="field">
          <textarea id="f-rules-text">${escapeHtml(setup.rulesText)}</textarea>
        </div>
      </details>
      <div class="field">
        <label>Volume</label>
        <input id="f-volume" type="range" min="0" max="1" step="0.05" value="${setup.volume}" />
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="btn-start-game">Start game</button>
    </div>`;

  bindSetupEvents();
}

function readSetupFromForm() {
  const setup = getSetupDraft();
  setup.title = $('#f-title').value.trim();
  setup.questionFile = $('#f-question-file').value;
  setup.roundCount = Math.max(1, parseInt($('#f-round-count').value, 10) || 3);
  setup.shuffleQuestions = $('#f-shuffle').checked;
  setup.skipIntro = $('#f-skip-intro').checked;
  setup.faceOffEnabled = $('#f-faceoff').checked;
  setup.firstControlTeamId = $('#f-first-control')?.value ?? 'a';
  setup.rulesText = $('#f-rules-text')?.value ?? setup.rulesText;
  setup.volume = parseFloat($('#f-volume').value);

  for (const input of document.querySelectorAll('.team-name')) {
    const team = setup.teams.find((t) => t.id === input.dataset.team);
    if (team) team.name = input.value.trim() || team.name;
  }
  for (const input of document.querySelectorAll('.team-color')) {
    const team = setup.teams.find((t) => t.id === input.dataset.team);
    if (team) team.color = input.value;
  }

  return setup;
}

function bindSetupEvents() {
  $('#f-faceoff')?.addEventListener('change', (e) => {
    $('#first-control-wrap').style.display = e.target.checked ? 'none' : '';
  });

  for (const picker of document.querySelectorAll('.emoji-picker')) {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.emoji-btn');
      if (!btn) return;
      const teamId = picker.dataset.team;
      const team = getSetupDraft().teams.find((t) => t.id === teamId);
      if (team) team.emoji = btn.dataset.emoji;
      picker.querySelectorAll('.emoji-btn').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  }

  $('#btn-start-game')?.addEventListener('click', async () => {
    const setup = readSetupFromForm();
    setupDraft = setup;
    try {
      await sendAction('update_setup', { setup });
      await sendAction('start_game');
      setupDraft = null;
    } catch (err) {
      alert(err.message);
    }
  });
}

function renderIntroControls() {
  return `
    <div class="panel">
      <h2>Intro</h2>
      <div class="btn-row">
        <button class="btn" id="btn-stop-music">Stop music</button>
        <button class="btn btn-primary" id="btn-skip-intro">Skip to rules</button>
      </div>
    </div>`;
}

function renderRulesControls() {
  return `
    <div class="panel">
      <h2>Rules</h2>
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-begin-rounds">Start round 1</button>
      </div>
    </div>`;
}

function renderQuestionControls() {
  const round = state.round;
  if (!round) return '';

  const revealed = round.questionRevealed;
  return `
    <div class="panel">
      <h2>Question</h2>
      <p class="host-question">${escapeHtml(round.question)}</p>
      ${revealed
        ? '<p class="phase-label">Revealed on display</p>'
        : `<p class="phase-label">Hidden on display until you reveal it</p>
           <div class="btn-row">
             <button class="btn btn-primary" id="btn-reveal-question">Reveal question</button>
           </div>`}
    </div>`;
}

function renderBoardControls(mode = 'play') {
  const round = state.round;
  if (!round) return '';

  const isSteal = mode === 'steal';
  const isFaceoff = mode === 'faceoff';
  const controlling = teamById(round.controllingTeamId);
  const otherTeam = state.setup.teams.find((t) => t.id !== round.controllingTeamId);

  const answersHtml = round.answers
    .map((a) => {
      const action = isSteal ? 'steal_correct' : 'reveal';
      return `
        <button class="answer-btn ${a.revealed ? 'revealed' : ''}" data-action="${action}" data-id="${a.id}" ${a.revealed && !isSteal ? 'disabled' : ''}>
          ${escapeHtml(a.text)}
          <span class="pts">${a.points}</span>
        </button>`;
    })
    .join('');

  const title = isFaceoff ? 'Face-off answers' : isSteal ? 'STEAL' : 'Board';
  const statusHtml = isFaceoff
    ? '<span class="status-chip">Tap answer to reveal on board</span>'
    : `<span class="status-chip">Strikes: ${round.strikes}/3</span>
        <span class="status-chip">Round pts: ${round.roundPoints}</span>
        ${controlling ? `<span class="status-chip" style="background:${controlling.color}">${escapeHtml(controlling.name)}</span>` : ''}`;

  return `
    <div class="panel">
      <h2>${title}</h2>
      <p class="phase-label">${statusHtml}</p>
      ${isSteal ? `<p>Stealing team: <strong>${escapeHtml(otherTeam?.name ?? '')}</strong> — one guess</p>` : ''}
      ${isFaceoff ? '<p class="phase-label">Reveal hits, warn on repeats, strike on misses.</p>' : ''}
      <div class="answer-list">${answersHtml}</div>
      <div class="btn-row" style="margin-top: 0.75rem">
        <button class="btn btn-duplicate" id="btn-duplicate">Already answered</button>
        <button class="btn btn-strike btn-danger" id="btn-strike">✕ Wrong / Strike</button>
      </div>
    </div>`;
}

function renderFaceOffControls() {
  const teams = state.setup.teams;
  return `
    ${renderQuestionControls()}
    ${renderBoardControls('faceoff')}
    <div class="panel">
      <h2>Give control to</h2>
      <p class="phase-label">Who won the face-off?</p>
      <div class="btn-row">
        ${teams
          .map(
            (t) =>
              `<button class="btn btn-primary faceoff-win" data-team="${t.id}" style="background: ${t.color}">${escapeHtml(t.name)}</button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function renderHostControls() {
  if (!state.game) return '';

  const canResetRound = state.round && !state.round.confirmed;

  return `
    <div class="panel panel--host">
      <h2>Host</h2>
      <div class="btn-row">
        ${canResetRound ? '<button class="btn btn-warn" id="btn-reset-round">Reset round</button>' : ''}
        <button class="btn btn-danger" id="btn-reset-game">Reset game</button>
      </div>
      ${canResetRound ? '' : '<p class="phase-label">Confirm round before starting the next — or reset the whole game.</p>'}
    </div>`;
}

function renderPlayControls() {
  return renderBoardControls(state.phase === 'steal' ? 'steal' : 'play');
}

function renderWalkupControls() {
  return `
    ${renderQuestionControls()}
    <div class="panel">
      <h2>Walk-up</h2>
      <p class="phase-label">Question on screen — stop music when ready</p>
      <div class="btn-row">
        <button class="btn" id="btn-stop-music">Stop music</button>
        <button class="btn btn-primary" id="btn-start-playing">Start playing</button>
      </div>
    </div>
    ${renderPlayControls()}`;
}

function renderRoundEndControls() {
  const round = state.round;
  const teams = state.setup.teams;
  const winnerId = round?.roundWinnerId ?? round?.controllingTeamId;

  const hiddenAnswers = round?.answers?.filter((a) => !a.revealed) ?? [];

  return `
    <div class="panel">
      <h2>Round end</h2>
      ${round?.confirmed ? '<p>Round confirmed.</p>' : `
        <div class="field">
          <label>Round winner</label>
          <select id="f-round-winner">
            ${teams.map((t) => `<option value="${t.id}" ${t.id === winnerId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <p>Round points to award: <strong>${round?.roundPoints ?? 0}</strong></p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btn-confirm-round">Confirm round</button>
        </div>
      `}
      ${hiddenAnswers.length ? `
        <h2 style="margin-top:1rem">Reveal leftovers</h2>
        <div class="answer-list">
          ${hiddenAnswers.map((a) => `
            <button class="answer-btn leftover" data-id="${a.id}">${escapeHtml(a.text)} <span class="pts">${a.points}</span></button>
          `).join('')}
        </div>
      ` : '<p>All answers revealed.</p>'}
      ${round?.confirmed ? `
        <div class="btn-row" style="margin-top: 1rem">
          ${state.game && state.game.roundIndex < state.game.totalRounds - 1
            ? '<button class="btn btn-primary" id="btn-next-round">Next round</button>'
            : '<button class="btn btn-primary" id="btn-end-game">End game</button>'}
        </div>
      ` : ''}
    </div>`;
}

function renderGameEndControls() {
  return `
    <div class="panel">
      <h2>Game over</h2>
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-new-game">New game (setup)</button>
      </div>
    </div>`;
}

function render() {
  if (!state) return;
  renderConnection();

  const playPhases = ['walkup', 'playing', 'steal', 'faceoff', 'round_end', 'game_end', 'intro', 'rules'];
  if (!playPhases.includes(state.phase) && state.phase !== 'setup') {
    // fallthrough
  }

  if (state.phase === 'setup' || (!state.game && state.phase !== 'intro' && state.phase !== 'rules')) {
    renderSetup();
    return;
  }

  const app = $('#app');
  let html = '';

  if (state.phase === 'intro') html += renderIntroControls();
  if (state.phase === 'rules') html += renderRulesControls();
  if (state.phase === 'faceoff') html += renderFaceOffControls();
  if (state.phase === 'walkup') html += renderWalkupControls();
  if (state.phase === 'playing' || state.phase === 'steal') {
    if (state.round && !state.round.questionRevealed) html += renderQuestionControls();
    html += renderPlayControls();
  }
  if (state.phase === 'round_end') html += renderRoundEndControls();
  if (state.phase === 'game_end') html += renderGameEndControls();

  if (state.game && !['setup', 'intro', 'rules'].includes(state.phase)) {
    html += renderHostControls();
  }

  app.innerHTML = html;
  bindPlayEvents();
  handleSoundCue();
}

function bindPlayEvents() {
  $('#btn-stop-music')?.addEventListener('click', () => {
    stopAllMusic();
    sendAction('stop_music');
  });

  $('#btn-skip-intro')?.addEventListener('click', () => sendAction('skip_intro'));
  $('#btn-begin-rounds')?.addEventListener('click', () => sendAction('begin_rounds'));
  $('#btn-reveal-question')?.addEventListener('click', () => sendAction('reveal_question'));
  $('#btn-start-playing')?.addEventListener('click', () => sendAction('start_playing'));

  document.querySelectorAll('.faceoff-win').forEach((btn) => {
    btn.addEventListener('click', () => sendAction('faceoff_winner', { teamId: btn.dataset.team }));
  });

  document.querySelectorAll('.answer-btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const answerId = parseInt(btn.dataset.id, 10);
      if (action === 'reveal') sendAction('reveal', { answerId });
      else if (action === 'steal_correct') sendAction('steal_correct', { answerId });
    });
  });

  document.querySelectorAll('.answer-btn.leftover').forEach((btn) => {
    btn.addEventListener('click', () => {
      sendAction('reveal', { answerId: parseInt(btn.dataset.id, 10) });
    });
  });

  $('#btn-strike')?.addEventListener('click', () => sendAction('strike'));
  $('#btn-duplicate')?.addEventListener('click', () => sendAction('already_answered'));

  $('#f-round-winner')?.addEventListener('change', (e) => {
    sendAction('set_round_winner', { teamId: e.target.value });
  });

  $('#btn-confirm-round')?.addEventListener('click', () => sendAction('confirm_round'));
  $('#btn-next-round')?.addEventListener('click', () => sendAction('next_round'));
  $('#btn-end-game')?.addEventListener('click', () => sendAction('set_phase', { phase: 'game_end' }));
  $('#btn-new-game')?.addEventListener('click', () => {
    setupDraft = state.setup ? structuredClone(state.setup) : null;
    sendAction('reset_setup');
  });

  $('#btn-reset-round')?.addEventListener('click', () => {
    if (window.confirm('Reset this round? Clears the board, strikes, and round points.')) {
      sendAction('reset_round');
    }
  });

  $('#btn-reset-game')?.addEventListener('click', () => {
    if (window.confirm('Reset the whole game? Returns to the setup screen — start again when ready.')) {
      sendAction('reset_game');
    }
  });
}

function handleSoundCue() {
  // Game audio plays on the projector display only
}

async function init() {
  connect('control', (newState) => {
    state = newState;
    if (state.phase === 'setup' && !setupDraft) {
      setupDraft = structuredClone(state.setup);
    }
    render();
  });

  await loadQuestionFiles();
  if (state) render();
}

init().catch((err) => {
  const el = $('#connection-status');
  if (el) {
    el.textContent = `Error: ${err.message}`;
    el.className = 'connection-status warn';
  }
  console.error(err);
});
