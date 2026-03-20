// ── main.js ─────────────────────────────────────────────────────
// Application controller — scenes, ambient, Spotify, Discord, Jam sync
// ──────────────────────────────────────────────────────────────

import { SCENES, getScene } from './scenes.js';
import { AmbientEngine } from './ambient.js';
import { SpotifyManager } from './spotify.js';
import { DiscordManager } from './discord.js';
import { JamSync } from './jam-sync.js';

const ambient = new AmbientEngine();
const spotify = new SpotifyManager();
const discord = new DiscordManager();
const jam = new JamSync();

let currentSceneId = 'rain';
let isDiscordActivity = false;
let ambientJamStarted = false;

const jamUserId = getOrCreateJamUserId();
let jamUserName = 'Guest';
let jamRoomId = 'global';
let jamState = null;
let isJamHost = false;
let jamSearchMode = 'songs';
let lastRemotePlaybackStamp = 0;
let lastHostPublishAt = 0;
let hostPublishTimer = null;

const HOST_PLAYBACK_PUBLISH_MS = 1500;
const REMOTE_SEEK_DRIFT_MS = 2000;
const LOCAL_QUEUE_KEY = 'lofi_local_queue_v1';
const HUD_MINIMAL_KEY = 'lofi_hud_minimal_v1';
const SPOTIFY_MANUAL_PENDING_KEY = 'spotify_manual_pending_v1';
const LOFI_RADIO_STATIONS = [
  {
    id: 'lofigirl',
    name: 'Lofi Girl - the classic',
    streamUrls: [
      'https://play.streamafrica.net/lofiradio',
      'https://ice2.somafm.com/groovesalad-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
  },
  {
    id: 'chillhop',
    name: 'Chillhop Music',
    streamUrls: [
      'https://stream.zeno.fm/f3wvbbqmdg8uv',
      'https://ice2.somafm.com/beatblender-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/@ChillhopMusic',
  },
  {
    id: 'college',
    name: 'College Music',
    streamUrls: [
      'https://stream.zeno.fm/0r0xa792kwzuv',
      'https://ice2.somafm.com/indiepop-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/@CollegeMusic',
  },
  {
    id: 'beats',
    name: 'Lofi Hip Hop beats',
    streamUrls: [
      'https://ice4.somafm.com/groovesalad-128-mp3',
      'https://ice2.somafm.com/beatblender-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/results?search_query=lofi+hip+hop+beats+live',
  },
  {
    id: 'jazzhop',
    name: 'Jazz Hop Cafe',
    streamUrls: [
      'https://ice2.somafm.com/illstreet-128-mp3',
      'https://ice2.somafm.com/fluid-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/results?search_query=jazz+hop+cafe+live',
  },
  {
    id: 'jazzyoutube',
    name: 'Jazz Cafe YouTube',
    streamUrls: [
      'https://ice2.somafm.com/illstreet-128-mp3',
      'https://ice2.somafm.com/fluid-128-mp3',
    ],
    fallbackUrl: 'https://www.youtube.com/watch?v=HuFYqnbVbzY',
  },
];

const $ = id => document.getElementById(id);

let localQueue = [];
let queueAutoAdvanceLock = false;
let pendingSpotifyManualAuthUrl = '';
let pendingSpotifyManualState = '';
let pendingSpotifyManualVerifier = '';

function savePendingSpotifyManualAuth() {
  try {
    const payload = {
      authUrl: pendingSpotifyManualAuthUrl || '',
      state: pendingSpotifyManualState || '',
      verifier: pendingSpotifyManualVerifier || '',
      createdAt: Date.now(),
    };
    localStorage.setItem(SPOTIFY_MANUAL_PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function clearPendingSpotifyManualAuth() {
  pendingSpotifyManualAuthUrl = '';
  pendingSpotifyManualState = '';
  pendingSpotifyManualVerifier = '';
  try {
    localStorage.removeItem(SPOTIFY_MANUAL_PENDING_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function restorePendingSpotifyManualAuth() {
  try {
    const raw = localStorage.getItem(SPOTIFY_MANUAL_PENDING_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    const createdAt = Number(parsed.createdAt || 0);
    const ageMs = createdAt ? (Date.now() - createdAt) : 0;
    // Spotify auth codes are short-lived; discard stale pending sessions.
    if (ageMs > 15 * 60 * 1000) {
      clearPendingSpotifyManualAuth();
      return;
    }

    pendingSpotifyManualAuthUrl = String(parsed.authUrl || '');
    pendingSpotifyManualState = String(parsed.state || '');
    pendingSpotifyManualVerifier = String(parsed.verifier || '');
  } catch {
    clearPendingSpotifyManualAuth();
  }
}

const SCENE_VIDEO_MAP = {
  beach: 'assets/scenes/beach-animated.mp4',
  rain: 'assets/scenes/rain-animated.mp4',
  cafe: 'assets/scenes/cafe-animated.mp4',
  forest: 'assets/scenes/swamp-animated.mp4',
  traffic: 'assets/scenes/city-rain-animated.mp4',
  nightsky: 'assets/scenes/nightsky-animated.mp4',
};

const DOM = {
  body: document.body,
  sceneBg: $('scene-bg'),
  sceneMediaVideo: $('scene-media-video'),
  sceneList: $('scene-list'),
  sceneEmoji: $('scene-emoji'),
  sceneName: $('scene-name'),
  sceneTagline: $('scene-tagline'),
  participants: $('participants'),
  btnConnect: $('btn-spotify-connect'),
  btnDisconnect: $('btn-disconnect-spotify'),
  npMini: $('now-playing-mini'),
  npMiniText: $('np-mini-text'),
  mixerChannels: $('mixer-channels'),
  btnAllOn: $('btn-all-on'),
  btnAllOff: $('btn-all-off'),
  trackArt: $('track-art'),
  trackName: $('track-name'),
  trackArtist: $('track-artist'),
  btnPlay: $('btn-play'),
  btnPrev: $('btn-prev'),
  btnNext: $('btn-next'),
  progressFill: $('progress-fill'),
  progressTrack: $('progress-track'),
  timeCurrent: $('time-current'),
  timeTotal: $('time-total'),
  musicVolume: $('music-volume'),
  ambientVolume: $('ambient-volume'),
  voteLabel: $('vote-label'),
  voteOptions: $('vote-options'),
  voteFooter: $('vote-footer'),
  roomChip: $('room-chip'),
  nicknameInput: $('nickname-input'),
  btnShareRoom: $('btn-share-room'),
  btnJamHost: $('btn-jam-host'),
  jamSearchInput: $('jam-search-input'),
  btnSearchSongs: $('btn-search-songs'),
  btnSearchMixes: $('btn-search-mixes'),
  btnJamSearch: $('btn-jam-search'),
  btnToggleHud: $('btn-toggle-hud'),
  btnHudRestore: $('btn-hud-restore'),
  searchModal: $('search-modal'),
  searchModalBackdrop: $('search-modal-backdrop'),
  searchModalTitle: $('search-modal-title'),
  searchModalResults: $('search-modal-results'),
  btnSearchModalClose: $('btn-search-modal-close'),
  jamSearchResults: $('jam-search-results'),
  lofiRadio: $('lofi-radio'),
  lofiRadioList: $('lofi-radio-list'),
  btnOpenWebRadio: $('btn-open-web-radio'),
  queueList: $('queue-list'),
  queueCount: $('queue-count'),
  btnQueueClear: $('btn-queue-clear'),
  toast: $('toast'),
};

const lofiRadioAudio = new Audio();
lofiRadioAudio.preload = 'none';

let lofiRadioStationIndex = 0;
let lofiRadioAutoSwitchGuard = false;
let lofiRadioCurrentStreamUrl = '';
let spotifyLinked = false;

async function init() {
  restorePendingSpotifyManualAuth();

  // Listen for Spotify auth code from popup window (Discord Activity compatibility)
  window.addEventListener('message', async event => {
    if (event.data?.type === 'spotify-auth-code') {
      console.log('[Spotify] Received auth code from popup');
      try {
        await spotify.handleCallback(event.data.code, event.data.state || null);
        showToast('Spotify connected');
        await connectSpotify();
      } catch (err) {
        console.error('Spotify auth failed:', err);
        showToast(`Spotify error: ${err.message}`);
      }
    } else if (event.data?.type === 'spotify-auth-error') {
      console.error('Spotify auth error from popup:', event.data.error);
      showToast(`Spotify auth error: ${event.data.error}`);
    }
  });

  buildSceneList();
  switchScene('rain', false);
  bindPlayerControls();
  bindVolumeControls();
  bindJamControls();
  bindQueueControls();
  bindHudControls();
  bindSearchModalControls();
  initLofiRadio();
  handleSpotifyCallback();
  loadLocalQueue();
  renderQueue();

  discord.onParticipantsChange = () => {
    discord.renderAvatars(DOM.participants);
    updateVoteFooter();
  };
  discord.onUserJoin = u => showToast(`🎵 ${u?.username || 'Someone'} joined!`);
  discord.onUserLeave = u => showToast(`👋 ${u?.name || 'Someone'} left`);

  isDiscordActivity = await discord.init();
  jamUserName = getJamDisplayName();
  setJamNickname(jamUserName);
  setupAmbientJamAutostart();

  if (isDiscordActivity || discord.isEmbeddedClient()) {
    isDiscordActivity = true;
    enableDiscordJamMode();
  }

  await initJamRoom();

  if (spotify.isLoggedIn()) {
    showToast('Spotify session found. Click Connect Spotify when you want it.');
  }
}

async function initJamRoom() {
  const params = new URLSearchParams(window.location.search);
  jamRoomId = (params.get('room') || 'global').toLowerCase();
  DOM.roomChip.textContent = `Room: ${jamRoomId}`;
  DOM.voteLabel.textContent = 'JAM SUGGESTIONS';

  jam.onState = state => {
    onJamState(state).catch(err => {
      console.warn('[Jam] Failed to process state:', err?.message || err);
    });
  };

  try {
    await jam.init(jamRoomId, jamUserId, jamUserName);
    await onJamState(jam.state);
  } catch (err) {
    console.warn('[Jam] Could not initialize room:', err?.message || err);
    DOM.voteOptions.innerHTML = '<div class="vote-empty">Jam backend unavailable. Ambient mode still works.</div>';
  }
}

function bindJamControls() {
  setJamSearchMode('songs');

  // Nickname input handler
  DOM.nicknameInput?.addEventListener('change', async (e) => {
    const nick = setJamNickname(e.target.value);
    if (!nick) return;

    // If already host, re-apply host so room state gets the updated hostName.
    if (isJamHost) {
      try {
        await jam.becomeHost();
      } catch {
        // Keep local nickname even if sync call fails.
      }
    }

    showToast(`Nickname set to "${nick}"`);
  });

  DOM.btnSearchSongs?.addEventListener('click', () => setJamSearchMode('songs'));
  DOM.btnSearchMixes?.addEventListener('click', () => setJamSearchMode('mixes'));

  DOM.btnShareRoom.addEventListener('click', async () => {
    const url = getRoomShareUrl();
    const copied = await copyText(url);
    if (copied) {
      showToast('Room link copied');
      return;
    }
    showToast('Copy failed. Sharing unavailable on this device.');
  });

  DOM.btnJamHost.addEventListener('click', async () => {
    try {
      if (isJamHost) {
        await jam.releaseHost();
        showToast('Released host role');
      } else {
        const chosenName = DOM.nicknameInput?.value || jamUserName || getJamDisplayName();
        setJamNickname(chosenName);
        await jam.becomeHost();
        const copied = await copyText(getRoomShareUrl());
        showToast(copied ? 'You are host. Room link copied.' : 'You are now the jam host');
      }
    } catch {
      showToast('Could not change host role');
    }
  });

  DOM.btnJamSearch.addEventListener('click', () => {
    runJamSearch().catch(err => {
      console.warn('[Jam] Search failed:', err?.message || err);
      showToast(err?.message || 'Search failed');
    });
  });

  DOM.jamSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runJamSearch().catch(err => showToast(err?.message || 'Search failed'));
    }
  });
}

function bindQueueControls() {
  DOM.btnQueueClear?.addEventListener('click', () => {
    if (!localQueue.length) return;
    localQueue = [];
    saveLocalQueue();
    renderQueue();
    showToast('Queue cleared');
  });
}

function bindSearchModalControls() {
  DOM.btnSearchModalClose?.addEventListener('click', closeSearchModal);
  DOM.searchModalBackdrop?.addEventListener('click', closeSearchModal);
}

function initLofiRadio() {
  if (!DOM.lofiRadioList) return;

  if (isDiscordActivity || discord.isEmbeddedClient()) {
    DOM.lofiRadio?.classList.add('discord-limited');
    const subtitleEl = DOM.lofiRadio?.querySelector('.lofi-radio-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = 'Discord Activity blocks external live radio streams';
    }
    if (DOM.btnOpenWebRadio) {
      DOM.btnOpenWebRadio.style.display = 'inline-flex';
      DOM.btnOpenWebRadio.addEventListener('click', async () => {
        const url = getRoomShareUrlForBase(window.__APP_BASE_URL__ || window.location.origin);
        const copied = await copyText(url);
        showToast(copied ? 'Web player link copied.' : 'Could not copy web player link.');
      });
    }
  }

  renderLofiRadioStations();

  lofiRadioAudio.addEventListener('play', () => {
    if (spotifyLinked) return;
    const station = LOFI_RADIO_STATIONS[lofiRadioStationIndex];
    if (!station) return;
    updateTrackUIWithRadio(station);
    updatePlayBtn(true);
    DOM.npMiniText.textContent = truncate(station.name, 22);
    DOM.npMini.style.display = 'flex';
    if (isJamHost) {
      maybePublishHostPlayback(true);
    }
  });

  lofiRadioAudio.addEventListener('pause', () => {
    if (spotifyLinked) return;
    updatePlayBtn(false);
    if (isJamHost) {
      maybePublishHostPlayback(true);
    }
  });

  lofiRadioAudio.addEventListener('error', () => {
    if (spotifyLinked) return;
    if (lofiRadioAutoSwitchGuard) return;

    lofiRadioAutoSwitchGuard = true;
    showToast('Station dropped. Switching...');
    const nextIndex = (lofiRadioStationIndex + 1) % LOFI_RADIO_STATIONS.length;
    playLofiStation(nextIndex, { allowExternalOpen: false }).catch(() => {}).finally(() => {
      setTimeout(() => { lofiRadioAutoSwitchGuard = false; }, 1200);
    });
  });

  updateLofiRadioTransportUI();
}

function renderLofiRadioStations() {
  if (!DOM.lofiRadioList) return;
  DOM.lofiRadioList.innerHTML = '';

  LOFI_RADIO_STATIONS.forEach((station, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lofi-radio-btn';
    btn.textContent = station.name;
    btn.classList.toggle('active', index === lofiRadioStationIndex);
    btn.addEventListener('click', async () => {
      try {
        await playLofiStation(index);
      } catch (err) {
        showToast(err?.message || 'Could not load station');
      }
    });
    DOM.lofiRadioList.appendChild(btn);
  });
}

function stopLofiRadio() {
  try {
    lofiRadioAudio.pause();
  } catch {
    // Ignore pause errors in restricted contexts.
  }
}

async function playLofiStation(index, options = {}) {
  void options;
  const station = LOFI_RADIO_STATIONS[index];
  if (!station) return;

  lofiRadioStationIndex = index;
  renderLofiRadioStations();

  if (spotifyLinked) {
    showToast('Disconnect Spotify to use The LO-FI Radio');
    return;
  }

  if (isDiscordActivity || discord.isEmbeddedClient()) {
    const url = getRoomShareUrlForBase(window.__APP_BASE_URL__ || window.location.origin);
    const copied = await copyText(url);
    showToast(copied ? 'Discord blocks these streams. Web player link copied.' : 'Discord blocks these streams. Could not copy web player link.');
    return;
  }

  const candidates = Array.isArray(station.streamUrls)
    ? station.streamUrls.filter(Boolean)
    : (station.streamUrl ? [station.streamUrl] : []);

  if (!candidates.length) {
    throw new Error('No stream configured for this station');
  }

  let started = false;
  for (const url of candidates) {
    try {
      await tryStartRadioStream(url);
      lofiRadioCurrentStreamUrl = url;
      started = true;
      break;
    } catch {
      // Try next backup stream.
    }
  }

  if (!started) {
    const fallback = station.fallbackUrl;
    if (fallback) {
      const copied = await copyText(fallback);
      throw new Error(copied ? 'Could not load station. Fallback link copied.' : 'Could not load station. Fallback available in station list.');
    }
    throw new Error('Could not load station');
  }

  updateTrackUIWithRadio(station);
  updateLofiRadioTransportUI();
  if (isJamHost) {
    maybePublishHostPlayback(true);
  }
  showToast(`Now playing: ${truncate(station.name, 22)}`);
}

async function tryStartRadioStream(url) {
  return new Promise(async (resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      lofiRadioAudio.removeEventListener('playing', onReady);
      lofiRadioAudio.removeEventListener('canplay', onReady);
      lofiRadioAudio.removeEventListener('error', onFail);
      lofiRadioAudio.removeEventListener('stalled', onFail);
      lofiRadioAudio.removeEventListener('abort', onFail);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onFail = () => {
      cleanup();
      reject(new Error('Stream failed'));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Stream timed out'));
    }, 8000);

    lofiRadioAudio.addEventListener('playing', onReady, { once: true });
    lofiRadioAudio.addEventListener('canplay', onReady, { once: true });
    lofiRadioAudio.addEventListener('error', onFail, { once: true });
    lofiRadioAudio.addEventListener('stalled', onFail, { once: true });
    lofiRadioAudio.addEventListener('abort', onFail, { once: true });

    try {
      lofiRadioAudio.pause();
      lofiRadioAudio.src = url;
      lofiRadioAudio.volume = (DOM.musicVolume?.value || 10) / 100;
      lofiRadioAudio.load();
      await lofiRadioAudio.play();
    } catch {
      cleanup();
      reject(new Error('Play blocked'));
    }
  });
}

function updateTrackUIWithRadio(station) {
  DOM.trackName.textContent = station?.name || 'The LO-FI Radio';
  DOM.trackArtist.textContent = 'Live radio stream';
  DOM.trackArt.innerHTML = '<div class="art-default">📻</div>';
}

function updateLofiRadioTransportUI() {
  if (spotifyLinked) return;
  DOM.progressFill.style.width = '100%';
  DOM.timeCurrent.textContent = 'LIVE';
  DOM.timeTotal.textContent = 'LIVE';
  updatePlayBtn(!lofiRadioAudio.paused);
}

function openSearchModal(query, count) {
  if (!DOM.searchModal || !DOM.searchModalResults || !DOM.searchModalTitle) return;
  DOM.searchModal.classList.add('open');
  DOM.searchModal.setAttribute('aria-hidden', 'false');
  const modeLabel = jamSearchMode === 'mixes' ? 'Mixes' : 'Songs';
  DOM.searchModalTitle.textContent = `${modeLabel}: "${truncate(query, 38)}" (${count})`;
}

function closeSearchModal() {
  if (!DOM.searchModal || !DOM.searchModalResults) return;
  DOM.searchModal.classList.remove('open');
  DOM.searchModal.setAttribute('aria-hidden', 'true');
}

function bindHudControls() {
  const setHudMinimal = next => {
    DOM.body.classList.toggle('hud-minimal', next);
    localStorage.setItem(HUD_MINIMAL_KEY, next ? '1' : '0');
    if (DOM.btnToggleHud) {
      DOM.btnToggleHud.textContent = next ? 'Show HUD' : 'Hide HUD';
      DOM.btnToggleHud.setAttribute('aria-label', next ? 'Show HUD' : 'Hide HUD');
      DOM.btnToggleHud.title = next ? 'Show HUD' : 'Hide HUD';
    }
    if (DOM.btnHudRestore) {
      DOM.btnHudRestore.setAttribute('aria-label', 'Show HUD');
      DOM.btnHudRestore.title = 'Show HUD';
    }
  };

  const startMinimal = localStorage.getItem(HUD_MINIMAL_KEY) === '1';
  setHudMinimal(startMinimal);

  DOM.btnToggleHud?.addEventListener('click', () => {
    const next = !DOM.body.classList.contains('hud-minimal');
    setHudMinimal(next);
  });

  DOM.btnHudRestore?.addEventListener('click', () => {
    setHudMinimal(false);
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && DOM.searchModal?.classList.contains('open')) {
      closeSearchModal();
      return;
    }
    if (e.key !== 'Escape') return;
    if (!DOM.body.classList.contains('hud-minimal')) return;
    setHudMinimal(false);
  });
}

function loadLocalQueue() {
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_KEY);
    const parsed = JSON.parse(raw || '[]');
    localQueue = Array.isArray(parsed)
      ? parsed
        .filter(item => item && typeof item.uri === 'string' && item.uri.length > 0)
        .map(item => ({
          uri: item.uri,
          name: item.name || 'Unknown title',
          artist: item.artist || '',
          art: item.art || null,
          playlistId: typeof item.playlistId === 'string' && item.playlistId ? item.playlistId : null,
          tracksHref: typeof item.tracksHref === 'string' && item.tracksHref ? item.tracksHref : null,
        }))
      : [];
  } catch {
    localQueue = [];
  }
}

function saveLocalQueue() {
  localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(localQueue));
}

function toQueueEntry(item) {
  return {
    uri: item.uri,
    name: item.name || 'Unknown title',
    artist: item.artist || '',
    art: item.art || null,
    playlistId: item.playlistId || item.id || null,
    tracksHref: item.tracksHref || item.tracks?.href || null,
  };
}

function enqueueTrack(item, toTop = false, options = {}) {
  const silentDuplicate = !!options.silentDuplicate;
  if (!item?.uri) return false;
  if (localQueue.some(q => q.uri === item.uri)) {
    if (!silentDuplicate) showToast('Already in queue');
    return false;
  }

  const entry = toQueueEntry(item);

  if (toTop) localQueue.unshift(entry);
  else localQueue.push(entry);

  saveLocalQueue();
  renderQueue();
  return true;
}

async function enqueueItemOrExpand(item, toTop = false) {
  if (!item?.uri) return { added: 0, skipped: 0 };

  if (!isPlaylistUri(item.uri)) {
    const added = enqueueTrack(item, toTop) ? 1 : 0;
    return { added, skipped: added ? 0 : 1 };
  }

  if (!spotify.isLoggedIn()) {
    showToast('Connect Spotify to expand mix into tracks');
    return { added: 0, skipped: 0 };
  }

  let tracks = [];
  try {
    tracks = await spotify.getPlaylistTracks(item, 250);
  } catch (err) {
    const msg = String(err?.message || 'Could not load mix tracks');
    const added = enqueueTrack(item, toTop, { silentDuplicate: true }) ? 1 : 0;
    if (added) {
      showToast('Mix queued directly.');
      return { added: 1, skipped: 0 };
    }

    if (msg.toLowerCase().includes('already') || localQueue.some(q => q.uri === item.uri)) {
      showToast('Mix is already in queue');
    } else {
      showToast('This mix cannot be expanded right now.');
    }
    return { added: 0, skipped: 1 };
  }

  if (!tracks.length) {
    const added = enqueueTrack(item, toTop, { silentDuplicate: true }) ? 1 : 0;
    if (added) {
      showToast('Mix queued directly.');
      return { added: 1, skipped: 0 };
    }
    showToast('Mix is already in queue');
    return { added: 0, skipped: 1 };
  }

  const insert = toTop ? [...tracks].reverse() : tracks;
  let added = 0;
  let skipped = 0;

  insert.forEach(track => {
    if (enqueueTrack(track, toTop, { silentDuplicate: true })) added += 1;
    else skipped += 1;
  });

  if (added > 0) {
    showToast(`Queued ${added} track${added === 1 ? '' : 's'} from mix`);
  } else {
    showToast('All mix tracks are already in queue');
  }

  return { added, skipped };
}

function removeQueueItem(index) {
  if (index < 0 || index >= localQueue.length) return;
  localQueue.splice(index, 1);
  saveLocalQueue();
  renderQueue();
}

function moveQueueItem(index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= localQueue.length || target >= localQueue.length) return;
  const [item] = localQueue.splice(index, 1);
  localQueue.splice(target, 0, item);
  saveLocalQueue();
  renderQueue();
}

async function expandQueueMixAt(index) {
  if (index < 0 || index >= localQueue.length) return;
  const mix = localQueue[index];
  if (!mix || !isPlaylistUri(mix.uri)) return;

  if (!spotify.isLoggedIn()) {
    showToast('Connect Spotify to expand this mix');
    return;
  }

  let tracks = [];
  try {
    tracks = await spotify.getPlaylistTracks(mix, 250);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('permission') || msg.includes('scope') || msg.includes('forbidden') || msg.includes('blocked')) {
      showToast('Spotify blocked expansion. Reconnect Spotify and try again.');
    } else {
      showToast('Could not expand this mix right now');
    }
    return;
  }

  if (!tracks.length) {
    showToast('No tracks available to expand for this mix');
    return;
  }

  const seen = new Set(localQueue.map((item, i) => (i === index ? null : item?.uri)).filter(Boolean));
  const entries = [];

  for (const track of tracks) {
    const uri = track?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    entries.push(toQueueEntry(track));
  }

  if (!entries.length) {
    showToast('These mix songs are already in your queue');
    return;
  }

  localQueue.splice(index, 1, ...entries);
  saveLocalQueue();
  renderQueue();
  showToast(`Expanded mix into ${entries.length} song${entries.length === 1 ? '' : 's'}`);
}

function renderQueue() {
  if (!DOM.queueList || !DOM.queueCount) return;

  DOM.queueCount.textContent = String(localQueue.length);
  DOM.queueList.innerHTML = '';

  if (!localQueue.length) {
    DOM.queueList.innerHTML = '<div class="vote-empty">Queue is empty. Add songs from search or suggestions.</div>';
    return;
  }

  localQueue.forEach((item, index) => {
    const isMix = isPlaylistUri(item.uri);
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `
      <div class="jam-result-art">${item.art ? `<img src="${item.art}" alt="">` : '🎵'}</div>
      <div class="jam-result-meta">
        <div class="queue-name-row">
          <div class="jam-result-name">${escapeHtml(item.name)}</div>
          ${isMix ? '<span class="queue-kind">MIX</span>' : ''}
        </div>
        <div class="jam-result-artist">${escapeHtml(item.artist || '')}</div>
      </div>
      <div class="queue-item-actions">
        ${isMix ? '<button class="queue-btn q-expand" type="button">Expand</button>' : ''}
        <button class="queue-btn q-play" type="button">Play</button>
        <button class="queue-btn q-up" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="queue-btn q-down" type="button" ${index === localQueue.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="queue-btn q-del" type="button">✕</button>
      </div>
    `;

    row.querySelector('.q-play')?.addEventListener('click', async () => {
      await playQueueItemAt(index);
    });
    row.querySelector('.q-expand')?.addEventListener('click', async () => {
      await expandQueueMixAt(index);
    });
    row.querySelector('.q-up')?.addEventListener('click', () => moveQueueItem(index, -1));
    row.querySelector('.q-down')?.addEventListener('click', () => moveQueueItem(index, 1));
    row.querySelector('.q-del')?.addEventListener('click', () => removeQueueItem(index));

    DOM.queueList.appendChild(row);
  });
}

async function playQueueItemAt(index) {
  if (index < 0 || index >= localQueue.length) return;
  if (!spotify.isLoggedIn()) {
    showToast('Connect Spotify to play queue items');
    return;
  }

  const [item] = localQueue.splice(index, 1);
  saveLocalQueue();
  renderQueue();
  await playQueueItem(item);
}

async function playNextFromQueue(reason = 'manual') {
  if (!localQueue.length) return;
  if (!spotify.isLoggedIn()) return;

  const item = localQueue.shift();
  saveLocalQueue();
  renderQueue();
  const playingItem = await playQueueItem(item);

  if (reason === 'manual') showToast(`Now playing: ${truncate(playingItem?.name || item.name, 22)}`);
}

async function queueMixTracksForPlayback(mix) {
  if (!mix?.uri || !isPlaylistUri(mix.uri) || !spotify.isLoggedIn()) return null;

  let tracks = [];
  try {
    tracks = await spotify.getPlaylistTracks(mix, 250);
  } catch (err) {
    console.warn('[Queue] Mix preload failed:', err?.message || err);
    return null;
  }

  if (!tracks.length) return null;

  const firstTrack = toQueueEntry(tracks[0]);
  const seen = new Set(localQueue.map(item => item?.uri).filter(Boolean));
  const entries = [];

  for (let i = 1; i < tracks.length; i += 1) {
    const entry = toQueueEntry(tracks[i]);
    if (!entry.uri || seen.has(entry.uri)) continue;
    seen.add(entry.uri);
    entries.push(entry);
  }

  if (entries.length) {
    localQueue.unshift(...entries);
    saveLocalQueue();
    renderQueue();
  }

  return {
    firstTrack,
    added: entries.length,
    total: tracks.length,
  };
}

async function playQueueItem(item) {
  if (!item?.uri) return item;

  let playbackItem = item;

  if (isPlaylistUri(item.uri)) {
    const seededMix = await queueMixTracksForPlayback(item);
    if (seededMix?.firstTrack?.uri) {
      playbackItem = seededMix.firstTrack;
      await spotify.play(null, [playbackItem.uri]);
    } else {
      await spotify.play(item.uri, null);
    }
  } else {
    await spotify.play(null, [item.uri]);
  }

  if (isJamHost) {
    await jam.publishPlayback({
      trackUri: playbackItem.uri,
      trackName: playbackItem.name,
      artist: playbackItem.artist,
      isPlaying: true,
      positionMs: 0,
      durationMs: spotify.durationMs || 0,
    });
  }

  maybePublishHostPlayback(true);
  return playbackItem;
}

function maybeAutoAdvanceQueue(pos, dur) {
  if (!spotify.isLoggedIn()) return;
  if (!spotify.isPlaying) return;
  if (!localQueue.length) return;
  if (!dur || dur <= 0) return;

  const remainingMs = Math.max(0, dur - pos);
  if (remainingMs > 900 || queueAutoAdvanceLock) return;

  queueAutoAdvanceLock = true;
  playNextFromQueue('auto').catch(err => {
    console.warn('[Queue] Auto-advance failed:', err?.message || err);
  }).finally(() => {
    setTimeout(() => { queueAutoAdvanceLock = false; }, 1200);
  });
}

async function runJamSearch() {
  if (!spotify.isLoggedIn()) {
    showToast('Connect Spotify to search tracks');
    return;
  }

  const query = DOM.jamSearchInput.value.trim();
  if (!query) {
    DOM.jamSearchResults.innerHTML = '';
    DOM.searchModalResults && (DOM.searchModalResults.innerHTML = '');
    closeSearchModal();
    return;
  }

  DOM.btnJamSearch.disabled = true;
  DOM.btnJamSearch.textContent = '...';

  try {
    if (jamSearchMode === 'mixes') {
      const mixes = await spotify.searchMixes(query, 120);
      const validMixes = (mixes || []).filter(m => m && typeof m === 'object' && typeof m.uri === 'string' && m.uri.length > 0);
      renderJamSearchResults(
        validMixes.map(m => ({
          mode: 'mixes',
          uri: m.uri,
          name: m.name,
          subtitle: m.owner?.display_name || 'Spotify',
          art: m.images?.[0]?.url || null,
          playlistId: m.id || null,
          tracksHref: m.tracks?.href || null,
        }))
      , query);
    } else {
      const tracks = await spotify.searchTracks(query, 120);
      const validTracks = (tracks || []).filter(track => track && typeof track === 'object' && typeof track.uri === 'string' && track.uri.length > 0);
      renderJamSearchResults(
        validTracks.map(track => ({
          mode: 'songs',
          uri: track.uri,
          name: track.name,
          subtitle: (track.artists || []).map(a => a.name).join(', '),
          art: track.album?.images?.[2]?.url || null,
        }))
      , query);
    }
  } finally {
    DOM.btnJamSearch.disabled = false;
    DOM.btnJamSearch.textContent = 'Suggest';
  }
}

function renderJamSearchResults(items, query = DOM.jamSearchInput.value.trim()) {
  DOM.jamSearchResults.innerHTML = '';
  if (DOM.searchModalResults) DOM.searchModalResults.innerHTML = '';

  if (!items.length) {
    const emptyHtml = `<div class="vote-empty">No ${jamSearchMode} found for "${escapeHtml(query || '')}"</div>`;
    DOM.jamSearchResults.innerHTML = emptyHtml;
    if (DOM.searchModalResults) DOM.searchModalResults.innerHTML = emptyHtml;
    openSearchModal(query || 'Search', 0);
    return;
  }

  openSearchModal(query || 'Search', items.length);

  items.forEach(item => {
    if (!item || typeof item.uri !== 'string' || !item.uri) return;

    const row = document.createElement('div');
    row.className = 'jam-result';
    const alreadySuggested = (jamState?.suggestions || []).some(s => s.uri === item.uri);
    const alreadyQueued = item.mode === 'mixes'
      ? false
      : localQueue.some(q => q.uri === item.uri);

    const img = item.art;
    row.innerHTML = `
      <div class="jam-result-art">${img ? `<img src="${img}" alt="">` : '🎵'}</div>
      <div class="jam-result-meta">
        <div class="jam-result-name">${escapeHtml(item.name)}</div>
        <div class="jam-result-artist">${escapeHtml(item.subtitle || '')}</div>
      </div>
      <div class="jam-result-actions">
        <button class="jam-result-btn jam-add-btn" type="button" ${alreadySuggested ? 'disabled' : ''}>${alreadySuggested ? 'Added' : 'Add'}</button>
        <button class="jam-result-btn jam-queue-btn" type="button" ${alreadyQueued ? 'disabled' : ''}>${alreadyQueued ? 'Queued' : (item.mode === 'mixes' ? 'Queue All' : 'Queue')}</button>
      </div>
    `;

    row.querySelector('.jam-add-btn').addEventListener('click', async () => {
      if (alreadySuggested) {
        showToast('Already in suggestions');
        return;
      }

      try {
        await jam.suggest({
          uri: item.uri,
          name: item.name,
          artist: item.subtitle || '',
          art: item.art || null,
        });
        showToast(`Added: ${truncate(item.name, 20)}`);
      } catch (err) {
        showToast(err?.message || 'Could not add suggestion');
      }
    });

    row.querySelector('.jam-queue-btn').addEventListener('click', async () => {
      const result = await enqueueItemOrExpand({
        uri: item.uri,
        name: item.name,
        artist: item.subtitle || '',
        art: item.art || null,
        playlistId: item.playlistId || null,
        tracksHref: item.tracksHref || null,
      });
      if (result.added > 0 && !isPlaylistUri(item.uri)) {
        showToast(`Queued: ${truncate(item.name, 20)}`);
      }
      if (result.added > 0) renderJamSearchResults(items, query);
    });

    DOM.searchModalResults?.appendChild(row);
  });
}

async function onJamState(state) {
  const wasJamHost = isJamHost;
  jamState = state;
  isJamHost = state?.hostId === jamUserId;
  syncHostPlaybackLoop();

  if (isJamHost && !wasJamHost) {
    maybePublishHostPlayback(true);
  }

  DOM.btnJamHost.textContent = isJamHost ? 'Release Host' : (state?.hostName ? `Host: ${state.hostName}` : 'Become Host');

  // Populate nickname input if not already set
  if (DOM.nicknameInput && !DOM.nicknameInput.value) {
    DOM.nicknameInput.value = jamUserName || '';
  }

  renderSuggestionList(state?.suggestions || []);
  updateVoteFooter();

  const pb = state?.playback;
  if (!pb || isJamHost) return;

  // Allow sync for spotify users OR radio playback
  const isRadio = pb.trackUri?.startsWith('lofi-radio:');
  if (!isRadio && !spotify.isLoggedIn()) return;

  const remoteStamp = Number(pb.startedAt || state?.updatedAt || Date.now());
  if (remoteStamp <= lastRemotePlaybackStamp) return;
  lastRemotePlaybackStamp = remoteStamp;
  await applyRemotePlayback(pb);
}

function renderSuggestionList(suggestions) {
  DOM.voteOptions.innerHTML = '';

  if (!suggestions.length) {
    DOM.voteOptions.innerHTML = '<div class="vote-empty">Search above and suggest tracks to the room.</div>';
    return;
  }

  suggestions.forEach(s => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.style.position = 'relative';
    div.innerHTML = `
      <div class="vo-art">${s.art ? `<img src="${s.art}" alt="">` : '🎵'}</div>
      <div class="vo-info">
        <div class="vo-name">${escapeHtml(s.name)}</div>
        <div class="vo-artist">${escapeHtml(s.artist || '')}</div>
      </div>
      <div class="vo-count">${s.votes || 0} 🗳</div>
      <button class="jam-result-btn jam-queue-btn" type="button" style="margin-left:6px">Queue</button>
      ${isJamHost ? '<button class="jam-result-btn jam-play-btn" type="button" style="margin-left:6px">Play</button>' : ''}
    `;

    div.addEventListener('click', async () => {
      try {
        await jam.vote(s.uri);
      } catch {
        showToast('Vote failed');
      }
    });

    const queueBtn = div.querySelector('.jam-queue-btn');
    if (queueBtn) {
      queueBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const result = await enqueueItemOrExpand({
          uri: s.uri,
          name: s.name,
          artist: s.artist || '',
          art: s.art || null,
        });
        if (result.added > 0 && !isPlaylistUri(s.uri)) {
          showToast(`Queued: ${truncate(s.name, 20)}`);
        }
      });
    }

    const playBtn = div.querySelector('.jam-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await hostPlaySuggestion(s);
      });
    }

    DOM.voteOptions.appendChild(div);
  });
}

