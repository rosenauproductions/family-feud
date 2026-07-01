const DEFAULT_RULES = `• Two teams compete each round.
• The host reveals answers on the board when a team guesses correctly.
• Wrong answer (not on the board) = strike (3 strikes → steal).
• Already answered = warning only (no strike).
• Points from revealed answers go to the round winner.
• Most points after all rounds wins!`;

export const DEFAULT_SOUNDS = {
  intro: 'intro.mp3',
  rules: 'rules.mp3',
  walkup: 'walkup.mp3',
  question: 'question.mp3',
  ding: 'ding.mp3',
  buzzer: 'buzzer.mp3',
  already_answered: 'already-answered.mp3',
  win: 'win.mp3',
};

export function defaultSetup() {
  return {
    title: '',
    questionFile: 'sample.json',
    roundCount: 3,
    shuffleQuestions: true,
    skipIntro: false,
    faceOffEnabled: true,
    firstControlTeamId: 'a',
    rulesText: DEFAULT_RULES,
    volume: 0.7,
    sounds: { ...DEFAULT_SOUNDS },
    teams: [
      { id: 'a', name: 'Team A', color: '#2563eb', emoji: '🔵' },
      { id: 'b', name: 'Team B', color: '#dc2626', emoji: '🔴' },
    ],
  };
}

