import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialState,
  applySetup,
  startGame,
  goToRules,
  beginRounds,
  stopMusic,
  setFaceOffWinner,
  skipFaceOff,
  startPlaying,
  revealQuestion,
  revealAnswer,
  addStrike,
  addAlreadyAnswered,
  stealCorrect,
  setRoundWinner,
  confirmRound,
  nextRound,
  resetRound,
  resetGame,
  resetToSetup,
  setPhase,
  clearSoundCue,
  showRoundEnd,
} from './gameState.js';
import { MDNS_NAME, networkInfo } from './network.js';
import { Bonjour } from 'bonjour-service';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// Standalone packages point this at a top-level "Question Packs" folder the host can edit
const QUESTIONS_DIR = process.env.FEUD_QUESTIONS_DIR || path.join(ROOT, 'data', 'questions');
const SOUNDS_DIR = path.join(ROOT, 'public', 'sounds');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3456;
const IS_CLOUD = Boolean(process.env.RENDER);

let state = createInitialState();
state.phase = 'setup';

const clients = new Set();

function broadcast() {
  const payload = JSON.stringify({ type: 'state', state: publicState() });
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function publicState() {
  return {
    ...state,
    clients: {
      display: [...clients].filter((c) => c.role === 'display').length,
      control: [...clients].filter((c) => c.role === 'control').length,
    },
  };
}

function updateConnectionFlags() {
  state = {
    ...state,
    displayConnected: [...clients].some((c) => c.role === 'display'),
    controlConnected: [...clients].some((c) => c.role === 'control'),
  };
}

async function loadQuestionPack(filename) {
  const safe = path.basename(filename);
  const filePath = path.join(QUESTIONS_DIR, safe);
  const raw = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.questions)) {
    throw new Error('Invalid question pack: missing questions array');
  }
  return data.questions;
}

async function listQuestionFiles() {
  const entries = await fs.readdir(QUESTIONS_DIR);
  return entries.filter((f) => f.endsWith('.json')).sort();
}

async function listSoundFiles() {
  const entries = await fs.readdir(SOUNDS_DIR);
  return entries.filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f)).sort();
}

function handleAction(action, payload = {}) {
  switch (action) {
    case 'update_setup':
      state = applySetup(state, payload.setup ?? {});
      break;
    case 'start_game':
      return loadQuestionPack(state.setup.questionFile).then((questions) => {
        state = startGame(state, questions);
        if (state.setup.skipIntro) {
          state = { ...state, phase: 'rules' };
        }
      });
    case 'go_rules':
      state = goToRules(state);
      break;
    case 'skip_intro':
      state = stopMusic(state);
      state = goToRules(state);
      break;
    case 'begin_rounds':
      state = beginRounds(state);
      break;
    case 'stop_music':
      state = stopMusic(state);
      break;
    case 'faceoff_winner':
      state = setFaceOffWinner(state, payload.teamId);
      break;
    case 'skip_faceoff':
      state = skipFaceOff(state, payload.teamId);
      break;
    case 'start_playing':
      state = startPlaying(state);
      break;
    case 'reveal_question':
      state = revealQuestion(state);
      break;
    case 'reveal':
      state = revealAnswer(state, payload.answerId);
      break;
    case 'strike':
      state = addStrike(state, payload.reason ?? 'wrong');
      break;
    case 'already_answered':
      state = addAlreadyAnswered(state);
      break;
    case 'steal_correct':
      state = stealCorrect(state, payload.answerId);
      break;
    case 'set_round_winner':
      state = setRoundWinner(state, payload.teamId);
      break;
    case 'confirm_round':
      state = confirmRound(state);
      break;
    case 'next_round':
      state = nextRound(state);
      break;
    case 'reset_round':
      state = resetRound(state);
      break;
    case 'reset_game':
      state = resetGame(state);
      break;
    case 'reset_setup':
      state = resetToSetup(state);
      break;
    case 'set_phase':
      state = setPhase(state, payload.phase);
      break;
    case 'show_round_end':
      state = showRoundEnd(state);
      break;
    case 'clear_sound':
      state = clearSoundCue(state);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/state', (_req, res) => {
  res.json(publicState());
});

app.get('/api/question-files', async (_req, res) => {
  try {
    const files = await listQuestionFiles();
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sound-files', async (_req, res) => {
  try {
    const files = await listSoundFiles();
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/info', (_req, res) => {
  res.json({ ...networkInfo(PORT), cloud: IS_CLOUD });
});

/** QR code for the host controller on the LAN (local installs only) */
app.get('/api/control-qr.svg', async (_req, res) => {
  const { controlUrl } = networkInfo(PORT);
  if (IS_CLOUD || !controlUrl) {
    res.status(404).end();
    return;
  }
  try {
    const svg = await QRCode.toString(controlUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'no-store').type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/action', async (req, res) => {
  try {
    const { action, ...payload } = req.body;
    await handleAction(action, payload);
    broadcast();
    res.json({ ok: true, state: publicState() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/', (_req, res) => {
  res.redirect('/display/');
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
// ws re-emits the HTTP server's errors; server.on('error') below handles them
wss.on('error', () => {});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  ws.role = url.searchParams.get('role') === 'control' ? 'control' : 'display';
  clients.add(ws);
  updateConnectionFlags();
  ws.send(JSON.stringify({ type: 'state', state: publicState() }));
  broadcast();

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'action') {
        await handleAction(msg.action, msg);
        broadcast();
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    updateConnectionFlags();
    broadcast();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  Port ${PORT} is already in use — Family Feud may already be running.`);
    console.error(`  Open http://localhost:${PORT}/display/ or close the other window and try again.`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', async () => {
  const info = networkInfo(PORT);
  const files = await listQuestionFiles();
  const cloudBase = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');

  if (!IS_CLOUD) {
    try {
      // Without an error callback, bonjour-service throws on mDNS socket errors
      // (common on Windows when port 5353 is busy) and takes the game server down.
      const bonjour = new Bonjour({}, (err) => {
        console.warn('  mDNS: feud.local unavailable —', err.message, '(use the IP address instead)');
      });
      bonjour.publish({
        name: MDNS_NAME,
        type: 'http',
        port: PORT,
      });
    } catch (err) {
      console.warn('  mDNS: could not advertise (feud.local may not resolve):', err.message);
    }
  }

  console.log('');
  console.log('  Family Feud — party server');
  console.log('  ─────────────────────────');
  if (cloudBase) {
    console.log(`  Display:    ${cloudBase}/display/`);
    console.log(`  Controller: ${cloudBase}/control/`);
  } else {
    const primary = info.lanUrl ?? `http://localhost:${PORT}`;
    console.log(`  Display (this computer): http://localhost:${PORT}/display/`);
    console.log(`  Host controller (phone): ${primary}/control/`);
    console.log('');
    console.log('  The projector screen shows a QR code for the controller.');
    console.log('  Phone and this computer must be on the same Wi-Fi.');
    console.log('');
    console.log('  Other addresses to try:');
    for (const url of info.bases) {
      if (url !== primary) {
        console.log(`    ${url}/control/`);
      }
    }
    console.log('');
    console.log('  Keep this window open while you play. Close it to stop the game.');
  }
  console.log('');
  console.log(`  Question packs: ${files.join(', ')}`);
  console.log(`  Question pack folder: ${QUESTIONS_DIR}`);
  console.log('');
});