async function hostPlaySuggestion(suggestion) {
  if (!isJamHost) {
    showToast('Only host can start shared playback');
    return;
  }
  if (!spotify.isLoggedIn()) {
    showToast('Host must connect Spotify first');
    return;
  }

  try {
    if (isPlaylistUri(suggestion.uri)) {
      await spotify.play(suggestion.uri, null);
    } else {
      await spotify.play(null, [suggestion.uri]);
    }
    await jam.publishPlayback({
      trackUri: suggestion.uri,
      trackName: suggestion.name,
      artist: suggestion.artist,
      isPlaying: true,
      positionMs: 0,
      durationMs: spotify.durationMs || 0,
    });
    await jam.removeSuggestion(suggestion.uri);
    showToast(`Now playing: ${truncate(suggestion.name, 22)}`);
  } catch (err) {
    console.warn('[Jam] Could not play suggestion:', err?.message || err);
    showToast('Could not start playback');
  }
}

function maybePublishHostPlayback(force = false) {
  if (!isJamHost || !jamState) return;

  const now = Date.now();
  if (!force && now - lastHostPublishAt < HOST_PLAYBACK_PUBLISH_MS) return;

  // Prioritize Spotify if linked
  if (spotifyLinked && spotify.currentTrack?.uri) {
    const track = spotify.currentTrack;
    lastHostPublishAt = now;
    jam.publishPlayback({
      trackUri: track.uri,
      trackName: track.name,
      artist: (track.artists || []).map(a => a.name).join(', '),
      isPlaying: spotify.isPlaying,
      positionMs: spotify.positionMs || 0,
      durationMs: spotify.durationMs || 0,
    }).catch(() => {});
    return;
  }

  // Otherwise publish radio if playing
  if (!spotifyLinked && !lofiRadioAudio.paused) {
    const station = LOFI_RADIO_STATIONS[lofiRadioStationIndex];
    if (station) {
      lastHostPublishAt = now;
      jam.publishPlayback({
        trackUri: `lofi-radio:${station.id}`,
        trackName: station.name,
        artist: 'Live Radio Stream',
        isPlaying: true,
        positionMs: 0,
        durationMs: 0,
      }).catch(() => {});
    }
  }
}

