// ── main.js ─────────────────────────────────────────────────────
// Application controller — wires together scenes, ambient, Spotify, Discord
// ──────────────────────────────────────────────────────────────

import { SCENES, getScene } from './scenes.js';
import { AmbientEngine }    from './ambient.js';
import { SpotifyManager }   from './spotify.js';
import { DiscordManager }   from './discord.js';

// ── Singletons ────────────────────────────────────────────────

const ambient = new AmbientEngine();
const spotify = new SpotifyManager();
const discord = new DiscordManager();

// ── State ─────────────────────────────────────────────────────

let currentSceneId = 'beach';
let votes = {};          // trackUri → { track, count, voters: Set }
let localVote = null;    // uri the local user has voted for

// ── DOM refs ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const DOM = {
  body:           document.body,
  sceneBg:        $('scene-bg'),
  sceneList:      $('scene-list'),
  sceneEmoji:     $('scene-emoji'),
  sceneName:      $('scene-name'),
  sceneTagline:   $('scene-tagline'),
  participants:   $('participants'),
  btnConnect:     $('btn-spotify-connect'),
  npMini:         $('now-playing-mini'),
  npMiniText:     $('np-mini-text'),
  mixerChannels:  $('mixer-channels'),
  btnAllOn:       $('btn-all-on'),
  btnAllOff:      $('btn-all-off'),
  trackArt:       $('track-art'),
  trackName:      $('track-name'),
  trackArtist:    $('track-artist'),
  btnPlay:        $('btn-play'),
  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  progressFill:   $('progress-fill'),
  progressTrack:  $('progress-track'),
  timeCurrent:    $('time-current'),
  timeTotal:      $('time-total'),
  masterVolume:   $('master-volume'),
  voteOptions:    $('vote-options'),
  voteFooter:     $('vote-footer'),
  toast:          $('toast'),
};

// ── Startup ───────────────────────────────────────────────────

async function init() {
  buildSceneList();
  switchScene('beach', false);   // initial scene, no audio (no user gesture yet)
  bindPlayerControls();
  bindVolumeControls();
  handleSpotifyCallback();

  // Discord
  discord.onParticipantsChange = p => discord.renderAvatars(DOM.participants);
  discord.onUserJoin  = u => showToast(`🎵 ${u?.username || 'Someone'} joined!`);
  discord.onUserLeave = u => showToast(`👋 ${u?.name || 'Someone'} left`);
  await discord.init();

  // Spotify: restore session
  if (spotify.isLoggedIn()) {
    await connectSpotify();
  }
}

// ── Scene Management ──────────────────────────────────────────

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
  const prev  = currentSceneId;
  currentSceneId = id;

  // Update body class
  DOM.body.className = `scene-${id}`;

  // Update scene bg class
  DOM.sceneBg.className = `scene-bg scene-${id}`;

  // Update hero text
  DOM.sceneEmoji.textContent   = scene.emoji;
  DOM.sceneName.textContent    = scene.name;
  DOM.sceneTagline.textContent = scene.tagline;

  // Update active button
  document.querySelectorAll('.scene-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.id === id);
  });

  // Teardown previous scene's channels
  if (prev && prev !== id) {
    const prevScene = getScene(prev);
    const prevIds = prevScene.ambients.map(a => a.id);
    ambient.teardown(prevIds);
  }

  // Build mixer UI + setup audio channels for this scene
  buildMixer(scene, playAudio);
}

// ── Mixer UI ──────────────────────────────────────────────────

function buildMixer(scene, startAudio = true) {
  DOM.mixerChannels.innerHTML = '';

  scene.ambients.forEach(ch => {
    // Setup audio channel
    if (startAudio) {
      ambient.init();
      ambient.resume();
      ambient.setup(ch.id, ch.defaultOn, ch.defaultVol);
    }

    // Build UI
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
      <input type="range" class="channel-slider" id="vol-${ch.id}"
        min="0" max="100" value="${Math.round(ch.defaultVol * 100)}">
    `;

    const toggle = div.querySelector(`#tog-${ch.id}`);
    const slider = div.querySelector(`#vol-${ch.id}`);

    toggle.addEventListener('change', () => {
      if (!ambient._ready) { ambient.init(); ambient.resume(); ambient.setup(ch.id, false, ch.defaultVol); }
      ambient.toggle(ch.id, toggle.checked);
      div.classList.toggle('active', toggle.checked);
    });

    slider.addEventListener('input', () => {
      if (!ambient._ready) { ambient.init(); ambient.resume(); ambient.setup(ch.id, false, ch.defaultVol); }
      ambient.setVolume(ch.id, slider.value / 100);
    });

    DOM.mixerChannels.appendChild(div);
  });
}

