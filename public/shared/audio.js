const DEFAULT_SOUNDS = {
  intro: 'intro.mp3',
  rules: 'rules.mp3',
  walkup: 'walkup.mp3',
  question: 'question.mp3',
  ding: 'ding.mp3',
  buzzer: 'buzzer.mp3',
  already_answered: 'already-answered.mp3',
  win: 'win.mp3',
};

let soundFiles = { ...DEFAULT_SOUNDS };
let masterVolume = 0.7;
const musicTracks = new Set();
let activeWalkup = null;
let audioActivated = false;
let pendingSfx = null;
const mutedPending = new Set();

export function isAudioActivated() {
  return audioActivated;
}

export function isMusicPlaying() {
  return musicTracks.size > 0;
}

function unmuteElement(audio) {
  audio.muted = false;
  const vol = Number(audio.dataset.targetVolume);
  if (!Number.isNaN(vol)) {
    audio.volume = Math.max(0, Math.min(1, vol));
  }
}

function releaseMutedPending() {
  for (const audio of mutedPending) {
    unmuteElement(audio);
  }
  mutedPending.clear();
  for (const audio of musicTracks) {
    if (audio.muted) unmuteElement(audio);
  }
  if (activeWalkup?.muted) {
    unmuteElement(activeWalkup);
  }
}

/** Unmutes audio when a strict browser required muted autoplay first. */
export function activateAudio() {
  if (audioActivated) return;
  audioActivated = true;
  releaseMutedPending();
}

export function configureSounds(sounds) {
  soundFiles = { ...DEFAULT_SOUNDS, ...(sounds ?? {}) };
}

export function setMasterVolume(v) {
  masterVolume = v;
}

function soundSrc(name) {
  const file = soundFiles[name] ?? DEFAULT_SOUNDS[name];
  if (!file) return null;
  const safe = file.replace(/^.*[/\\]/, '');
  return `/sounds/${safe}`;
}

export function stopAllMusic() {
  for (const audio of musicTracks) {
    audio.pause();
    audio.currentTime = 0;
  }
  musicTracks.clear();
  if (activeWalkup) {
    activeWalkup.pause();
    activeWalkup.currentTime = 0;
    activeWalkup = null;
  }
}

async function beginPlayback(audio, targetVolume, { name, loop }) {
  if (audioActivated) {
    try {
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  audio.muted = false;
  audio.volume = targetVolume;
  try {
    await audio.play();
    audioActivated = true;
    releaseMutedPending();
    return true;
  } catch {
    audio.muted = true;
    audio.volume = 0;
  }

  try {
    await audio.play();
  } catch {
    pendingSfx = { name, loop, volume: targetVolume };
    return false;
  }

  mutedPending.add(audio);
  return true;
}

export async function playSound(name, { loop = false, volume = masterVolume } = {}) {
  const src = soundSrc(name);
  if (!src) return null;

  if (name === 'walkup') {
    if (activeWalkup) {
      activeWalkup.pause();
      activeWalkup.currentTime = 0;
    }
    loop = false;
  }

  const audio = new Audio(src);
  const targetVolume = Math.max(0, Math.min(1, volume));
  audio.dataset.targetVolume = String(targetVolume);
  audio.volume = targetVolume;
  audio.loop = loop;

  if (loop) {
    stopAllMusic();
  } else if (name === 'walkup') {
    stopAllMusic();
  }

  const started = await beginPlayback(audio, targetVolume, { name, loop });
  if (!started) return null;

  if (loop) {
    musicTracks.add(audio);
  }

  if (name === 'walkup') {
    activeWalkup = audio;
    audio.addEventListener('ended', () => {
      if (activeWalkup === audio) activeWalkup = null;
    });
  }

  if (!loop) {
    audio.addEventListener('ended', () => audio.remove());
    pendingSfx = null;
  }

  return audio;
}

export async function replayPendingSfx() {
  if (!pendingSfx) return null;
  const { name, loop, volume } = pendingSfx;
  pendingSfx = null;
  return playSound(name, { loop, volume });
}