function syncHostPlaybackLoop() {
  const shouldRun = isJamHost && (spotifyLinked || !lofiRadioAudio.paused);

  if (!shouldRun) {
    clearInterval(hostPublishTimer);
    hostPublishTimer = null;
    lastHostPublishAt = 0;
    return;
  }

  if (hostPublishTimer) return;
  hostPublishTimer = setInterval(() => {
    maybePublishHostPlayback(false);
  }, HOST_PLAYBACK_PUBLISH_MS);
}

function getRemoteTargetPosition(pb) {
  let targetPos = Math.max(0, Math.round(Number(pb?.positionMs || 0)));

  if (pb?.isPlaying && pb?.startedAt) {
    targetPos += Math.max(0, Date.now() - Number(pb.startedAt));
  }

  const durationMs = Math.max(0, Math.round(Number(pb?.durationMs || 0)));
  if (durationMs > 0) {
    targetPos = Math.min(targetPos, durationMs);
  }

  return targetPos;
}

async function applyRemotePlayback(pb) {
  try {
    // Check if remote playback is a radio station
    if (pb.trackUri?.startsWith('lofi-radio:')) {
      const stationId = pb.trackUri.replace('lofi-radio:', '');
      const stationIndex = LOFI_RADIO_STATIONS.findIndex(s => s.id === stationId);
      if (stationIndex >= 0) {
        if (!spotifyLinked) {
          // Only restart if switching stations or need to start
          const isSameStation = lofiRadioStationIndex === stationIndex;
          if (!isSameStation || lofiRadioAudio.paused !== !pb.isPlaying) {
            await playLofiStation(stationIndex, { allowExternalOpen: false });
            if (!pb.isPlaying) {
              stopLofiRadio();
            } else if (lofiRadioAudio.paused) {
              lofiRadioAudio.play().catch(() => {});
            }
          }
        }
        updateVoteFooter();
        return;
      }
    }

    const currentUri = spotify.currentTrack?.uri;
    const targetPos = getRemoteTargetPosition(pb);

    if (currentUri !== pb.trackUri) {
      if (isPlaylistUri(pb.trackUri)) {
        await spotify.play(pb.trackUri, null, { positionMs: targetPos });
      } else {
        await spotify.play(null, [pb.trackUri], { positionMs: targetPos });
      }
      if (!pb.isPlaying) {
        await spotify.pause();
      }
      updateVoteFooter();
      return;
    }

    const drift = Math.abs((spotify.positionMs || 0) - targetPos);

    if (drift > REMOTE_SEEK_DRIFT_MS) {
      await spotify.seekTo(targetPos);
    }

    if (pb.isPlaying && !spotify.isPlaying) await spotify.resume();
    if (!pb.isPlaying && spotify.isPlaying) await spotify.pause();
  } catch (err) {
    console.warn('[Jam] Remote sync apply failed:', err?.message || err);
  }
}

