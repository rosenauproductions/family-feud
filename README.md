# Family Feud — Party Game

Browser-based Family Feud for parties: **projector display** + **host controller** on phones, synced over a local Node server.

## Quick start

```bash
cd "/Users/christopherrosenau/Documents/GitHub/Family Feud"
npm install
npm start
```

Or use the helper script:

```bash
./start.sh
```

On your **party WiFi**, phones and the projector use:

| Screen | URL |
|--------|-----|
| **Projector** | http://feud.local:3456/display/ |
| **Host phone** | http://feud.local:3456/control/ |

`feud.local` is advertised via mDNS (like `pistomp.local`). Same WiFi required.

Fallbacks if `.local` doesn’t resolve: use your Mac’s IP from the terminal output, e.g. `http://192.168.1.42:3456/control/`.

| Screen | Local only |
|--------|------------|
| **Projector** | http://localhost:3456/display/ |
| **Host phone** | http://localhost:3456/control/ |

## Sounds

Place your audio files in `public/sounds/`:

| File | Used for |
|------|----------|
| `intro.mp3` | Intro screen (loop) |
| `rules.mp3` | Rules screen (loop, low volume) |
| `walkup.mp3` | Before each question (plays once) |
| `question.mp3` | Reveal question |
| `ding.mp3` | Correct answer reveal |
| `buzzer.mp3` | Wrong answer / strike |
| `already-answered.mp3` | Already answered (warning only — not a strike) |
| `win.mp3` | Round / game win |

Missing files fail silently in the browser.

On the **projector display**, audio tries to play unmuted on load. Strict browsers may still require one click — `activateAudio()` handles that as a fallback. For **sound on boot** (Pi or dev), launch the display with Chromium’s autoplay flag (see below).

Assign sounds per role in **Setup → Sounds** on the controller (dropdown picks from files in `public/sounds/`).

## Display images

| File | Role |
|------|------|
| `game-bg.jpg` or `game-bg.png` | Full-stage background (all phases) |
| `game-board.png` | Feud board frame — separate layer, scales by game mode |

The stage letterboxes to **16:9**. Menu phases (setup, intro, rules, game end) show the board smaller and dimmed; gameplay scales the board to fit at full brightness.

Tune board HUD alignment in `display.css` on `.board-scene__frame` (percentage vars).

## Question packs

JSON files in `data/questions/`. Example:

```json
{
  "name": "My Pack",
  "questions": [
    {
      "question": "Name something in a kitchen",
      "answers": [
        { "text": "Refrigerator", "points": 42 },
        { "text": "Stove", "points": 28 }
      ]
    }
  ]
}
```

Select a pack and round count in setup. Questions are shuffled by default.

## Game flow

1. **Setup** — teams, colors, icons, question pack, rounds, face-off toggle
2. **Intro** → **Rules** → **Round 1**
3. Optional **face-off** → **Reveal question** → **walk-up** → **play** (reveal / strike / steal)
4. **Round end** — assign winner, reveal leftovers, confirm, next round
5. **Game end** — new game

## Milestones

Tag gameplay-complete state (before display GUI polish):

```bash
git init   # if needed
git add -A
git commit -m "Gameplay milestone: core flow, audio, face-off, controller"
git tag -a milestone-v1-gameplay -m "Gameplay complete before display GUI pass"
```

Restore that snapshot later: `git checkout milestone-v1-gameplay`

## Development

```bash
npm run dev   # auto-restart on server changes
```

## Deploy on Render (cloud)

The app is a **Node web service** (HTTP + WebSockets). Render’s free tier works; expect a **~30s cold start** after idle sleep.

### Option A — Blueprint (easiest)

1. Push this repo to GitHub (already at `rosenauproductions/family-feud`).
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
3. Connect the `family-feud` repo — Render reads `render.yaml` automatically.
4. Click **Apply**. Wait for the deploy to finish.
5. Open your service URL:
   - **Display:** `https://YOUR-SERVICE.onrender.com/display/`
   - **Controller:** `https://YOUR-SERVICE.onrender.com/control/`

### Option B — Manual web service

1. **New** → **Web Service** → connect `rosenauproductions/family-feud`.
2. Settings:
   | Field | Value |
   |-------|-------|
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Health Check Path | `/display/` |
3. **Create Web Service**.

`PORT` is set by Render automatically. No extra env vars required.

### Cloud caveats

- **Same URL for everyone** — share the controller link; no `feud.local` on Render.
- **Game state is in memory** — redeploys or sleep/wake reset the game.
- **Audio** — the display browser may still need one tap for sound (autoplay policy).
- **Party at home?** A Mac or Pi on WiFi is still better than cloud (no sleep, lower latency).

## Raspberry Pi projector (sound on boot)

1. Copy the repo to the Pi (e.g. `/home/pi/family-feud`), run `npm install`, enable the game server:
   ```bash
   sudo cp extras/feud.service /etc/systemd/system/
   sudo systemctl enable --now feud
   ```
2. Launch the display in kiosk mode (autoplay allowed, no click needed):
   ```bash
   chmod +x extras/pi-kiosk.sh
   ./extras/pi-kiosk.sh
   ```
   Or install `extras/feud-kiosk.service` to start it on boot after the desktop loads.
3. Host phones join the Pi hotspot / WiFi and open `http://feud.local:3456/control/`.

`pi-kiosk.sh` passes `--autoplay-policy=no-user-gesture-required` to Chromium. On a Mac, the same script works for testing the projector experience.

## Not yet implemented

- Fast Money (separate module)
- Team image upload
- Tournament bracket UI
