# CLAUDE.md — Family Feud party game

Browser-based Family Feud for parties: **projector display** + **host controller**, synced via a local Node/Express + WebSocket server.

**Repo:** https://github.com/rosenauproductions/family-feud  
**Local path:** `/Users/christopherrosenau/Documents/GitHub/Family Feud`

## Quick start

```bash
npm install
npm start
# Display:    http://localhost:3456/display/
# Controller: http://localhost:3456/control/
# LAN:        http://feud.local:3456/...  (mDNS) or machine IP
```

Port: `PORT` env (default `3456`). Cloud/Render: `render.yaml` Blueprint; skip mDNS when `RENDER` is set.

## Architecture

| Piece | Role |
|-------|------|
| `server/index.js` | Express + `ws`, static `public/`, `/api/*` |
| `server/gameState.js` | Pure state machine (phases, round logic, sound cues) |
| `server/network.js` | LAN / mDNS URL helpers |
| `public/display/` | Projector UI + all game audio |
| `public/control/` | Host phone UI (setup + in-game actions) |
| `public/shared/` | `ws.js`, `audio.js`, `theme.css` |
| `data/questions/*.json` | Question packs (filename = dropdown label) |
| `extras/` | Pi systemd units + Chromium kiosk script |

**Clients:** Controller posts `/api/action`; display syncs via WebSocket. Audio plays **only on the display**.

### Phase flow

```
setup → intro → rules → [faceoff?] → walkup → playing → steal? → round_end → next / game_end
```

Service-ish dependency for audio cues: `soundCue` on state with `{ name, at }`. Display tracks `lastSoundAt` / `lastWalkupCueAt` to avoid replays.

### Board / HUD CSS knobs (`public/display/display.css`)

- Play scale: `--board-play-scale`
- Backdrop (setup/intro/rules): `--board-backdrop-scale`, `--board-backdrop-nudge-y`
- Setup/intro title offsets: `#screen-setup` / `#screen-intro` transforms
- Rules: `#screen-rules .screen-title` / `.rules-body` transforms + dark panel bg

## Question packs

Location: `data/questions/`. Format:

```json
{
  "name": "Pack Display Name",
  "questions": [
    {
      "question": "Name something…",
      "answers": [
        { "text": "Answer", "points": 42 }
      ]
    }
  ]
}
```

- Max **8 answers** per question (sliced in `cloneAnswers`)
- Default pack: `questionFile: '-Pairs.json'` in `defaultSetup()` (`gameState.js`)
- Current packs (filenames may start with `-`): Camping Trip, Lost items, Pairs, Spouse, Vacation, bro vs sis, fortnite, lord of the rings, minecraft
- After changing packs: commit + push so Render picks them up; local needs server restart / refresh controller

## Hard-won gotchas

1. **Walkup on Start round** — Cue walkup even when face-off is on; display must accept walkup during `faceoff` *and* `walkup` phases (`tryPlayWalkupCue`).
2. **Rules music lingering** — `syncLoopMusic()` must stop loop tracks when leaving `intro`/`rules`.
3. **Answer flip animation** — Flip the inner `.board-row__face` (`rotateX` only). Skip board rebuild on `clear_sound` when answers unchanged. Last answer: `pendingRoundEnd` + delay before `show_round_end`.
4. **Win music** — On round-end overlay (`showRoundEnd` sound cue), not on confirm. Failed steal: buzzer then win ~850ms later.
5. **Controller setup** — No Sounds panel / Party URLs UI (removed). Defaults in `DEFAULT_SOUNDS` still apply. Volume slider remains.
6. **Browser autoplay** — Display may need one click; Pi/Mac kiosk: `extras/pi-kiosk.sh` with `--autoplay-policy=no-user-gesture-required`.
7. **Netlify/static hosts** — Won’t work (needs Node + WebSockets). Use LAN Mac/Pi or Render/Railway/Fly.
8. **In-memory state** — Redeploy / Render sleep resets the game.
9. **Question filenames with spaces / leading `-`** — Supported; `path.basename` on load.

## When editing

- Game rules / phases → `server/gameState.js` + wire action in `server/index.js`
- Display look / animation → `public/display/display.css` / `display.js`
- Host UX → `public/control/control.js`
- New question pack → drop JSON in `data/questions/`, push for cloud
- New sound → file in `public/sounds/` matching `DEFAULT_SOUNDS` keys
- Deploy cloud → push `main`; Render uses `npm install` / `npm start`

## Deploy targets

| Target | How |
|--------|-----|
| Mac (party host) | `npm start`; phones use LAN IP or `feud.local` |
| Raspberry Pi | `extras/feud.service` + `extras/pi-kiosk.sh` / `feud-kiosk.service` |
| Render | Blueprint `render.yaml` or Web Service; free tier sleeps |

## Not implemented

- Fast Money
- Team image upload
- Tournament bracket UI

## Handoff notes (for next agent)

- Prefer LAN for parties; Render is for remote/share links.
- Always push question JSON changes if the live game is on Render.
- Keep display as sole audio client; don’t reintroduce controller SFX unless asked.
- User often iterates on CSS positioning (title/rules/board) in small px steps — match existing transform patterns.