function buildSceneList() {
  DOM.sceneList.innerHTML = '';
  SCENES.forEach(scene => {
    const btn = document.createElement('button');
    btn.className = 'scene-btn';
    btn.dataset.id = scene.id;
    btn.innerHTML = `<span class="s-emoji">${scene.emoji}</span><span class="s-label">${scene.name.split(' ')[0]}</span>`;
    btn.addEventListener('click', () => switchScene(scene.id, true));
    DOM.sceneList.appendChild(btn);
  });
}

function switchScene(id, playAudio = true) {
  const scene = getScene(id);
  const prev = currentSceneId;
  currentSceneId = id;

  DOM.body.className = `scene-${id}`;
  DOM.sceneBg.className = `scene-bg scene-${id}`;
  updateSceneVideo(id);
  DOM.sceneEmoji.textContent = scene.emoji;
  DOM.sceneName.textContent = scene.name;
  DOM.sceneTagline.textContent = scene.tagline;

  document.querySelectorAll('.scene-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.id === id);
  });

  if (prev && prev !== id) {
    const prevScene = getScene(prev);
    ambient.teardown(prevScene.ambients.map(a => a.id));
  }

  buildMixer(scene, playAudio);
}

function updateSceneVideo(sceneId) {
  const video = DOM.sceneMediaVideo;
  if (!video) return;

  const relative = SCENE_VIDEO_MAP[sceneId] || null;
  if (!relative) {
    video.pause();
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    video.dataset.sceneVideo = '';
    return;
  }

  const resolved = new URL(`../${relative}`, import.meta.url).href;
  if (video.dataset.sceneVideo !== relative) {
    video.src = resolved;
    video.load();
    video.dataset.sceneVideo = relative;
  }

  video.play().catch(() => {});
}

