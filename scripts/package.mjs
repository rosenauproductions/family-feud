#!/usr/bin/env node
/**
 * Builds standalone, double-click Family Feud packages for macOS and Windows.
 *
 * Each zip holds a portable folder:
 *   Family Feud/
 *     Start Family Feud.command | Start Family Feud.bat   ← double-click this
 *     Question Packs/            ← host can add/edit JSON packs here
 *     Read Me First.txt
 *     app/                       ← server + public + production node_modules
 *     runtime/node | node.exe    ← bundled official Node.js (no install needed)
 *
 * Usage:
 *   node scripts/package.mjs                       # all targets, Node from nodejs.org
 *   node scripts/package.mjs --target win-x64      # one target
 *   node scripts/package.mjs --node-bin win-x64=/path/node.exe   # use a local binary
 *   NODE_DIST_VERSION=22.12.0 node scripts/package.mjs           # pin Node version
 *
 * Batocera: the zip unpacks into /userdata/roms/ports (the "share" over SMB):
 *   FamilyFeud.sh, FamilyFeud.sh.keys, familyfeud/{app,runtime,Question Packs}
 *
 * Output: dist/FamilyFeud-<target>.zip
 */
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const APP_NAME = 'Family Feud';

const TARGETS = {
  'mac-arm64': { os: 'mac', nodeDist: 'darwin-arm64', archive: 'tar.gz', label: 'Mac (Apple Silicon M1/M2/M3/M4)' },
  'mac-x64': { os: 'mac', nodeDist: 'darwin-x64', archive: 'tar.gz', label: 'Mac (Intel)' },
  'win-x64': { os: 'win', nodeDist: 'win-x64', archive: 'zip', label: 'Windows (64-bit)' },
  'batocera-x64': { os: 'batocera', nodeDist: 'linux-x64', archive: 'tar.gz', label: 'Batocera (x86_64 PC)' },
};

// Files from the repo that make up the app
const APP_FILES = ['server', 'public', 'package.json', 'package-lock.json'];