// ── All On / All Off ──────────────────────────────────────────

DOM.btnAllOn.addEventListener('click', () => {
  if (!ambient._ready) { ambient.init(); ambient.resume(); }
  const scene = getScene(currentSceneId);
  scene.ambients.forEach(ch => {
    if (!ambient.channels[ch.id]) ambient.setup(ch.id, false, ch.defaultVol);
    ambient.toggle(ch.id, true);
    const tog = document.querySelector(`#tog-${ch.id}`);
    const div = document.querySelector(`#ch-${ch.id}`);
    if (tog) tog.checked = true;
    if (div) div.classList.add('active');
  });
});

DOM.btnAllOff.addEventListener('click', () => {
  ambient.toggleAll(false);
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.toggle input').forEach(el => el.checked = false);
});

// ── Spotify Controls ──────────────────────────────────────────

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
    console.error('❌ Spotify auth error:', error, params.get('error_description'));
    showToast(`❌ Spotify auth error: ${error}`);
    return;
  }
  
  if (!code) {
    console.log('ℹ️  No Spotify callback code found');
    return;
  }

  console.log('🔄 Processing Spotify callback...');
  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);

  try {
    console.log('🔑 Exchanging auth code for token...');
    await spotify.handleCallback(code);
    console.log('✅ Spotify connected!');
    showToast('🎵 Spotify connected!');
    await connectSpotify();
  } catch (err) {
    console.error('❌ Spotify auth failed:', err);
    showToast(`❌ Spotify error: ${err.message}`);
  }
}

