const ROOM_STORE = globalThis.__LOFI_JAM_ROOMS__ || new Map();
globalThis.__LOFI_JAM_ROOMS__ = ROOM_STORE;

function roomKey(raw) {
  return String(raw || 'global').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'global';
}

function defaultState(roomId) {
  return {
    roomId,
    version: 1,
    hostId: null,
    hostName: null,
    suggestions: [],
    playback: null,
    updatedAt: Date.now(),
  };
}

function getRoomState(roomId) {
  const key = roomKey(roomId);
  if (!ROOM_STORE.has(key)) {
    ROOM_STORE.set(key, defaultState(key));
  }
  return ROOM_STORE.get(key);
}

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(JSON.stringify(payload));
}

function bump(state) {
  state.version += 1;
  state.updatedAt = Date.now();
}

function applyAction(state, action, payload, actor) {
  if (!action) return;

  if (action === 'set-host') {
    state.hostId = actor?.id || null;
    state.hostName = actor?.name || null;
    bump(state);
    return;
  }

  if (action === 'clear-host') {
    if (state.hostId === actor?.id) {
      state.hostId = null;
      state.hostName = null;
      bump(state);
    }
    return;
  }

  if (action === 'suggest') {
    const t = payload?.track;
    if (!t?.uri || !t?.name) return;
    const exists = state.suggestions.find(s => s.uri === t.uri);
    if (exists) return;
    state.suggestions.unshift({
      uri: t.uri,
      name: t.name,
      artist: t.artist || 'Unknown',
      art: t.art || null,
      addedBy: actor?.name || 'Guest',
      votes: 0,
      voters: [],
      createdAt: Date.now(),
    });
    state.suggestions = state.suggestions.slice(0, 20);
    bump(state);
    return;
  }

  if (action === 'vote') {
    const uri = payload?.uri;
    if (!uri || !actor?.id) return;
    const suggestion = state.suggestions.find(s => s.uri === uri);
    if (!suggestion) return;

    const hadVotedUri = state.suggestions.find(s => s.voters.includes(actor.id));
    if (hadVotedUri && hadVotedUri.uri !== uri) {
      hadVotedUri.voters = hadVotedUri.voters.filter(v => v !== actor.id);
      hadVotedUri.votes = hadVotedUri.voters.length;
    }

    if (suggestion.voters.includes(actor.id)) {
      suggestion.voters = suggestion.voters.filter(v => v !== actor.id);
    } else {
      suggestion.voters.push(actor.id);
    }
    suggestion.votes = suggestion.voters.length;

    state.suggestions.sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return b.createdAt - a.createdAt;
    });
    bump(state);
    return;
  }

  if (action === 'remove-suggestion') {
    if (state.hostId !== actor?.id) return;
    const uri = payload?.uri;
    if (!uri) return;
    state.suggestions = state.suggestions.filter(s => s.uri !== uri);
    bump(state);
    return;
  }

  if (action === 'playback') {
    if (state.hostId !== actor?.id) return;
    const pb = payload?.playback;
    if (!pb?.trackUri) return;
    state.playback = {
      trackUri: pb.trackUri,
      trackName: pb.trackName || 'Track',
      artist: pb.artist || '',
      isPlaying: !!pb.isPlaying,
      positionMs: Number(pb.positionMs || 0),
      durationMs: Number(pb.durationMs || 0),
      startedAt: Date.now(),
    };
    bump(state);
  }
}

module.exports = async function handler(req, res) {
  const method = req.method || 'GET';

  if (method === 'GET') {
    const state = getRoomState(req.query?.roomId);
    return json(res, 200, { ok: true, state });
  }

  if (method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const state = getRoomState(body.roomId);

    applyAction(state, body.action, body.payload || {}, {
      id: body.userId || null,
      name: body.userName || null,
    });

    return json(res, 200, { ok: true, state });
  }

  return json(res, 405, { ok: false, error: 'Method not allowed' });
};
