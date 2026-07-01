import { connect } from '../shared/ws.js';
import {
  playSound,
  stopAllMusic,
  setMasterVolume,
  configureSounds,
  activateAudio,
  isMusicPlaying,
  replayPendingSfx,
} from '../shared/audio.js';

const $ = (sel) => document.querySelector(sel);

let state = null;
let lastSoundAt = 0;
let lastAnimatedAt = 0;
let soundCueInFlight = false;
let lastStrikeCount = 0;
let lastStrikeAnimatedAt = 0;
let strikeAnimating = false;
let lastWalkupActionAt = 0;
let lastWalkupCueAt = 0;
let lastBoardSnapshot = '';
let flipAnimatingAnswerId = null;
const ROUND_END_REVEAL_DELAY_MS = 2800;
let roundEndRevealTimer = null;
let roundEndRevealScheduledAt = 0;
let roundEndWinScheduledAt = 0;
let roundEndWinTimer = null;

function scheduleRoundEndReveal() {
  const action = state?.lastAction;
  if (!state?.round?.pendingRoundEnd) return;
  if (!action || !['board_cleared', 'steal_won'].includes(action.type)) return;
  if (action.answerId == null) return;
  if (action.at <= roundEndRevealScheduledAt) return;

  roundEndRevealScheduledAt = action.at;
  clearTimeout(roundEndRevealTimer);

  const elapsed = Date.now() - action.at;
  const delay = Math.max(0, ROUND_END_REVEAL_DELAY_MS - elapsed);
  const fireRoundEnd = () => {
    roundEndRevealTimer = null;
    fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'show_round_end' }),
    }).catch(() => {});
  };

  if (delay === 0) {
    fireRoundEnd();
    return;
  }

  roundEndRevealTimer = setTimeout(fireRoundEnd, delay);
}

function scheduleRoundEndWinAfterStealFail() {
  const action = state?.lastAction;
  if (state?.phase !== 'round_end' || state?.round?.confirmed) return;
  if (action?.type !== 'steal_failed') return;
  if (action.at <= roundEndWinScheduledAt) return;

  roundEndWinScheduledAt = action.at;
  clearTimeout(roundEndWinTimer);
  roundEndWinTimer = setTimeout(async () => {
    roundEndWinTimer = null;
    if (state?.lastAction?.at !== action.at || state?.phase !== 'round_end') return;
    const vol = state.setup?.volume ?? 0.7;
    configureSounds(state.setup?.sounds);
    setMasterVolume(vol);
    const played = await playSound('win', { volume: vol });
    if (played) lastSoundAt = Math.max(lastSoundAt, Date.now());
  }, 850);
}

function boardSnapshot() {
  if (!state?.round) return '';
  const answers = state.round.answers.map((a) => `${a.id}:${Number(a.revealed)}`).join('|');
  return `${state.round.questionRevealed}|${state.round.question}|${answers}`;
}

function teamById(id) {
  return state?.setup?.teams?.find((t) => t.id === id);
}

function activeTeamIds() {
  if (!state?.setup?.teams) return [];
  if (state.phase === 'faceoff') {
    return state.setup.teams.map((t) => t.id);
  }
  if (state.phase === 'steal' && state.round?.controllingTeamId) {
    const other = state.setup.teams.find((t) => t.id !== state.round.controllingTeamId);
    return other ? [other.id] : [];
  }
  if (['playing', 'walkup'].includes(state.phase) && state.round?.controllingTeamId) {
    return [state.round.controllingTeamId];
  }
  return [];
}

function turnBadge(isFaceoff, isSteal) {
  if (isSteal) return 'STEAL!';
  if (isFaceoff) return 'FACE-OFF';
  return 'UP NOW';
}

