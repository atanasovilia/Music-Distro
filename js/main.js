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

let currentSceneId = 'beach';
let isDiscordActivity = false;
let ambientJamStarted = false;

const jamUserId = getOrCreateJamUserId();
let jamUserName = 'Guest';
let jamRoomId = 'global';
let jamState = null;
let isJamHost = false;
let lastRemotePlaybackStamp = 0;
let lastHostPublishAt = 0;

const $ = id => document.getElementById(id);

const DOM = {
  body: document.body,
  sceneBg: $('scene-bg'),
  sceneList: $('scene-list'),
  sceneEmoji: $('scene-emoji'),
  sceneName: $('scene-name'),
  sceneTagline: $('scene-tagline'),
  participants: $('participants'),
  btnConnect: $('btn-spotify-connect'),
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
  masterVolume: $('master-volume'),
  voteLabel: $('vote-label'),
  voteOptions: $('vote-options'),
  voteFooter: $('vote-footer'),
  roomChip: $('room-chip'),
  btnShareRoom: $('btn-share-room'),
  btnJamHost: $('btn-jam-host'),
  jamSearchInput: $('jam-search-input'),
  btnJamSearch: $('btn-jam-search'),
  jamSearchResults: $('jam-search-results'),
  toast: $('toast'),
};

async function init() {
  buildSceneList();
  switchScene('beach', false);
  bindPlayerControls();
  bindVolumeControls();
  bindJamControls();
  handleSpotifyCallback();

  discord.onParticipantsChange = () => {
    discord.renderAvatars(DOM.participants);
    updateVoteFooter();
  };
  discord.onUserJoin = u => showToast(`🎵 ${u?.username || 'Someone'} joined!`);
  discord.onUserLeave = u => showToast(`👋 ${u?.name || 'Someone'} left`);

  isDiscordActivity = await discord.init();
  jamUserName = getJamDisplayName();
  setupAmbientJamAutostart();

  if (isDiscordActivity || discord.isEmbeddedClient()) {
    isDiscordActivity = true;
    enableDiscordJamMode();
  }

  await initJamRoom();

  if (spotify.isLoggedIn()) {
    await connectSpotify();
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
  DOM.btnShareRoom.addEventListener('click', async () => {
    const url = getRoomShareUrl();
    const copied = await copyText(url);
    if (copied) {
      showToast('Room link copied');
      return;
    }
    showToast('Copy failed. Link shown in prompt');
    window.prompt('Copy room link:', url);
  });

  DOM.btnJamHost.addEventListener('click', async () => {
    try {
      if (isJamHost) {
        await jam.releaseHost();
        showToast('Released host role');
      } else {
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
      showToast('Search failed');
    });
  });

  DOM.jamSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runJamSearch().catch(() => showToast('Search failed'));
    }
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
    return;
  }

  DOM.btnJamSearch.disabled = true;
  DOM.btnJamSearch.textContent = '...';

  try {
    const tracks = await spotify.searchTracks(query, 8);
    renderJamSearchResults(tracks);
  } finally {
    DOM.btnJamSearch.disabled = false;
    DOM.btnJamSearch.textContent = 'Suggest';
  }
}

function renderJamSearchResults(tracks) {
  DOM.jamSearchResults.innerHTML = '';

  if (!tracks.length) {
    DOM.jamSearchResults.innerHTML = '<div class="vote-empty">No tracks found</div>';
    return;
  }

  tracks.forEach(track => {
    const row = document.createElement('div');
    row.className = 'jam-result';

    const img = track.album?.images?.[2]?.url;
    row.innerHTML = `
      <div class="jam-result-art">${img ? `<img src="${img}" alt="">` : '🎵'}</div>
      <div class="jam-result-meta">
        <div class="jam-result-name">${escapeHtml(track.name)}</div>
        <div class="jam-result-artist">${escapeHtml((track.artists || []).map(a => a.name).join(', '))}</div>
      </div>
      <button class="jam-result-btn" type="button">Add</button>
    `;

    row.querySelector('.jam-result-btn').addEventListener('click', async () => {
      try {
        await jam.suggest({
          uri: track.uri,
          name: track.name,
          artist: (track.artists || []).map(a => a.name).join(', '),
          art: track.album?.images?.[2]?.url || null,
        });
        showToast(`Added: ${truncate(track.name, 20)}`);
      } catch {
        showToast('Could not add suggestion');
      }
    });

    DOM.jamSearchResults.appendChild(row);
  });
}