function buildMixer(scene, startAudio = true) {
  DOM.mixerChannels.innerHTML = '';

  scene.ambients.forEach(ch => {
    if (startAudio) {
      ambient.init();
      ambient.resume();
      ambient.setup(ch.id, ch.defaultOn, ch.defaultVol);
      ambientJamStarted = true;
    }

    const div = document.createElement('div');
    div.className = `channel ${ch.defaultOn ? 'active' : ''}`;
    div.id = `ch-${ch.id}`;
    div.innerHTML = `
      <div class="channel-top">
        <div class="channel-info">
          <span class="channel-icon">${ch.icon}</span>
          <span class="channel-name">${ch.label}</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="tog-${ch.id}" ${ch.defaultOn ? 'checked' : ''}>
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
      <input type="range" class="channel-slider" id="vol-${ch.id}" min="0" max="100" value="${Math.round(ch.defaultVol * 100)}">
    `;

    const toggle = div.querySelector(`#tog-${ch.id}`);
    const slider = div.querySelector(`#vol-${ch.id}`);

    toggle.addEventListener('change', () => {
      if (!ambient._ready) {
        ambient.init();
        ambient.resume();
        ambient.setup(ch.id, false, ch.defaultVol);
      }
      ambient.toggle(ch.id, toggle.checked);
      div.classList.toggle('active', toggle.checked);
    });

    slider.addEventListener('input', () => {
      if (!ambient._ready) {
        ambient.init();
        ambient.resume();
        ambient.setup(ch.id, false, ch.defaultVol);
      }
      ambient.setVolume(ch.id, slider.value / 100);
    });

    DOM.mixerChannels.appendChild(div);
  });
}