function turnSlotClasses(isActive, isFaceoff, isSteal, turnLive) {
  return [
    isActive && isFaceoff ? 'board-hud__slot--faceoff' : '',
    isActive && !isFaceoff ? 'board-hud__slot--active' : '',
    isActive && isSteal ? 'board-hud__slot--steal' : '',
    turnLive && !isActive ? 'board-hud__slot--waiting' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function renderScores() {
  if (!state?.setup?.teams?.length) return;

  const teams = state.setup.teams;
  const [teamA, teamB] = teams;
  const active = new Set(activeTeamIds());
  const isFaceoff = state.phase === 'faceoff';
  const isSteal = state.phase === 'steal';
  const turnLive = active.size > 0;
  const playPhases = ['faceoff', 'walkup', 'playing', 'steal', 'round_end'];
  const showHud = playPhases.includes(state.phase);

  const scoreA = $('#hud-score-a');
  const scoreB = $('#hud-score-b');
  const turnA = $('#hud-turn-a');
  const turnB = $('#hud-turn-b');
  const roundScore = $('#hud-round-score');

  if (!showHud || !scoreA || !scoreB || !turnA || !turnB || !roundScore) return;

  const scoreValA = state.game?.scores?.[teamA.id] ?? 0;
  const scoreValB = state.game?.scores?.[teamB.id] ?? 0;

  scoreA.className = `board-hud__slot hud-score-a board-hud__score`;
  scoreB.className = `board-hud__slot hud-score-b board-hud__score`;
  scoreA.textContent = scoreValA;
  scoreB.textContent = scoreValB;
  roundScore.textContent = state.round?.roundPoints ?? 0;

  renderTeamNameSlot(turnA, teamA, 'hud-turn-a', active.has(teamA.id), isFaceoff, isSteal, turnLive);
  renderTeamNameSlot(turnB, teamB, 'hud-turn-b', active.has(teamB.id), isFaceoff, isSteal, turnLive);
}

function renderTeamNameSlot(el, team, posClass, isActive, isFaceoff, isSteal, turnLive) {
  const badge = isActive
    ? `<span class="board-hud__badge">${turnBadge(isFaceoff, isSteal)}</span>`
    : '';
  const emoji = team.emoji ? `<span class="board-hud__emoji">${team.emoji}</span>` : '';
  el.className = `board-hud__slot ${posClass} board-hud__name ${turnSlotClasses(
    isActive,
    isFaceoff,
    isSteal,
    turnLive,
  )}`;
  el.style.setProperty('--team-color', team.color);
  el.innerHTML = `${badge}<span class="board-hud__team-line">${emoji}<span class="board-hud__team-name">${escapeHtml(team.name)}</span></span>`;
}

function strikeBoardHtml(n) {
  return [1, 2, 3]
    .map(
      (i) =>
        `<span class="strike-box${i <= n ? ' active' : ''}"><span class="strike-x">X</span></span>`,
    )
    .join('');
}

function strikeCenterHtml(n) {
  return Array.from(
    { length: n },
    () => '<span class="strike-box active"><span class="strike-x">X</span></span>',
  ).join('');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldAnimateStrike() {
  const action = state?.lastAction;
  if (!action || action.type !== 'strike' || action.faceoff) return false;
  if (action.at <= lastStrikeAnimatedAt) return false;
  return true;
}

function waitTransition(el, ms = 900) {
  return Promise.race([
    new Promise((resolve) => {
      el.addEventListener('transitionend', resolve, { once: true });
    }),
    delay(ms),
  ]);
}

async function playStrikeAnimation(n) {
  if (strikeAnimating) return;
  strikeAnimating = true;

  const flyer = $('#strikes-flyer');
  const normal = $('#hud-strikes-normal');
  const slot = $('#strikes');

  try {
    flyer.innerHTML = strikeCenterHtml(n);
    flyer.classList.remove('is-flying');
    flyer.classList.add('is-active');
    flyer.style.cssText = '';
    normal?.classList.add('strikes-normal--hidden-during-fly');

    await delay(1650);

    const fromRect = flyer.getBoundingClientRect();
    const toRect = slot.getBoundingClientRect();
    if (toRect.width < 1 || fromRect.width < 1) return;

    const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
    const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
    const scale = Math.min(toRect.width / fromRect.width, toRect.height / fromRect.height);

    flyer.classList.add('is-flying');
    flyer.style.position = 'fixed';
    flyer.style.left = `${fromRect.left + fromRect.width / 2}px`;
    flyer.style.top = `${fromRect.top + fromRect.height / 2}px`;
    flyer.style.transform = 'translate(-50%, -50%) scale(1)';
    flyer.style.transformOrigin = 'center center';
    flyer.style.zIndex = '100';

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    flyer.style.transition = 'transform 0.62s cubic-bezier(0.34, 1.08, 0.64, 1)';
    flyer.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`;

    await waitTransition(flyer);
  } finally {
    flyer.classList.remove('is-active', 'is-flying');
    flyer.style.cssText = '';
    flyer.innerHTML = '';
    normal?.classList.remove('strikes-normal--hidden-during-fly');
    strikeAnimating = false;
  }
}

function renderStrikes() {
  const normal = $('#hud-strikes-normal');
  const slot = $('#strikes');
  if (!normal || !slot) return;

  if (!state?.round || state.phase === 'faceoff') {
    normal.classList.add('hidden');
    slot.innerHTML = '';
    lastStrikeCount = 0;
    return;
  }

  normal.classList.remove('hidden');
  const n = state.round.strikes ?? 0;

  slot.innerHTML = strikeBoardHtml(n);

  const animate = n > lastStrikeCount && n > 0 && shouldAnimateStrike();
  if (animate) {
    lastStrikeAnimatedAt = state.lastAction.at;
    playStrikeAnimation(n);
  }

  lastStrikeCount = n;
}

function captureRevealAnimation() {
  const action = state?.lastAction;
  if (!action || action.answerId == null) return null;
  if (action.at <= lastAnimatedAt) return null;
  if (!['reveal', 'reveal_leftover', 'steal_won', 'board_cleared'].includes(action.type)) return null;
  lastAnimatedAt = action.at;
  return action.answerId;
}

function finishRevealFlip(face) {
  if (!face) return;
  face.classList.remove('just-revealed');
  face.classList.add('revealed');
}

function queueRevealFlip(board, answerId) {
  flipAnimatingAnswerId = answerId;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const row = board.querySelector(`.board-row[data-id="${answerId}"]`);
      const face = row?.querySelector('.board-row__face');
      if (!face || face.classList.contains('revealed')) {
        if (flipAnimatingAnswerId === answerId) flipAnimatingAnswerId = null;
        return;
      }

      void face.offsetWidth;
      face.classList.add('just-revealed');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        face.removeEventListener('animationend', onAnimEnd);
        finishRevealFlip(face);
        if (flipAnimatingAnswerId === answerId) flipAnimatingAnswerId = null;
      };

      const onAnimEnd = (e) => {
        if (e.target !== face || e.animationName !== 'board-flip-x') return;
        finish();
      };

      face.addEventListener('animationend', onAnimEnd);
      setTimeout(finish, 1050);
    });
  });
}

function renderBoard() {
  const board = $('#board');
  const roundLabel = $('#round-label');

  if (!state?.round) {
    board.innerHTML = '';
    lastBoardSnapshot = '';
    $('#question-text').textContent = '';
    $('#question-text')?.classList.add('hidden');
    $('#question-placeholder')?.classList.add('hidden');
    roundLabel.textContent = '';
    return;
  }

  const idx = (state.game?.roundIndex ?? 0) + 1;
  const total = state.game?.totalRounds ?? '?';
  roundLabel.textContent = `Round ${idx} of ${total}`;

  const questionEl = $('#question-text');
  const placeholder = $('#question-placeholder');
  if (state.round.questionRevealed) {
    questionEl.textContent = state.round.question;
    questionEl.classList.remove('hidden');
    placeholder?.classList.add('hidden');
  } else {
    questionEl.textContent = '';
    questionEl.classList.add('hidden');
    placeholder?.classList.remove('hidden');
  }

  const animateId = captureRevealAnimation();
  const snapshot = boardSnapshot();
  const boardChanged = snapshot !== lastBoardSnapshot;
  // Skip rebuild when only non-board state changed (e.g. soundCue cleared).
  const skipBoardRebuild = !boardChanged && animateId == null;
  const answers = state.round.answers;

  const renderSlot = (slotNum) => {
    const answer = answers[slotNum - 1];
    if (!answer) {
      return `<div class="board-row board-empty"></div>`;
    }
    const revealed = answer.revealed;
    const isNewFlip = revealed && animateId != null && answer.id === animateId;
    const faceClass = ['board-row__face', revealed && !isNewFlip ? 'revealed' : ''].filter(Boolean).join(' ');
    return `
      <div class="board-row" data-id="${answer.id}">
        <div class="${faceClass}">
          <span class="board-num">${slotNum}</span>
          <span class="board-answer">${revealed ? escapeHtml(answer.text) : ''}</span>
          <span class="board-points">${revealed ? answer.points : ''}</span>
        </div>
      </div>`;
  };

  const leftCol = [1, 2, 3, 4].map(renderSlot).join('');
  const rightCol = [5, 6, 7, 8].map(renderSlot).join('');

  if (!skipBoardRebuild) {
    lastBoardSnapshot = snapshot;
    board.innerHTML = `
      <div class="board-col">${leftCol}</div>
      <div class="board-col">${rightCol}</div>`;

    if (animateId != null) {
      queueRevealFlip(board, animateId);
    }
  }
}

function updateBoardMode() {
  const playPhases = ['faceoff', 'walkup', 'playing', 'steal', 'round_end'];
  const isPlay = playPhases.includes(state?.phase);
  const stage = $('#display-stage-inner');
  if (stage) stage.dataset.boardMode = isPlay ? 'play' : 'backdrop';
  $('#board-scene')?.setAttribute('aria-hidden', isPlay ? 'false' : 'true');
  $('#board')?.classList.toggle('hidden', !isPlay || !state?.round);
}

function renderPhaseScreens() {
  const screens = {
    setup: $('#screen-setup'),
    intro: $('#screen-intro'),
    rules: $('#screen-rules'),
    round_end: $('#screen-round-end'),
    game_end: $('#screen-game-end'),
  };

  Object.values(screens).forEach((el) => el?.classList.add('hidden'));

  updateBoardMode();

  if (state?.phase === 'setup') {
    screens.setup.classList.remove('hidden');
    $('#setup-title').textContent = state.setup?.title || 'Family Feud';
  }

  if (state?.phase === 'intro') {
    screens.intro.classList.remove('hidden');
    $('#intro-title').textContent = state.setup.title || 'Family Feud';
  }

  if (state?.phase === 'rules') {
    screens.rules.classList.remove('hidden');
    $('#rules-body').textContent = state.setup.rulesText || '';
  }

  if (state?.phase === 'round_end' && state.round && !state.round.confirmed) {
    screens.round_end.classList.remove('hidden');
    const winner = teamById(state.round.roundWinnerId ?? state.round.controllingTeamId);
    $('#round-end-title').textContent = winner ? `${winner.name} wins the round!` : 'Round over';
    $('#round-end-points').textContent = state.round.roundPoints
      ? `+${state.round.roundPoints} points`
      : '';
  }

  if (state?.phase === 'game_end') {
    screens.game_end.classList.remove('hidden');
    renderGameEnd();
  }
}

function renderGameEnd() {
  const teams = [...state.setup.teams].sort(
    (a, b) => (state.game.scores[b.id] ?? 0) - (state.game.scores[a.id] ?? 0),
  );
  const winner = teams[0];
  $('#game-end-title').textContent = `${winner.name} wins!`;
  $('#game-end-scores').innerHTML = teams
    .map(
      (t) =>
        `<div class="final-score" style="--team-color: ${t.color}">${escapeHtml(t.name)}: ${state.game.scores[t.id] ?? 0}</div>`,
    )
    .join('');
}

async function clearSoundCueOnServer() {
  // Avoid a follow-up render on this client; the WebSocket broadcast is only
  // for other tabs. Rebuilding the board here was cancelling flip animations.
  if (state?.soundCue) state = { ...state, soundCue: null };
  try {
    await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_sound' }),
    });
  } catch {
    // ignore
  }
}

async function syncLoopMusic() {
  if (!state?.setup) return;

  const loopPhase = state.phase;
  if (!['intro', 'rules'].includes(loopPhase)) {
    if (isMusicPlaying()) stopAllMusic();
    return;
  }

  if (isMusicPlaying()) return;
  const vol = state.setup.volume ?? 0.7;
  configureSounds(state.setup.sounds);
  setMasterVolume(vol);
  if (state.phase === 'intro') {
    await playSound('intro', { loop: true, volume: vol });
  } else if (state.phase === 'rules') {
    await playSound('rules', { loop: true, volume: vol * 0.35 });
  }
}

async function playWalkupSound() {
  if (!state?.setup) return false;
  soundCueInFlight = true;
  try {
    const vol = state.setup.volume ?? 0.7;
    configureSounds(state.setup.sounds);
    setMasterVolume(vol);
    stopAllMusic();
    return !!(await playSound('walkup', { loop: false, volume: vol * 0.6 }));
  } finally {
    soundCueInFlight = false;
  }
}

async function tryPlayWalkupCue() {
  const cue = state?.soundCue;
  const walkupPhases = ['walkup', 'faceoff'];
  if (!walkupPhases.includes(state?.phase) || cue?.name !== 'walkup') return false;
  if (cue.at <= lastWalkupCueAt) return false;

  const played = await playWalkupSound();
  if (!played) return false;

  lastWalkupCueAt = cue.at;
  lastWalkupActionAt = state.lastAction?.at ?? cue.at;
  lastSoundAt = Math.max(lastSoundAt, cue.at);
  clearSoundCueOnServer();
  return true;
}

async function processDisplayAudio() {
  if (!state) return;

  if (await tryPlayWalkupCue()) return;

  if (state.soundCue?.at > lastSoundAt) {
    await handleSoundCue();
  } else {
    await syncLoopMusic();
  }
}

async function handleSoundCue() {
  if (!state?.soundCue || soundCueInFlight) return;
  const { name, at } = state.soundCue;
  if (name === 'walkup') return;
  if (at <= lastSoundAt) return;

  if (name === 'stop_music') {
    stopAllMusic();
    lastSoundAt = at;
    return;
  }

  soundCueInFlight = true;
  try {
    const vol = state.setup?.volume ?? 0.7;
    configureSounds(state.setup?.sounds);
    setMasterVolume(vol);

    let played = null;

    if (name === 'rules') {
      stopAllMusic();
      played = await playSound('rules', { loop: true, volume: vol * 0.35 });
    } else if (name === 'intro') {
      played = await playSound('intro', { loop: true, volume: vol });
    } else if (name === 'question') {
      played = await playSound('question', { volume: vol });
      if (played) clearSoundCueOnServer();
    } else if (name === 'already_answered') {
      played = await playSound('already_answered', { volume: vol });
      if (played) clearSoundCueOnServer();
    } else if (['ding', 'buzzer', 'win'].includes(name)) {
      played = await playSound(name, { volume: vol });
      if (played) clearSoundCueOnServer();
    } else {
      played = await playSound(name, { volume: vol });
    }

    if (played) {
      lastSoundAt = at;
    }
  } finally {
    soundCueInFlight = false;
  }
}

async function onDisplayActivated() {
  activateAudio();
  await processDisplayAudio();
  await replayPendingSfx();
}

function render() {
  if (!state) return;

  if (['round_reset', 'game_reset'].includes(state.lastAction?.type)) {
    lastStrikeCount = 0;
    lastStrikeAnimatedAt = 0;
    lastAnimatedAt = 0;
    lastBoardSnapshot = '';
    flipAnimatingAnswerId = null;
    roundEndRevealScheduledAt = 0;
    roundEndWinScheduledAt = 0;
    lastWalkupCueAt = 0;
    lastWalkupActionAt = 0;
    lastSoundAt = 0;
    clearTimeout(roundEndRevealTimer);
    clearTimeout(roundEndWinTimer);
    roundEndRevealTimer = null;
    roundEndWinTimer = null;
  }

  renderScores();
  renderStrikes();
  renderBoard();
  renderPhaseScreens();
  scheduleRoundEndReveal();
  processDisplayAudio().then(() => scheduleRoundEndWinAfterStealFail());

  document.body.dataset.phase = state.phase ?? '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

connect('display', (newState) => {
  state = newState;
  render();
});

document.addEventListener('pointerdown', () => {
  onDisplayActivated();
});

document.addEventListener('keydown', (e) => {
  onDisplayActivated();
  if (e.key === 'f') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
});