async function onJamState(state) {
  jamState = state;
  isJamHost = state?.hostId === jamUserId;

  DOM.btnJamHost.textContent = isJamHost ? 'Release Host' : (state?.hostName ? `Host: ${state.hostName}` : 'Become Host');

  renderSuggestionList(state?.suggestions || []);
  updateVoteFooter();

  const pb = state?.playback;
  if (!pb || isJamHost || !spotify.isLoggedIn()) return;

  if (pb.startedAt && pb.startedAt <= lastRemotePlaybackStamp) return;
  lastRemotePlaybackStamp = pb.startedAt || Date.now();
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
      ${isJamHost ? '<button class="jam-result-btn" type="button" style="margin-left:6px">Play</button>' : ''}
    `;

    div.addEventListener('click', async () => {
      try {
        await jam.vote(s.uri);
      } catch {
        showToast('Vote failed');
      }
    });

    const playBtn = div.querySelector('.jam-result-btn');
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
    await spotify.play(null, [suggestion.uri]);
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
  if (!isJamHost || !spotify.isLoggedIn() || !jamState) return;

  const now = Date.now();
  if (!force && now - lastHostPublishAt < 3500) return;

  const track = spotify.currentTrack;
  if (!track?.uri) return;

  lastHostPublishAt = now;
  jam.publishPlayback({
    trackUri: track.uri,
    trackName: track.name,
    artist: (track.artists || []).map(a => a.name).join(', '),
    isPlaying: spotify.isPlaying,
    positionMs: spotify.positionMs || 0,
    durationMs: spotify.durationMs || 0,
  }).catch(() => {});
}

async function applyRemotePlayback(pb) {
  try {
    const currentUri = spotify.currentTrack?.uri;

    if (currentUri !== pb.trackUri) {
      await spotify.play(null, [pb.trackUri]);
      if (!pb.isPlaying) {
        await spotify.pause();
      }
      updateVoteFooter();
      return;
    }

    const targetPos = Math.max(0, Math.round(pb.positionMs + (pb.isPlaying ? (Date.now() - pb.startedAt) : 0)));
    const drift = Math.abs((spotify.positionMs || 0) - targetPos);

    if (drift > 3000) {
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

DOM.btnConnect.addEventListener('click', async () => {
  if (spotify.isLoggedIn()) {
    spotify.logout();
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.npMini.style.display = 'none';
    DOM.btnConnect.style.display = 'flex';
    resetPlayer();
    showToast('Disconnected from Spotify');
  } else {
    await spotify.login();
  }
});

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    console.error('Spotify auth error:', error, params.get('error_description'));
    showToast(`Spotify auth error: ${error}`);
    return;
  }

  if (!code) return;

  window.history.replaceState({}, '', window.location.pathname + window.location.hash);

  try {
    await spotify.handleCallback(code);
    showToast('Spotify connected');
    await connectSpotify();
  } catch (err) {
    console.error('Spotify auth failed:', err);
    showToast(`Spotify error: ${err.message}`);
  }
}

async function connectSpotify() {
  DOM.btnConnect.textContent = 'Connecting...';
  DOM.btnConnect.disabled = true;

  spotify.onReady = () => {
    DOM.btnConnect.style.display = 'none';
    DOM.npMini.style.display = 'flex';
    DOM.btnConnect.disabled = false;
    showToast('Spotify ready');
  };

  spotify.onTrackChange = track => {
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
    showToast('Spotify: ' + msg);
    DOM.btnConnect.style.display = 'flex';
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.btnConnect.disabled = false;
  };

  try {
    await spotify.initPlayer();
  } catch {
    DOM.btnConnect.style.display = 'flex';
    DOM.btnConnect.textContent = 'Connect Spotify';
    DOM.btnConnect.disabled = false;
  }
}

function bindPlayerControls() {
  DOM.btnPlay.addEventListener('click', async () => {
    ambient.init();
    ambient.resume();

    if (!spotify.isLoggedIn()) {
      startAmbientJam();
      showToast('Ambient jam is active. Spotify is optional.');
      return;
    }

    try {
      await spotify.togglePlay();
      maybePublishHostPlayback(true);
    } catch (err) {
      showToast('Could not start playback');
      console.error('[Spotify] Play failed:', err);
    }
  });

  DOM.btnPrev.addEventListener('click', async () => {
    if (!spotify.isLoggedIn()) {
      showToast('Connect Spotify to use track controls');
      return;
    }
    await spotify.previous();
    maybePublishHostPlayback(true);
  });

  DOM.btnNext.addEventListener('click', async () => {
    if (!spotify.isLoggedIn()) {
      showToast('Connect Spotify to use track controls');
      return;
    }
    await spotify.next();
    maybePublishHostPlayback(true);
  });

  DOM.progressTrack.addEventListener('click', async e => {
    if (!spotify.isLoggedIn()) return;
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
  DOM.masterVolume.addEventListener('input', () => {
    const v = DOM.masterVolume.value / 100;
    spotify.setVolume(v);
    ambient.setMasterVolume(v);
  });
}

function enableDiscordJamMode() {
  DOM.btnConnect.textContent = 'Spotify (Optional)';
  if (!spotify.isLoggedIn()) {
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
}

function resetPlayer() {
  DOM.trackName.textContent = isDiscordActivity ? 'Ambient Jam Live' : 'Not Connected';
  DOM.trackArtist.textContent = isDiscordActivity ? 'Spotify is optional in Discord mode' : 'Connect Spotify to listen';
  DOM.trackArt.innerHTML = '<div class="art-default">♪</div>';
  DOM.progressFill.style.width = '0%';
  DOM.timeCurrent.textContent = '0:00';
  DOM.timeTotal.textContent = '0:00';
  updatePlayBtn(false);
}

function updateVoteFooter() {
  const n = discord.getParticipantCount();
  const suggestionCount = jamState?.suggestions?.length || 0;
  const hostLine = jamState?.hostName ? `host: ${jamState.hostName}` : 'no host';
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
  const base = discord.currentUser?.global_name || discord.currentUser?.username || 'Guest';
  return String(base).slice(0, 20);
}

function getRoomShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', jamRoomId || 'global');
  return url.toString();
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
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2800);
}

init();