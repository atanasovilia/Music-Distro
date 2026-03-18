// ── spotify.js ──────────────────────────────────────────────────
// Spotify integration: PKCE OAuth + Web Playback SDK
// No client_secret needed — PKCE only requires your Client ID
// ──────────────────────────────────────────────────────────────

// !! REPLACE WITH YOUR OWN VALUES !!
const CLIENT_ID     = '45b32a563bb846a3974bbe789d9cca0d';
const APP_BASE = (window.__APP_BASE_URL__ || window.location.origin).replace(/\/$/, '');
const REDIRECT_URI  = `${APP_BASE}/callback`;
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

// ── PKCE Helpers ─────────────────────────────────────────────────

function generateCodeVerifier(length = 128) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(b => chars[b % chars.length]).join('');
}

async function generateCodeChallenge(verifier) {
  const enc = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── SpotifyManager ────────────────────────────────────────────────

export class SpotifyManager {
  constructor() {
    this.player = null;
    this.deviceId = null;
    this.token = null;
    this.isPlaying = false;
    this.currentTrack = null;
    this.positionMs = 0;
    this.durationMs = 0;
    this._positionTimer = null;
    this._refreshPromise = null;  // Prevent concurrent token refreshes

    // Callbacks
    this.onReady = () => {};
    this.onTrackChange = () => {};
    this.onPlayStateChange = () => {};
    this.onProgress = () => {};
    this.onError = () => {};
  }

  // ── Auth ───────────────────────────────────────────────────────

  async login() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    // Use localStorage instead of sessionStorage (survives page refresh)
    localStorage.setItem('pkce_verifier', verifier);

    const params = new URLSearchParams({
      client_id:              CLIENT_ID,
      response_type:          'code',
      redirect_uri:           REDIRECT_URI,
      code_challenge_method:  'S256',
      code_challenge:         challenge,
      scope:                  SCOPES,
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  async handleCallback(code) {
    const verifier = localStorage.getItem('pkce_verifier');
    if (!verifier) {
      console.error('❌ No PKCE verifier found in localStorage');
      throw new Error('No PKCE verifier found - try logging in again');
    }

    console.log('✓ Found PKCE verifier, exchanging code...');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ Token exchange failed:', error);
      throw new Error(`Token exchange failed: ${error.error || 'Unknown error'}`);
    }
    
    const data = await res.json();
    console.log('✓ Token exchange successful');
    this._saveTokens(data);
    return data.access_token;
  }

  _saveTokens({ access_token, refresh_token, expires_in }) {
    this.token = access_token;
    const expiry = Date.now() + expires_in * 1000 - 60000;
    localStorage.setItem('spotify_token', access_token);
    localStorage.setItem('spotify_refresh', refresh_token);
    localStorage.setItem('spotify_expiry', expiry);
  }

  async _refreshToken() {
    const refresh = localStorage.getItem('spotify_refresh');
    if (!refresh) return null;

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        grant_type:    'refresh_token',
        refresh_token: refresh,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    this._saveTokens(data);
    return data.access_token;
  }

  async getValidToken() {
    const expiry = parseInt(localStorage.getItem('spotify_expiry') || '0');
    if (Date.now() < expiry && this.token) return this.token;

    const stored = localStorage.getItem('spotify_token');
    if (stored && Date.now() < expiry) {
      this.token = stored;
      return stored;
    }

    // If a refresh is already in progress, wait for it
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    // Start a new refresh
    this._refreshPromise = this._refreshToken();
    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  isLoggedIn() {
    return !!localStorage.getItem('spotify_token');
  }

  logout() {
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_refresh');
    localStorage.removeItem('spotify_expiry');
    this.token = null;
    this.player?.disconnect();
    this.player = null;
  }

  // ── SDK Initialisation ─────────────────────────────────────────

  _waitForSpotifySDK(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (window.Spotify) {
        resolve();
        return;
      }

      // Check if SDK failed to load from CDN
      if (window.__SPOTIFY_SDK_FAILED) {
        reject(new Error('Spotify SDK failed to load from CDN - check network connection'));
        return;
      }

      const timeout = setTimeout(() => {
        window.onSpotifyWebPlaybackSDKReady = null;
        const msg = window.__SPOTIFY_SDK_FAILED 
          ? 'Spotify SDK failed to download from CDN' 
          : 'Spotify SDK load timeout - check network connection';
        reject(new Error(msg));
      }, timeoutMs);

      window.onSpotifyWebPlaybackSDKReady = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  async initPlayer() {
    const token = await this.getValidToken();
    if (!token) { this.onError('Not authenticated'); return; }

    try {
      await this._waitForSpotifySDK();
    } catch (err) {
      this.onError('Spotify SDK not loaded');
      throw err;
    }

    return new Promise((resolve, reject) => {

      this.player = new window.Spotify.Player({
        name: 'LoFi Spaces 🌊',
        getOAuthToken: async cb => {
          const t = await this.getValidToken();
          cb(t);
        },
        volume: 0.8,
      });

      this.player.addListener('ready', async ({ device_id }) => {
        console.log('[Spotify] Ready, device:', device_id);
        this.deviceId = device_id;
        // Make this Web Playback SDK device active in the user's account.
        try {
          await this.activateDevice(false);
        } catch (err) {
          console.warn('[Spotify] Could not activate device:', err?.message || err);
        }
        this.onReady(device_id);
        resolve(device_id);
      });

      this.player.addListener('not_ready', ({ device_id }) => {
        console.warn('[Spotify] Not ready:', device_id);
      });

      this.player.addListener('player_state_changed', state => {
        if (!state) return;
        const track = state.track_window?.current_track;
        const wasPlaying = this.isPlaying;
        this.isPlaying = !state.paused;
        this.positionMs = state.position;
        this.durationMs = state.duration;

        if (track && track.id !== this.currentTrack?.id) {
          this.currentTrack = track;
          this.onTrackChange(track);
        }

        if (this.isPlaying !== wasPlaying) {
          this.onPlayStateChange(this.isPlaying);
        }

        this._trackProgress();
        this.onProgress(state.position, state.duration);
      });

      this.player.addListener('initialization_error', ({ message }) => {
        this.onError('Init error: ' + message); reject(message);
      });
      this.player.addListener('authentication_error', ({ message }) => {
        this.onError('Auth error: ' + message); reject(message);
      });
      this.player.addListener('account_error', ({ message }) => {
        this.onError('Account error (Premium required): ' + message); reject(message);
      });

      this.player.connect();
    });
  }

  _trackProgress() {
    clearInterval(this._positionTimer);
    if (!this.isPlaying) return;
    const start = Date.now();
    const startPos = this.positionMs;
    this._positionTimer = setInterval(() => {
      const pos = startPos + (Date.now() - start);
      if (pos >= this.durationMs) { clearInterval(this._positionTimer); return; }
      this.onProgress(pos, this.durationMs);
    }, 500);
  }

  // ── Playback Controls ──────────────────────────────────────────

  async activateDevice(play = false) {
    if (!this.deviceId) return;
    const token = await this.getValidToken();
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_ids: [this.deviceId],
        play,
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(error?.error?.message || 'Failed to activate Spotify device');
    }
  }

  async play(contextUri = null, uris = null) {
    if (!this.deviceId) return;
    const token = await this.getValidToken();
    const body = {};
    if (contextUri) body.context_uri = contextUri;
    if (uris) body.uris = uris;

    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(error?.error?.message || 'Failed to start playback');
    }
  }

  async pause() {
    await this.player?.pause();
  }

  async resume() {
    await this.player?.resume();
  }

  async togglePlay() {
    if (this.isPlaying) {
      await this.pause();
      return;
    }

    // If nothing is loaded yet, queue and start a recommendation so Play works immediately.
    if (!this.currentTrack) {
      const recs = await this.getRecommendations(['chill', 'lo-fi'], 1);
      if (recs.length > 0) {
        await this.play(null, [recs[0].uri]);
        return;
      }
    }

    await this.resume();
  }

  async next() {
    await this.player?.nextTrack();
  }

  async previous() {
    await this.player?.previousTrack();
  }

  async setVolume(v) {
    try {
      await this.player?.setVolume(v);
    } catch (err) {
      console.warn('[Spotify] Failed to set volume:', err?.message || err);
    }
  }

  async seekTo(posMs) {
    try {
      await this.player?.seek(posMs);
    } catch (err) {
      console.warn('[Spotify] Failed to seek:', err?.message || err);
      throw err;
    }
  }

  // ── Queue / Recommendations ────────────────────────────────────

  async getRecommendations(seedGenres = ['chill', 'lo-fi'], limit = 5) {
    const token = await this.getValidToken();
    const params = new URLSearchParams({
      seed_genres: seedGenres.join(','),
      limit,
      target_energy: 0.3,
      target_valence: 0.5,
      target_instrumentalness: 0.7,
    });

    const res = await fetch(`https://api.spotify.com/v1/recommendations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tracks || [];
  }

  async getQueue() {
    const token = await this.getValidToken();
    const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { queue: [] };
    return await res.json();
  }

  async addToQueue(uri) {
    const token = await this.getValidToken();
    const res = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${uri}&device_id=${this.deviceId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(error?.error?.message || 'Failed to add track to queue');
    }
  }

  async getUserPlaylists(limit = 10) {
    const token = await this.getValidToken();
    const res = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }
}