function parseArgs(argv) {
  const opts = { targets: [], nodeBins: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') opts.targets.push(argv[(i += 1)]);
    else if (arg === '--node-bin') {
      const [target, bin] = argv[(i += 1)].split('=');
      opts.nodeBins[target] = path.resolve(bin);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.targets.length === 0) opts.targets = Object.keys(TARGETS);
  for (const t of opts.targets) {
    if (!TARGETS[t]) throw new Error(`Unknown target "${t}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  }
  return opts;
}

function run(cmd, args, cwd = ROOT) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveNodeVersion() {
  if (process.env.NODE_DIST_VERSION) return process.env.NODE_DIST_VERSION.replace(/^v/, '');
  const index = JSON.parse((await fetchBuffer('https://nodejs.org/dist/index.json')).toString());
  const latest22 = index.find((r) => r.version.startsWith('v22.'));
  if (!latest22) throw new Error('Could not find a Node 22 release on nodejs.org');
  return latest22.version.slice(1);
}

/** Download + checksum-verify an official Node build and return the path to its binary */
async function downloadNode(target, version, workDir) {
  const { nodeDist, archive, os: targetOs } = TARGETS[target];
  const base = `node-v${version}-${nodeDist}`;
  const file = `${base}.${archive}`;
  const distUrl = `https://nodejs.org/dist/v${version}`;

  console.log(`  ↓ ${file}`);
  const [data, sums] = await Promise.all([
    fetchBuffer(`${distUrl}/${file}`),
    fetchBuffer(`${distUrl}/SHASUMS256.txt`).then((b) => b.toString()),
  ]);
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(' ')[0];
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${file}`);

  const archivePath = path.join(workDir, file);
  await fs.writeFile(archivePath, data);
  if (archive === 'zip') run('unzip', ['-q', archivePath, '-d', workDir]);
  else run('tar', ['-xzf', archivePath, '-C', workDir]);

  return targetOs === 'win'
    ? path.join(workDir, base, 'node.exe')
    : path.join(workDir, base, 'bin', 'node');
}

const MAC_LAUNCHER = `#!/bin/bash
# Double-click to start the Family Feud party server.
cd "$(dirname "$0")" || exit 1

# Files downloaded from the internet are flagged by macOS; clear the flag so the
# bundled Node.js runtime is allowed to start.
xattr -dr com.apple.quarantine . 2>/dev/null

export NODE_ENV=production
export FEUD_QUESTIONS_DIR="$PWD/Question Packs"
clear
./runtime/node app/server/index.js
echo
read -n 1 -s -r -p "Game server stopped. Press any key to close this window."
`;

const WIN_LAUNCHER = [
  '@echo off',
  'rem Double-click to start the Family Feud party server.',
  'title Family Feud',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'set "NODE_ENV=production"',
  'set "FEUD_QUESTIONS_DIR=%~dp0Question Packs"',
  'runtime\\node.exe app\\server\\index.js',
  'echo.',
  'echo Game server stopped.',
  'pause',
  '',
].join('\r\n');

const BATOCERA_LAUNCHER = `#!/bin/bash
# Family Feud - Batocera port launcher
# Starts the game server, opens the projector display full screen in Chrome,
# and stops the server again when you quit (Hotkey + Start).
DIR="$(dirname "$(readlink -f "$0")")/familyfeud"
NODE="$DIR/runtime/node"
LOG=/userdata/system/logs/familyfeud.log
PORT=3456
URL="http://localhost:$PORT/display/"
CHROME=/userdata/system/add-ons/google-chrome/GoogleChrome.AppImage

mkdir -p /userdata/system/logs
[ -f "$LOG" ] && cp -f "$LOG" "\${LOG%.log}.prev.log" 2>/dev/null
cd "$DIR" || { echo "missing $DIR" > "$LOG"; exit 1; }
{
  echo "=== Family Feud launch $(date) ==="
  # copying over the network share (SMB) can drop the executable bit: restore it
  [ -x "$NODE" ] || chmod +x "$NODE" 2>&1
  [ -f "$CHROME" ] && [ ! -x "$CHROME" ] && chmod +x "$CHROME" 2>&1
} > "$LOG" 2>&1

export NODE_ENV=production
export PORT
export FEUD_QUESTIONS_DIR="$DIR/Question Packs"

SERVER_PID=""
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/info"; then
  echo "server already running on port $PORT" >> "$LOG"
else
  if [ -x "$NODE" ]; then
    "$NODE" app/server/index.js >> "$LOG" 2>&1 &
  else
    echo "node not executable, starting via ld-linux" >> "$LOG"
    /lib64/ld-linux-x86-64.so.2 "$NODE" app/server/index.js >> "$LOG" 2>&1 &
  fi
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/api/info" && break
    sleep 0.25
  done
fi

if [ -f "$CHROME" ]; then
  echo "--- chrome ---" >> "$LOG"
  (
    # same environment the Batocera add-on uses to start Chrome from Ports
    if [ -r /proc/1/environ ]; then
      { while IFS= read -r -d '' kv; do export "$kv"; done < /proc/1/environ; } 2>/dev/null
    fi
    export DISPLAY=:0.0
    export HOME="/userdata/system/add-ons/google-chrome"
    "$CHROME" --no-sandbox --test-type --kiosk "$URL" \\
      --user-data-dir="$DIR/browser-profile" \\
      --autoplay-policy=no-user-gesture-required \\
      --no-first-run --no-default-browser-check --password-store=basic \\
      --disable-session-crashed-bubble --disable-infobars --noerrdialogs \\
      --disable-features=Translate --overscroll-history-navigation=0
  ) >> "$LOG" 2>&1
elif command -v flatpak >/dev/null 2>&1 && flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  echo "--- firefox (Chrome add-on not found) ---" >> "$LOG"
  flatpak run org.mozilla.firefox --kiosk "$URL" >> "$LOG" 2>&1
else
  echo "No browser found: install Google Chrome from Batocera Unofficial Add-ons" >> "$LOG"
fi
rc=$?

[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
echo "=== exit code $rc ===" >> "$LOG"
exit $rc
`;

// Hotkey + Start closes the browser (and with it the game), like the other ports
const BATOCERA_KEYS = `{
    "actions_player1": [
        { "trigger": ["hotkey", "start"], "type": "key", "target": ["KEY_LEFTALT", "KEY_F4"] }
    ]
}
`;

const BATOCERA_README = `FAMILY FEUD FOR BATOCERA
========================

INSTALL
  Unzip into the Batocera share's roms/ports folder
  (\\\\BATOCERA\\share\\roms\\ports  or  smb://<arcade>.local/share/roms/ports).
  Needs Google Chrome from Batocera Unofficial Add-ons (Firefox flatpak works as a fallback).
  Then in EmulationStation: Main Menu > Game Settings > Update Gamelists.

PLAY
  1. Ports > FamilyFeud. The game board opens full screen.
  2. Host: scan the QR code on screen with your phone (same Wi-Fi as the arcade).
  3. Quit: Hotkey + Start.

QUESTION PACKS
  Add or edit .json files in roms/ports/familyfeud/Question Packs over the share.

LOG
  system/logs/familyfeud.log (previous run: familyfeud.prev.log)
`;

function readMe(target) {
  const { os: targetOs, label } = TARGETS[target];
  const start = targetOs === 'mac' ? 'Start Family Feud.command' : 'Start Family Feud.bat';
  const firstRun = targetOs === 'mac'
    ? `FIRST TIME ON THIS MAC
  macOS may say it can't verify "${start}". If so:
    1. Click Done (not Move to Trash).
    2. Open System Settings > Privacy & Security, scroll down, click "Open Anyway".
    3. Double-click "${start}" again and choose Open.
  If macOS asks to allow "node" to accept incoming network connections, click Allow
  (phones can't reach the game otherwise).`
    : `FIRST TIME ON THIS PC
  - If Windows shows "Windows protected your PC", click "More info" then "Run anyway".
  - When Windows Firewall asks about Node.js, tick "Private networks" and click Allow.
    Phones can't reach the game otherwise. If your Wi-Fi is set to "Public network",
    tick that box too, or switch the Wi-Fi to Private in Settings > Network.`;

  const text = `FAMILY FEUD — PARTY EDITION (${label})
========================================

TO PLAY
  1. Double-click "${start}". A window opens showing the game's addresses.
     Keep it open while you play; closing it stops the game.
  2. On this computer, open a browser to:  http://localhost:3456/display/
     Put that window on the TV/projector and press F for full screen.
     Click the screen once so the browser allows sound.
  3. Host: scan the QR code on the projector with your phone
     (phone and computer on the same Wi-Fi). That opens the controller.

QUESTION PACKS
  Add or edit .json files in the "Question Packs" folder, then refresh the
  controller page. Each file shows up in the pack list on the controller.

${firstRun}

TROUBLESHOOTING
  - Phone can't connect: make sure it's on the same Wi-Fi (not cellular, not a
    guest network) and try the other addresses listed in the window.
  - "Port 3456 is already in use": the game is already running in another window.
`;
  return targetOs === 'win' ? text.replace(/\n/g, '\r\n') : text;
}

async function buildApp(stageDir) {
  // Copy the app and install production dependencies once; it's pure JavaScript,
  // so the same node_modules works on every OS.
  const appDir = path.join(stageDir, 'app');
  await fs.mkdir(appDir, { recursive: true });
  for (const entry of APP_FILES) {
    await fs.cp(path.join(ROOT, entry), path.join(appDir, entry), { recursive: true });
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], appDir);
  return appDir;
}

async function packageTarget(target, appDir, nodeBin, version) {
  const { os: targetOs } = TARGETS[target];
  const stage = path.join(DIST, 'stage', target);
  await fs.rm(stage, { recursive: true, force: true });

  // Batocera ports live as <name>.sh + a folder beside it in roms/ports
  const isBatocera = targetOs === 'batocera';
  const topLevel = isBatocera ? ['FamilyFeud.sh', 'FamilyFeud.sh.keys', 'familyfeud'] : [APP_NAME];
  const folder = path.join(stage, isBatocera ? 'familyfeud' : APP_NAME);
  await fs.mkdir(path.join(folder, 'runtime'), { recursive: true });

  await fs.cp(appDir, path.join(folder, 'app'), { recursive: true });
  await fs.cp(path.join(ROOT, 'data', 'questions'), path.join(folder, 'Question Packs'), { recursive: true });

  const runtimeName = targetOs === 'win' ? 'node.exe' : 'node';
  await fs.copyFile(nodeBin, path.join(folder, 'runtime', runtimeName));
  if (targetOs !== 'win') await fs.chmod(path.join(folder, 'runtime', runtimeName), 0o755);

  if (targetOs === 'win') {
    await fs.writeFile(path.join(folder, 'Start Family Feud.bat'), WIN_LAUNCHER);
    await fs.writeFile(path.join(folder, 'Read Me First.txt'), readMe(target));
  } else if (targetOs === 'mac') {
    const launcher = path.join(folder, 'Start Family Feud.command');
    await fs.writeFile(launcher, MAC_LAUNCHER);
    await fs.chmod(launcher, 0o755);
    await fs.writeFile(path.join(folder, 'Read Me First.txt'), readMe(target));
  } else {
    const launcher = path.join(stage, 'FamilyFeud.sh');
    await fs.writeFile(launcher, BATOCERA_LAUNCHER);
    await fs.chmod(launcher, 0o755);
    await fs.writeFile(path.join(stage, 'FamilyFeud.sh.keys'), BATOCERA_KEYS);
    await fs.writeFile(path.join(folder, 'README.txt'), BATOCERA_README);
  }
  await fs.writeFile(path.join(folder, 'app', 'VERSION.txt'), `node ${version}\nbuilt ${new Date().toISOString()}\n`);

  const zipPath = path.join(DIST, `FamilyFeud-${target}.zip`);
  await fs.rm(zipPath, { force: true });
  // zip keeps the executable bits macOS/Linux need for the launcher and runtime
  run('zip', ['-r', '-q', '-X', zipPath, ...topLevel], stage);
  const { size } = await fs.stat(zipPath);
  console.log(`  ✓ ${path.relative(ROOT, zipPath)} (${(size / 1e6).toFixed(1)} MB)`);
  return zipPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await fs.mkdir(DIST, { recursive: true });
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'feud-pack-'));

  const needsDownload = opts.targets.some((t) => !opts.nodeBins[t]);
  const version = needsDownload ? await resolveNodeVersion() : (process.env.NODE_DIST_VERSION ?? 'local');
  console.log(`Family Feud packages — Node ${version}`);

  const appDir = await buildApp(path.join(work, 'app-build'));
  for (const target of opts.targets) {
    console.log(`\n${target}`);
    const nodeBin = opts.nodeBins[target] ?? await downloadNode(target, version, work);
    if (!existsSync(nodeBin)) throw new Error(`Node binary not found: ${nodeBin}`);
    await packageTarget(target, appDir, nodeBin, version);
  }
  await fs.rm(path.join(DIST, 'stage'), { recursive: true, force: true });
  await fs.rm(work, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