async function connectSpotify() {
  DOM.btnConnect.textContent = 'Connecting…';
  DOM.btnConnect.disabled = true;

  spotify.onReady = () => {
    DOM.btnConnect.style.display = 'none';
    DOM.npMini.style.display = 'flex';
    DOM.btnConnect.disabled = false;
    showToast('🎵 Spotify ready!');
    loadVoteCandidates();
  };

  spotify.onTrackChange = track => {
    updateTrackUI(track);
    DOM.npMiniText.textContent = truncate(track.name, 22);
    loadVoteCandidates();
  };

  spotify.onPlayStateChange = playing => {
    updatePlayBtn(playing);
  };

  spotify.onProgress = (pos, dur) => {
    updateProgress(pos, dur);
  };

  spotify.onError = msg => {
    showToast('⚠️ ' + msg);
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

// ── Player UI ─────────────────────────────────────────────────

function bindPlayerControls() {
  DOM.btnPlay.addEventListener('click', async () => {
    ambient.init(); ambient.resume();   // ensure audio context on gesture
    try {
      await spotify.togglePlay();
    } catch (err) {
      showToast('⚠️ ' + (err?.message || 'Could not start playback'));
      console.error('[Spotify] Play failed:', err);
    }
  });
  DOM.btnPrev.addEventListener('click', () => spotify.previous());
  DOM.btnNext.addEventListener('click', () => spotify.next());

  DOM.progressTrack.addEventListener('click', async e => {
    try {
      const pct = e.offsetX / DOM.progressTrack.offsetWidth;
      await spotify.seekTo(Math.round(pct * spotify.durationMs));
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

function updateTrackUI(track) {
  DOM.trackName.textContent   = track.name;
  DOM.trackArtist.textContent = track.artists?.map(a => a.name).join(', ') || '';

  const art = DOM.trackArt;
  const img = track.album?.images?.[0]?.url;
  if (img) {
    art.innerHTML = `<img src="${img}" alt="Album art">`;
  } else {
    art.innerHTML = '<div class="art-default">♪</div>';
  }
}

function updatePlayBtn(isPlaying) {
  DOM.btnPlay.querySelector('.icon-play').style.display  = isPlaying ? 'none' : 'block';
  DOM.btnPlay.querySelector('.icon-pause').style.display = isPlaying ? 'block' : 'none';
}

function updateProgress(pos, dur) {
  const pct = dur ? (pos / dur) * 100 : 0;
  DOM.progressFill.style.width = pct + '%';
  DOM.timeCurrent.textContent  = msToTime(pos);
  DOM.timeTotal.textContent    = msToTime(dur);
}

function resetPlayer() {
  DOM.trackName.textContent   = 'Not Connected';
  DOM.trackArtist.textContent = 'Link Spotify above to listen';
  DOM.trackArt.innerHTML      = '<div class="art-default">♪</div>';
  DOM.progressFill.style.width = '0%';
  DOM.timeCurrent.textContent  = '0:00';
  DOM.timeTotal.textContent    = '0:00';
  updatePlayBtn(false);
  DOM.voteOptions.innerHTML = '<div class="vote-empty">Connect Spotify to start voting</div>';
}

// ── Voting System ─────────────────────────────────────────────

async function loadVoteCandidates() {
  try {
    const { queue } = await spotify.getQueue();
    let candidates = queue?.slice(0, 3) || [];

    // If queue is short, pad with recommendations
    if (candidates.length < 3) {
      const recs = await spotify.getRecommendations(['chill', 'lo-fi'], 3 - candidates.length);
      candidates = [...candidates, ...recs];
    }

    renderVoteOptions(candidates.slice(0, 3));
  } catch (err) {
    console.warn('[Vote] Could not load candidates:', err);
  }
}

function renderVoteOptions(tracks) {
  DOM.voteOptions.innerHTML = '';
  tracks.forEach(track => {
    const uri = track.uri;
    const v = votes[uri] || { count: 0, voters: new Set() };
    const totalVotes = Object.values(votes).reduce((s, x) => s + x.count, 0);
    const pct = totalVotes ? Math.round((v.count / totalVotes) * 100) : 0;

    const div = document.createElement('div');
    div.className = `vote-option ${localVote === uri ? 'voted' : ''}`;
    div.style.position = 'relative';
    div.innerHTML = `
      <div class="vo-art">
        ${track.album?.images?.[2]?.url
          ? `<img src="${track.album.images[2].url}" alt="">`
          : '🎵'}
      </div>
      <div class="vo-info">
        <div class="vo-name">${track.name}</div>
        <div class="vo-artist">${track.artists?.map(a => a.name).join(', ')}</div>
      </div>
      <div class="vo-count">${v.count > 0 ? v.count + ' 🗳' : '—'}</div>
      <div class="vote-bar" style="width:${pct}%"></div>
    `;

    div.addEventListener('click', () => castVote(uri, track, tracks));
    DOM.voteOptions.appendChild(div);
  });

  updateVoteFooter();
}

function castVote(uri, track, tracks) {
  // Remove previous vote
  if (localVote && votes[localVote]) {
    votes[localVote].count = Math.max(0, votes[localVote].count - 1);
  }

  if (localVote === uri) {
    // Unvote
    localVote = null;
  } else {
    localVote = uri;
    if (!votes[uri]) votes[uri] = { track, count: 0, voters: new Set() };
    votes[uri].count++;
  }

  renderVoteOptions(tracks);
  checkVoteWinner(tracks);
  showToast(localVote ? `✅ Voted for "${truncate(track.name, 20)}"` : '❌ Vote removed');
}

function checkVoteWinner(tracks) {
  // Auto-queue if one track gets majority
  const total = tracks.length;
  const winner = Object.entries(votes).find(([, v]) => v.count > total / 2);
  if (winner) {
    const [uri, data] = winner;
    showToast(`🏆 "${truncate(data.track?.name || 'Track', 20)}" wins the vote!`);
    spotify.addToQueue(uri).catch(() => {});
    votes = {};
    localVote = null;
    setTimeout(() => loadVoteCandidates(), 2000);
  }
}

function updateVoteFooter() {
  const total = Object.values(votes).reduce((s, v) => s + v.count, 0);
  const n = discord.getParticipantCount();
  DOM.voteFooter.textContent = total > 0
    ? `${total} vote${total > 1 ? 's' : ''} · ${n} listening`
    : `${n} listening · vote to skip`;
}

// ── Utilities ─────────────────────────────────────────────────

function msToTime(ms) {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function truncate(str, max) {
  return str?.length > max ? str.slice(0, max) + '…' : str;
}

let _toastTimer;
function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2800);
}

// ── Boot ──────────────────────────────────────────────────────
init();