DOM.btnAllOn.addEventListener('click', () => {
  if (!ambient._ready) {
    ambient.init();
    ambient.resume();
  }
  const scene = getScene(currentSceneId);
  scene.ambients.forEach(ch => {
    if (!ambient.channels[ch.id]) ambient.setup(ch.id, false, ch.defaultVol);
    ambient.toggle(ch.id, true);
    const tog = document.querySelector(`#tog-${ch.id}`);
    const div = document.querySelector(`#ch-${ch.id}`);
    if (tog) tog.checked = true;
    if (div) div.classList.add('active');
  });
  ambientJamStarted = true;
});

DOM.btnAllOff.addEventListener('click', () => {
  ambient.toggleAll(false);
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.toggle input').forEach(el => (el.checked = false));
});

if (!DOM.btnConnect) {
  console.error('[UI] Connect button not found in DOM!');
} else {
  DOM.btnConnect.addEventListener('click', async () => {
    if (spotifyLinked) {
      spotify.logout();
      spotifyLinked = false;
      syncHostPlaybackLoop();
      DOM.btnConnect.textContent = 'Connect Spotify';
      DOM.btnConnect.style.display = 'flex';
      DOM.btnDisconnect?.classList.remove('show');
      DOM.npMini.style.display = lofiRadioAudio.paused ? 'none' : 'flex';
      resetPlayer();
      showToast('Disconnected from Spotify');
    } else {
      try {
        if (spotify.isLoggedIn()) {
          await connectSpotify();
          return;
        }

        if (pendingSpotifyManualAuthUrl) {
          await runManualSpotifyAuthFlow();
          return;
        }

        console.log('[UI] Connect button clicked, calling spotify.login()');
        const loginResult = await spotify.login({ forceManual: isDiscordActivity });

        if (loginResult?.mode === 'manual' && loginResult?.authUrl) {
          pendingSpotifyManualAuthUrl = loginResult.authUrl;
          pendingSpotifyManualState = loginResult.state || '';
          pendingSpotifyManualVerifier = loginResult.verifier || '';
          savePendingSpotifyManualAuth();
          const copied = await copyText(pendingSpotifyManualAuthUrl);
          if (copied) {
            showToast('Spotify link copied. Open it in browser, approve, then click Connect again.');
          } else {
            window.open(pendingSpotifyManualAuthUrl, '_blank', 'noopener');
            showToast('After approval, click Connect again and paste callback URL/code.');
          }
        }
      } catch (err) {
        console.error('[UI] Spotify login failed:', err);
        showToast(`Spotify error: ${err?.message || 'Login failed'}`);
      }
    }
  });

  DOM.btnDisconnect?.addEventListener('click', async () => {
    spotify.logout();
    spotifyLinked = false;
    syncHostPlaybackLoop();
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.btnConnect.style.display = 'flex';
    DOM.btnDisconnect?.classList.remove('show');
    DOM.npMini.style.display = lofiRadioAudio.paused ? 'none' : 'flex';
    resetPlayer();
    showToast('Disconnected from Spotify. Enjoy the radio!');
  });
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state') || '';
  const error = params.get('error');

  if (error) {
    console.error('Spotify auth error:', error, params.get('error_description'));
    // If we're in popup, send error back to opener
    if (window.opener) {
      window.opener.postMessage({ type: 'spotify-auth-error', error }, '*');
      window.close();
      return;
    }
    showToast(`Spotify auth error: ${error}`);
    return;
  }

  if (!code) return;

  const isManualDiscordState = state.startsWith('v1m.');

  // If we're in popup, send code back to opener (Discord Activity main window)
  if (window.opener) {
    window.opener.postMessage({ type: 'spotify-auth-code', code, state }, '*');
    window.close();
    return;
  }

  // If a manual Discord auth link is opened in a regular browser, don't consume the code here.
  // The Discord Activity needs this callback URL/code to complete token exchange.
  if (isManualDiscordState && !isDiscordActivity) {
    const callbackUrl = window.location.href;
    const copied = await copyText(callbackUrl);
    if (copied) {
      showToast('Spotify approved. Return to Discord and paste the callback URL.');
    }
    if (!copied) {
      window.open(callbackUrl, '_blank', 'noopener');
    }
    return;
  }

  try {
    await spotify.handleCallback(code, state);
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    showToast('Spotify connected');
    await connectSpotify();
  } catch (err) {
    console.error('Spotify auth failed:', err);
    showToast(`Spotify error: ${err.message}`);
  }
}

