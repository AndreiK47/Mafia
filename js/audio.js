const files = {
  chat_message: 'chat_message.wav',
  day: 'day_theme.wav',
  error: 'error.wav',
  game_end: 'game_end.wav',
  lobby: 'lobby_theme.wav',
  night: 'night_ambience.wav',
  notification: 'notification.wav',
  phase_change: 'phase_change.wav',
  player_join: 'player_join.wav',
  role_reveal: 'role_reveal.wav',
  success: 'success.wav',
  ui_click: 'ui_click.wav',
  ui_hover: 'ui_hover.wav',
  vote: 'vote.wav',
};

let effectsEnabled = true;
let musicEnabled = true;
let unlocked = false;
let musicContext = 'lobby';
let musicPlayer;
let lastHoverAt = 0;

export function configureAudio(settings = {}) {
  effectsEnabled = settings.sound !== false;
  musicEnabled = settings.music !== false;
  syncMusic();
}

export function setSoundEnabled(enabled) {
  effectsEnabled = Boolean(enabled);
}

export function setMusicEnabled(enabled) {
  musicEnabled = Boolean(enabled);
  syncMusic();
}

export function setMusicContext(context) {
  musicContext = context === 'silent' ? 'silent' : files[context] ? context : 'lobby';
  syncMusic();
}

function syncMusic() {
  if (!musicPlayer) {
    musicPlayer = new Audio();
    musicPlayer.loop = true;
    musicPlayer.volume = 0.22;
    musicPlayer.addEventListener('error', () => { musicPlayer.pause(); });
  }
  if (!musicEnabled || !unlocked || musicContext === 'silent') {
    musicPlayer.pause();
    return;
  }
  const source = `/sounds/${files[musicContext] || files.lobby}`;
  if (musicPlayer.getAttribute('src') !== source) {
    musicPlayer.src = source;
    musicPlayer.load();
  }
  musicPlayer.play().catch(() => {});
}

export function unlockAudio() {
  unlocked = true;
  syncMusic();
}

export function playSound(name) {
  if (!effectsEnabled || !files[name] || !unlocked) return;
  if (name === 'ui_hover') {
    const now = Date.now();
    if (now - lastHoverAt < 140) return;
    lastHoverAt = now;
  }
  const sound = new Audio(`/sounds/${files[name]}`);
  sound.volume = name === 'ui_hover' || name === 'ui_click' ? 0.35 : 0.65;
  sound.play().catch(() => {});
}