function cloneAnswers(answers) {
  return answers.slice(0, 8).map((a, index) => ({
    id: index,
    text: a.text,
    points: a.points,
    revealed: false,
  }));
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createInitialState() {
  return {
    phase: 'intro',
    setup: defaultSetup(),
    displayConnected: false,
    controlConnected: false,
    game: null,
    round: null,
    lastAction: null,
    soundCue: null,
  };
}

export function listQuestionFiles(questionsDir) {
  // populated by server
  return [];
}

export function applySetup(state, setupPatch) {
  const setup = {
    ...state.setup,
    ...setupPatch,
    sounds: {
      ...DEFAULT_SOUNDS,
      ...state.setup.sounds,
      ...(setupPatch.sounds ?? {}),
    },
  };
  return {
    ...state,
    setup,
    lastAction: { type: 'setup_updated', at: Date.now() },
  };
}

export function startGame(state, questions) {
  const { setup } = state;
  let selected = [...questions];

  if (setup.shuffleQuestions) {
    selected = shuffle(selected);
  }

  selected = selected.slice(0, setup.roundCount);

  if (selected.length === 0) {
    throw new Error('No questions available in selected pack');
  }

  const scores = Object.fromEntries(setup.teams.map((t) => [t.id, 0]));

  return {
    ...state,
    phase: setup.skipIntro ? 'rules' : 'intro',
    game: {
      scores,
      roundIndex: 0,
      totalRounds: selected.length,
      questions: selected,
      roundWinners: [],
    },
    round: null,
    lastAction: { type: 'game_started', at: Date.now() },
    soundCue: setup.skipIntro ? null : { name: 'intro', at: Date.now() },
  };
}

function buildRound(question, controllingTeamId) {
  return {
    question: question.question,
    questionRevealed: false,
    answers: cloneAnswers(question.answers),
    strikes: 0,
    controllingTeamId,
    phase: 'walkup',
    roundPoints: 0,
    roundWinnerId: null,
    confirmed: false,
    stealAttempted: false,
    walkupPlayed: false,
    pendingRoundEnd: false,
  };
}

function cueWalkupOnce(state) {
  if (!state.round || state.round.walkupPlayed) {
    return { ...state, soundCue: null };
  }
  return {
    ...state,
    round: { ...state.round, walkupPlayed: true },
    soundCue: { name: 'walkup', at: Date.now() },
  };
}

export function goToRules(state) {
  return {
    ...state,
    phase: 'rules',
    soundCue: { name: 'rules', at: Date.now() },
    lastAction: { type: 'phase_rules', at: Date.now() },
  };
}

function startRound(state, round, lastAction) {
  const faceOff = state.setup.faceOffEnabled;
  const base = {
    ...state,
    phase: faceOff ? 'faceoff' : 'walkup',
    round: {
      ...round,
      phase: faceOff ? 'faceoff' : 'walkup',
    },
    lastAction,
  };
  return cueWalkupOnce(base);
}

export function beginRounds(state) {
  if (!state.game) throw new Error('Game not started');

  const controllingTeamId = state.setup.faceOffEnabled
    ? null
    : state.setup.firstControlTeamId;

  const question = state.game.questions[state.game.roundIndex];
  const round = buildRound(question, controllingTeamId);

  return startRound(state, round, { type: 'round_started', at: Date.now() });
}

export function stopMusic(state) {
  return {
    ...state,
    soundCue: { name: 'stop_music', at: Date.now() },
    lastAction: { type: 'stop_music', at: Date.now() },
  };
}

export function setFaceOffWinner(state, teamId) {
  if (!state.round) throw new Error('No active round');
  return {
    ...state,
    phase: 'walkup',
    round: {
      ...state.round,
      controllingTeamId: teamId,
      phase: 'walkup',
      walkupPlayed: true,
    },
    soundCue: { name: 'walkup', at: Date.now() },
    lastAction: { type: 'faceoff_winner', teamId, at: Date.now() },
  };
}

export function skipFaceOff(state, teamId) {
  return setFaceOffWinner(state, teamId);
}

export function startPlaying(state) {
  if (!state.round?.controllingTeamId) {
    throw new Error('Controlling team not set');
  }
  return {
    ...state,
    phase: 'playing',
    round: { ...state.round, phase: 'playing' },
    soundCue: { name: 'stop_music', at: Date.now() },
    lastAction: { type: 'playing_started', at: Date.now() },
  };
}

export function revealQuestion(state) {
  if (!state.round) throw new Error('No active round');
  if (state.round.questionRevealed) return state;

  return {
    ...state,
    round: { ...state.round, questionRevealed: true },
    soundCue: { name: 'question', at: Date.now() },
    lastAction: { type: 'question_revealed', at: Date.now() },
  };
}

function allRevealed(round) {
  return round.answers.every((a) => a.revealed);
}

function sumRevealedPoints(round) {
  return round.answers.filter((a) => a.revealed).reduce((s, a) => s + a.points, 0);
}

export function revealAnswer(state, answerId) {
  if (!state.round) throw new Error('No active round');

  const round = { ...state.round, answers: state.round.answers.map((a) => ({ ...a })) };
  const answer = round.answers.find((a) => a.id === answerId);
  if (!answer) throw new Error('Answer not found');

  // Round over — reveal leftovers for the room (no scoring / strikes)
  if (state.phase === 'round_end' || round.confirmed) {
    if (answer.revealed) return state;
    answer.revealed = true;
    return {
      ...state,
      round,
      soundCue: { name: 'ding', at: Date.now() },
      lastAction: { type: 'reveal_leftover', answerId, at: Date.now() },
    };
  }

  if (answer.revealed) {
    return addAlreadyAnswered(state);
  }

  answer.revealed = true;
  round.roundPoints = sumRevealedPoints(round);

  if (allRevealed(round) && state.phase !== 'faceoff') {
    round.roundWinnerId = round.controllingTeamId;
    round.pendingRoundEnd = true;
    return {
      ...state,
      round,
      soundCue: { name: 'ding', at: Date.now() },
      lastAction: { type: 'board_cleared', answerId, at: Date.now() },
    };
  }

  return {
    ...state,
    round,
    soundCue: { name: 'ding', at: Date.now() },
    lastAction: { type: 'reveal', answerId, at: Date.now() },
  };
}

export function addAlreadyAnswered(state) {
  if (!state.round) throw new Error('No active round');

  return {
    ...state,
    soundCue: { name: 'already_answered', at: Date.now() },
    lastAction: { type: 'already_answered', at: Date.now() },
  };
}

export function addStrike(state, reason = 'wrong') {
  if (!state.round) throw new Error('No active round');
  return applyStrike(state, reason);
}

function applyStrike(state, reason) {
  if (state.phase === 'faceoff') {
    return {
      ...state,
      soundCue: { name: 'buzzer', at: Date.now() },
      lastAction: { type: 'strike', reason, faceoff: true, at: Date.now() },
    };
  }

  const round = { ...state.round };
  round.strikes = Math.min(3, round.strikes + 1);

  if (round.strikes >= 3 && round.phase !== 'steal' && !round.stealAttempted) {
    return {
      ...state,
      phase: 'steal',
      round: { ...round, phase: 'steal' },
      soundCue: { name: 'buzzer', at: Date.now() },
      lastAction: { type: 'strike', reason, steal: true, at: Date.now() },
    };
  }

  if (round.phase === 'steal') {
    round.roundWinnerId = round.controllingTeamId;
    round.stealAttempted = true;
    return {
      ...state,
      phase: 'round_end',
      round: { ...round, phase: 'round_end' },
      soundCue: { name: 'buzzer', at: Date.now() },
      lastAction: { type: 'steal_failed', at: Date.now() },
    };
  }

  return {
    ...state,
    round,
    soundCue: { name: 'buzzer', at: Date.now() },
    lastAction: { type: 'strike', reason, at: Date.now() },
  };
}

export function stealCorrect(state, answerId) {
  if (!state.round || state.round.phase !== 'steal') {
    throw new Error('Not in steal phase');
  }

  const otherTeamId = state.setup.teams.find((t) => t.id !== state.round.controllingTeamId)?.id;
  if (!otherTeamId) throw new Error('Other team not found');

  const round = { ...state.round, answers: state.round.answers.map((a) => ({ ...a })) };
  const answer = round.answers.find((a) => a.id === answerId);
  if (!answer) throw new Error('Answer not found');

  if (answer.revealed) {
    return addAlreadyAnswered(state);
  }

  answer.revealed = true;
  round.roundPoints = sumRevealedPoints(round);
  round.roundWinnerId = otherTeamId;
  round.stealAttempted = true;
  round.pendingRoundEnd = true;

  return {
    ...state,
    round,
    soundCue: { name: 'ding', at: Date.now() },
    lastAction: { type: 'steal_won', teamId: otherTeamId, answerId, at: Date.now() },
  };
}

export function showRoundEnd(state) {
  if (!state.round) throw new Error('No active round');
  if (state.phase === 'round_end') return state;
  if (!state.round.pendingRoundEnd) throw new Error('Round end is not pending');

  return {
    ...state,
    phase: 'round_end',
    round: { ...state.round, phase: 'round_end' },
    soundCue: { name: 'win', at: Date.now() },
    lastAction: { type: 'round_end_shown', at: Date.now() },
  };
}

export function setRoundWinner(state, teamId) {
  if (!state.round) throw new Error('No active round');
  return {
    ...state,
    round: { ...state.round, roundWinnerId: teamId },
    lastAction: { type: 'round_winner_set', teamId, at: Date.now() },
  };
}

export function confirmRound(state) {
  if (!state.round || !state.game) throw new Error('No active round');

  const winnerId = state.round.roundWinnerId ?? state.round.controllingTeamId;
  const points = state.round.roundPoints;

  const scores = { ...state.game.scores };
  scores[winnerId] = (scores[winnerId] ?? 0) + points;

  const roundWinners = [
    ...state.game.roundWinners,
    { roundIndex: state.game.roundIndex, teamId: winnerId, points },
  ];

  const game = { ...state.game, scores, roundWinners };

  return {
    ...state,
    phase: 'round_end',
    game,
    round: { ...state.round, confirmed: true, roundWinnerId: winnerId },
    lastAction: { type: 'round_confirmed', teamId: winnerId, points, at: Date.now() },
  };
}

export function nextRound(state) {
  if (!state.game) throw new Error('No game');

  const nextIndex = state.game.roundIndex + 1;
  if (nextIndex >= state.game.totalRounds) {
    return { ...state, phase: 'game_end' };
  }

  const controllingTeamId = state.setup.faceOffEnabled
    ? null
    : state.setup.firstControlTeamId;

  const question = state.game.questions[nextIndex];
  const round = buildRound(question, controllingTeamId);

  return startRound(
    { ...state, game: { ...state.game, roundIndex: nextIndex } },
    round,
    { type: 'next_round', at: Date.now() },
  );
}

export function resetRound(state) {
  if (!state.game) throw new Error('No game');

  const question = state.game.questions[state.game.roundIndex];
  const controllingTeamId = state.setup.faceOffEnabled
    ? null
    : state.setup.firstControlTeamId;
  const round = buildRound(question, controllingTeamId);

  const next = startRound(
    { ...state },
    round,
    { type: 'round_reset', at: Date.now() },
  );
  return next;
}

export function resetGame(state) {
  return {
    ...state,
    phase: 'setup',
    game: null,
    round: null,
    lastAction: { type: 'game_reset', at: Date.now() },
    soundCue: { name: 'stop_music', at: Date.now() },
  };
}

export function resetToSetup(state) {
  return {
    ...createInitialState(),
    setup: state.setup,
    controlConnected: state.controlConnected,
    displayConnected: state.displayConnected,
    phase: 'setup',
    lastAction: { type: 'reset_setup', at: Date.now() },
  };
}

export function setPhase(state, phase) {
  return { ...state, phase, lastAction: { type: 'phase', phase, at: Date.now() } };
}

export function clearSoundCue(state) {
  return { ...state, soundCue: null };
}

export function getTeam(state, teamId) {
  return state.setup.teams.find((t) => t.id === teamId);
}

export function getOtherTeamId(state, teamId) {
  return state.setup.teams.find((t) => t.id !== teamId)?.id;
}

export function autoRoundWinner(state) {
  if (!state.round) return null;
  if (state.round.roundWinnerId) return state.round.roundWinnerId;
  if (state.round.phase === 'steal' && state.round.stealAttempted) {
    return state.round.controllingTeamId;
  }
  if (allRevealed(state.round)) return state.round.controllingTeamId;
  return state.round.controllingTeamId;
}