async function connectSpotify() {
  stopLofiRadio();
  DOM.btnConnect.textContent = 'Connecting...';
  DOM.btnConnect.disabled = true;

  // Discord Activity can allow OAuth token usage while blocking Web Playback SDK device init.
  // In that case we still treat Spotify as connected for API-backed features.
  if (isDiscordActivity) {
    spotifyLinked = true;
    DOM.npMini.style.display = 'none';
    DOM.btnConnect.style.display = 'none';
    DOM.btnDisconnect?.classList.add('show');
    DOM.btnConnect.textContent = 'Disconnect Spotify';
    DOM.btnConnect.disabled = false;
    showToast('Spotify linked in Discord. Search works here; playback works best in web app.');
    return;
  }

  spotify.onReady = () => {
    spotifyLinked = true;
    const musicVol = DOM.musicVolume ? (DOM.musicVolume.value / 100) : 0.1;
    spotify.setVolume(musicVol);
    DOM.btnConnect.style.display = 'none';
    DOM.btnDisconnect?.classList.add('show');
    DOM.npMini.style.display = 'flex';
    DOM.btnDisconnect.disabled = false;
    syncHostPlaybackLoop();
    if (isJamHost) {
      maybePublishHostPlayback(true);
    } else if (jamState?.playback) {
      applyRemotePlayback(jamState.playback).catch(err => {
        console.warn('[Jam] Initial remote sync failed:', err?.message || err);
      });
    }
    showToast('Spotify ready');
  };

  spotify.onTrackChange = track => {
    queueAutoAdvanceLock = false;
    updateTrackUI(track);
    DOM.npMiniText.textContent = truncate(track.name, 22);
    maybePublishHostPlayback(true);
  };

  spotify.onPlayStateChange = playing => {
    updatePlayBtn(playing);
    maybePublishHostPlayback(true);
  };

  spotify.onProgress = (pos, dur) => {
    updateProgress(pos, dur);
    maybePublishHostPlayback(false);
  };

  spotify.onError = msg => {
    spotifyLinked = false;
    syncHostPlaybackLoop();
    showToast('Spotify: ' + msg);
    DOM.btnConnect.style.display = 'flex';
    DOM.btnDisconnect?.classList.remove('show');
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.btnConnect.disabled = false;
  };

  try {
    await spotify.initPlayer();
  } catch {
    spotifyLinked = false;
    syncHostPlaybackLoop();
    DOM.btnConnect.style.display = 'flex';
    DOM.btnDisconnect?.classList.remove('show');
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.btnConnect.disabled = false;
  }
}

function bindPlayerControls() {
  DOM.btnPlay.addEventListener('click', async () => {
    ambient.init();
    ambient.resume();

    if (!spotifyLinked) {
      startAmbientJam();
      const station = LOFI_RADIO_STATIONS[lofiRadioStationIndex];
      if (lofiRadioAudio.paused) {
        try {
          await playLofiStation(lofiRadioStationIndex);
        } catch {
          showToast(`Could not start ${station?.name || 'The LO-FI Radio'}`);
        }
      } else {
        stopLofiRadio();
      }
      return;
    }

    try {
      await spotify.togglePlay();
      maybePublishHostPlayback(true);
    } catch (err) {
      if (isDiscordActivity) {
        showToast('Spotify playback is limited in Discord Activity. Use web app for playback.');
      } else {
        showToast('Could not start playback');
      }
      console.error('[Spotify] Play failed:', err);
    }
  });

  DOM.btnPrev.addEventListener('click', async () => {
    if (!spotifyLinked) {
      const prevIndex = (lofiRadioStationIndex - 1 + LOFI_RADIO_STATIONS.length) % LOFI_RADIO_STATIONS.length;
      await playLofiStation(prevIndex);
      return;
    }
    await spotify.previous();
    maybePublishHostPlayback(true);
  });

  DOM.btnNext.addEventListener('click', async () => {
    if (!spotifyLinked) {
      const nextIndex = (lofiRadioStationIndex + 1) % LOFI_RADIO_STATIONS.length;
      await playLofiStation(nextIndex);
      return;
    }

    if (localQueue.length > 0) {
      await playNextFromQueue('manual');
      return;
    }

    await spotify.next();
    maybePublishHostPlayback(true);
  });

  DOM.progressTrack.addEventListener('click', async e => {
    if (!spotifyLinked) {
      updateLofiRadioTransportUI();
      return;
    }
    try {
      const pct = e.offsetX / DOM.progressTrack.offsetWidth;
      await spotify.seekTo(Math.round(pct * spotify.durationMs));
      maybePublishHostPlayback(true);
    } catch (err) {
      console.warn('[Spotify] Seek failed:', err?.message || err);
    }
  });
}

function bindVolumeControls() {
  const applyMusicVolume = () => {
    if (!DOM.musicVolume) return;
    const v = DOM.musicVolume.value / 100;
    spotify.setVolume(v);
    lofiRadioAudio.volume = v;
  };

  const applyAmbientVolume = () => {
    if (!DOM.ambientVolume) return;
    const v = DOM.ambientVolume.value / 100;
    // Ensure ambient engine exists so volume changes are not dropped before playback starts.
    if (!ambient._ready) {
      ambient.init();
      ambient.resume();
    }
    ambient.setMasterVolume(v);
  };

  DOM.musicVolume?.addEventListener('input', () => {
    applyMusicVolume();
  });

  DOM.ambientVolume?.addEventListener('input', () => {
    applyAmbientVolume();
  });

  // Apply initial UI slider values on startup.
  applyMusicVolume();
  applyAmbientVolume();
}

function enableDiscordJamMode() {
  DOM.btnConnect.textContent = 'Spotify (Optional)';
  if (!spotifyLinked) {
    DOM.voteOptions.innerHTML = '<div class="vote-empty">Ambient jam is live. Spotify is optional.</div>';
  }
  updateVoteFooter();
  startAmbientJam();
}

function setupAmbientJamAutostart() {
  const unlock = () => {
    startAmbientJam();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };

  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
}

function startAmbientJam() {
  if (ambientJamStarted) return;

  ambient.init();
  ambient.resume();

  const scene = getScene(currentSceneId);
  scene.ambients.forEach(ch => {
    if (!ambient.channels[ch.id]) {
      ambient.setup(ch.id, ch.defaultOn, ch.defaultVol);
    }
  });

  scene.ambients.forEach(ch => {
    const tog = document.querySelector(`#tog-${ch.id}`);
    const div = document.querySelector(`#ch-${ch.id}`);
    if (tog) tog.checked = !!ch.defaultOn;
    if (div) div.classList.toggle('active', !!ch.defaultOn);
  });

  ambientJamStarted = true;
  if (isDiscordActivity) showToast('Ambient Jam started');
}

function updateTrackUI(track) {
  DOM.trackName.textContent = track.name;
  DOM.trackArtist.textContent = track.artists?.map(a => a.name).join(', ') || '';

  const img = track.album?.images?.[0]?.url;
  if (img) {
    DOM.trackArt.innerHTML = `<img src="${img}" alt="Album art">`;
  } else {
    DOM.trackArt.innerHTML = '<div class="art-default">♪</div>';
  }
}

function updatePlayBtn(isPlaying) {
  DOM.btnPlay.querySelector('.icon-play').style.display = isPlaying ? 'none' : 'block';
  DOM.btnPlay.querySelector('.icon-pause').style.display = isPlaying ? 'block' : 'none';
}

function updateProgress(pos, dur) {
  const pct = dur ? (pos / dur) * 100 : 0;
  DOM.progressFill.style.width = pct + '%';
  DOM.timeCurrent.textContent = msToTime(pos);
  DOM.timeTotal.textContent = msToTime(dur);
  maybeAutoAdvanceQueue(pos, dur);
}

function resetPlayer() {
  if (!spotifyLinked) {
    DOM.trackName.textContent = 'The LO-FI Radio';
    DOM.trackArtist.textContent = 'Pick a station or connect Spotify';
  } else {
    DOM.trackName.textContent = isDiscordActivity ? 'Ambient Jam Live' : 'Not Connected';
    DOM.trackArtist.textContent = isDiscordActivity ? 'Spotify is optional in Discord mode' : 'Connect Spotify to listen';
  }
  DOM.trackArt.innerHTML = '<div class="art-default">♪</div>';
  DOM.progressFill.style.width = '0%';
  DOM.timeCurrent.textContent = '0:00';
  DOM.timeTotal.textContent = '0:00';
  updatePlayBtn(false);

  if (!spotifyLinked) {
    updateLofiRadioTransportUI();
  }
}

function updateVoteFooter() {
  const n = discord.getParticipantCount();
  const suggestionCount = jamState?.suggestions?.length || 0;
  const resolvedHostName = jamState?.hostName || (jamState?.hostId === jamUserId ? jamUserName : '');
  const hostLine = resolvedHostName ? `host: ${resolvedHostName}` : 'no host';
  DOM.voteFooter.textContent = `${n} listening · ${suggestionCount} suggestions · ${hostLine}`;
}

function msToTime(ms) {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function truncate(str, max) {
  return str?.length > max ? str.slice(0, max) + '…' : str;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrCreateJamUserId() {
  const key = 'jam_user_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `u_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, id);
  return id;
}

function getJamDisplayName() {
  const customNick = localStorage.getItem('jamUserNickname');
  if (customNick) return customNick;
  const base = discord.currentUser?.global_name || discord.currentUser?.username || 'Guest';
  return String(base).slice(0, 20);
}

function setJamNickname(value) {
  const nick = String(value || '').trim().slice(0, 20);
  if (!nick) return '';

  localStorage.setItem('jamUserNickname', nick);
  jamUserName = nick;
  jam.userName = nick;

  if (DOM.nicknameInput && DOM.nicknameInput.value !== nick) {
    DOM.nicknameInput.value = nick;
  }

  return nick;
}

function setJamSearchMode(mode) {
  jamSearchMode = mode === 'mixes' ? 'mixes' : 'songs';
  DOM.btnSearchSongs?.classList.toggle('active', jamSearchMode === 'songs');
  DOM.btnSearchMixes?.classList.toggle('active', jamSearchMode === 'mixes');
  DOM.jamSearchInput.placeholder = jamSearchMode === 'mixes'
    ? 'Search mixes or playlists...'
    : 'Search songs...';
  DOM.jamSearchResults.innerHTML = '';
}

function isPlaylistUri(uri) {
  if (typeof uri !== 'string') return false;
  const value = uri.trim();
  return /^spotify:playlist:[A-Za-z0-9]+$/i.test(value)
    || /^spotify:user:[^:]+:playlist:[A-Za-z0-9]+$/i.test(value)
    || /^https?:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+/i.test(value);
}

function getRoomShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', jamRoomId || 'global');
  return url.toString();
}

function getRoomShareUrlForBase(baseUrl) {
  const url = new URL(String(baseUrl || window.location.origin));
  url.searchParams.set('room', jamRoomId || 'global');
  return url.toString();
}

function extractSpotifyAuthFromInput(value) {
  const input = String(value || '').trim();
  if (!input) return { code: '', state: '' };

  // Accept full callback URL or a raw code value.
  try {
    const parsed = new URL(input);
    return {
      code: parsed.searchParams.get('code') || '',
      state: parsed.searchParams.get('state') || '',
    };
  } catch {
    return { code: input, state: '' };
  }
}

async function runManualSpotifyAuthFlow() {
  if (!pendingSpotifyManualAuthUrl) return;

  const copied = await copyText(pendingSpotifyManualAuthUrl);
  if (!copied) {
    window.open(pendingSpotifyManualAuthUrl, '_blank', 'noopener');
  }

  // Browser prompt dialogs are disabled; wait for callback handling instead.
  showToast('Complete Spotify approval in browser, then return and click Connect again.');
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard may be blocked in embedded contexts.
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

let _toastTimer;
function showToast(msg) {
  // Pop-up toasts disabled for mobile-friendly, non-intrusive UX.
  void msg;
}

init();
