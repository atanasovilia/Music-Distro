const ROOM_TTL_SECONDS = 60 * 60 * 24 * 7;
const ROOM_STORE = globalThis.__LOFI_JAM_ROOMS__ || new Map();
const { Redis } = require('@upstash/redis');

globalThis.__LOFI_JAM_ROOMS__ = ROOM_STORE;

const APPLY_ACTION_SCRIPT = `
local null = cjson.null

local function is_null(value)
  return value == nil or value == null
end

local function as_string(value)
  if is_null(value) then
    return nil
  end
  return tostring(value)
end

local function decode_json(raw, fallback)
  if not raw then
    return fallback
  end

  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == "table" then
    return decoded
  end

  return fallback
end

local function now_ms()
  local parts = redis.call("TIME")
  return tonumber(parts[1]) * 1000 + math.floor(tonumber(parts[2]) / 1000)
end

local function clamp_focus_duration(value)
  local duration = tonumber(value) or 1500000
  if duration < 60000 then
    duration = 60000
  end
  if duration > 10800000 then
    duration = 10800000
  end
  return duration
end

local function default_state(room_id)
  return {
    roomId = room_id,
    version = 1,
    hostId = null,
    hostName = null,
    suggestions = {},
    playback = null,
    focusTimer = {
      durationMs = 1500000,
      remainingMs = 1500000,
      isRunning = false,
      startedAt = 0,
      updatedBy = null
    },
    updatedAt = 0
  }
end

local function normalize_suggestion(item)
  if type(item) ~= "table" then
    return nil
  end

  local uri = as_string(item.uri)
  local name = as_string(item.name)
  if not uri or not name then
    return nil
  end

  local voters = {}
  if type(item.voters) == "table" then
    for i = 1, #item.voters do
      local voter = as_string(item.voters[i])
      if voter then
        voters[#voters + 1] = voter
      end
    end
  end

  return {
    uri = uri,
    name = name,
    artist = as_string(item.artist) or "Unknown",
    art = as_string(item.art) or null,
    addedBy = as_string(item.addedBy) or "Guest",
    votes = tonumber(item.votes) or #voters,
    voters = voters,
    createdAt = tonumber(item.createdAt) or 0
  }
end

local function normalize_focus_timer(item)
  local source = type(item) == "table" and item or {}
  local duration_ms = clamp_focus_duration(source.durationMs)
  local remaining_ms = tonumber(source.remainingMs) or duration_ms
  if remaining_ms < 0 then
    remaining_ms = 0
  end
  if remaining_ms > duration_ms then
    remaining_ms = duration_ms
  end

  return {
    durationMs = duration_ms,
    remainingMs = remaining_ms,
    isRunning = not not source.isRunning,
    startedAt = tonumber(source.startedAt) or 0,
    updatedBy = as_string(source.updatedBy) or null
  }
end

local function normalize_state(state, room_id)
  if type(state) ~= "table" then
    state = default_state(room_id)
  end

  state.roomId = room_id
  state.version = tonumber(state.version) or 1
  state.updatedAt = tonumber(state.updatedAt) or 0

  if type(state.suggestions) ~= "table" then
    state.suggestions = {}
  else
    local normalized = {}
    for i = 1, #state.suggestions do
      local suggestion = normalize_suggestion(state.suggestions[i])
      if suggestion then
        normalized[#normalized + 1] = suggestion
      end
    end
    state.suggestions = normalized
  end

  if type(state.playback) ~= "table" then
    state.playback = null
  end

  state.focusTimer = normalize_focus_timer(state.focusTimer)

  return state
end

local function index_of(items, value)
  if type(items) ~= "table" then
    return nil
  end

  for i = 1, #items do
    if items[i] == value then
      return i
    end
  end

  return nil
end

local function find_suggestion_index(suggestions, uri)
  for i = 1, #suggestions do
    if suggestions[i].uri == uri then
      return i
    end
  end

  return nil
end

local function find_voted_suggestion_index(suggestions, actor_id)
  for i = 1, #suggestions do
    if index_of(suggestions[i].voters, actor_id) then
      return i
    end
  end

  return nil
end

local function recalc_votes(suggestion)
  if type(suggestion.voters) ~= "table" then
    suggestion.voters = {}
  end

  suggestion.votes = #suggestion.voters
end

local room_id = ARGV[1]
local action = ARGV[2]
local payload = decode_json(ARGV[3], {})
local actor = decode_json(ARGV[4], {})
local ttl_seconds = tonumber(ARGV[5]) or 604800
local actor_id = as_string(actor.id)
local actor_name = as_string(actor.name) or "Guest"
local raw = redis.call("GET", KEYS[1])
local state = normalize_state(decode_json(raw, default_state(room_id)), room_id)
local changed = false

local function bump()
  state.version = (tonumber(state.version) or 1) + 1
  state.updatedAt = now_ms()
  changed = true
end

if action == "set-host" then
  state.hostId = actor_id or null
  state.hostName = actor_id and actor_name or null
  bump()
elseif action == "clear-host" then
  if actor_id and state.hostId == actor_id then
    state.hostId = null
    state.hostName = null
    bump()
  end
elseif action == "suggest" then
  local track = type(payload.track) == "table" and payload.track or nil
  local uri = track and as_string(track.uri) or nil
  local name = track and as_string(track.name) or nil

  if uri and name and not find_suggestion_index(state.suggestions, uri) then
    table.insert(state.suggestions, 1, {
      uri = uri,
      name = name,
      artist = as_string(track.artist) or "Unknown",
      art = as_string(track.art) or null,
      addedBy = actor_name,
      votes = 0,
      voters = {},
      createdAt = now_ms()
    })

    while #state.suggestions > 20 do
      table.remove(state.suggestions)
    end

    bump()
  end
elseif action == "vote" then
  local uri = as_string(payload.uri)
  local suggestion_index = uri and actor_id and find_suggestion_index(state.suggestions, uri) or nil

  if suggestion_index then
    local previous_index = find_voted_suggestion_index(state.suggestions, actor_id)
    if previous_index and previous_index ~= suggestion_index then
      local previous = state.suggestions[previous_index]
      local previous_vote_index = index_of(previous.voters, actor_id)
      if previous_vote_index then
        table.remove(previous.voters, previous_vote_index)
        recalc_votes(previous)
      end
    end

    local suggestion = state.suggestions[suggestion_index]
    local vote_index = index_of(suggestion.voters, actor_id)

    if vote_index then
      table.remove(suggestion.voters, vote_index)
    else
      suggestion.voters[#suggestion.voters + 1] = actor_id
    end

    recalc_votes(suggestion)
    table.sort(state.suggestions, function(a, b)
      local a_votes = tonumber(a.votes) or 0
      local b_votes = tonumber(b.votes) or 0
      if a_votes ~= b_votes then
        return a_votes > b_votes
      end
      return (tonumber(a.createdAt) or 0) > (tonumber(b.createdAt) or 0)
    end)

    bump()
  end
elseif action == "remove-suggestion" then
  local uri = as_string(payload.uri)

  if actor_id and state.hostId == actor_id and uri then
    local next_suggestions = {}
    for i = 1, #state.suggestions do
      if state.suggestions[i].uri ~= uri then
        next_suggestions[#next_suggestions + 1] = state.suggestions[i]
      end
    end

    if #next_suggestions ~= #state.suggestions then
      state.suggestions = next_suggestions
      bump()
    end
  end
elseif action == "playback" then
  local playback = type(payload.playback) == "table" and payload.playback or nil
  local track_uri = playback and as_string(playback.trackUri) or nil

  if actor_id and state.hostId == actor_id and track_uri then
    state.playback = {
      trackUri = track_uri,
      trackName = as_string(playback.trackName) or "Track",
      artist = as_string(playback.artist) or "",
      isPlaying = not not playback.isPlaying,
      positionMs = tonumber(playback.positionMs) or 0,
      durationMs = tonumber(playback.durationMs) or 0,
      startedAt = now_ms()
    }
    bump()
  end
elseif action == "focus-set" then
  if actor_id and state.hostId == actor_id then
    local duration_ms = clamp_focus_duration(payload.durationMs)
    state.focusTimer = {
      durationMs = duration_ms,
      remainingMs = duration_ms,
      isRunning = false,
      startedAt = 0,
      updatedBy = actor_name
    }
    bump()
  end
elseif action == "focus-start" then
  if actor_id and state.hostId == actor_id then
    local timer = normalize_focus_timer(state.focusTimer)
    local remaining_ms = tonumber(timer.remainingMs) or tonumber(timer.durationMs) or 1500000
    if remaining_ms <= 0 then
      remaining_ms = tonumber(timer.durationMs) or 1500000
    end
    state.focusTimer = {
      durationMs = tonumber(timer.durationMs) or 1500000,
      remainingMs = remaining_ms,
      isRunning = true,
      startedAt = now_ms(),
      updatedBy = actor_name
    }
    bump()
  end
elseif action == "focus-pause" then
  if actor_id and state.hostId == actor_id then
    local timer = normalize_focus_timer(state.focusTimer)
    local remaining_ms = tonumber(timer.remainingMs) or tonumber(timer.durationMs) or 1500000
    if timer.isRunning and tonumber(timer.startedAt) and tonumber(timer.startedAt) > 0 then
      remaining_ms = math.max(0, remaining_ms - math.max(0, now_ms() - tonumber(timer.startedAt)))
    end
    state.focusTimer = {
      durationMs = tonumber(timer.durationMs) or 1500000,
      remainingMs = remaining_ms,
      isRunning = false,
      startedAt = 0,
      updatedBy = actor_name
    }
    bump()
  end
elseif action == "focus-reset" then
  if actor_id and state.hostId == actor_id then
    local timer = normalize_focus_timer(state.focusTimer)
    local duration_ms = tonumber(timer.durationMs) or 1500000
    state.focusTimer = {
      durationMs = duration_ms,
      remainingMs = duration_ms,
      isRunning = false,
      startedAt = 0,
      updatedBy = actor_name
    }
    bump()
  end
elseif action == "focus-complete" then
  if actor_id and state.hostId == actor_id then
    local timer = normalize_focus_timer(state.focusTimer)
    state.focusTimer = {
      durationMs = tonumber(timer.durationMs) or 1500000,
      remainingMs = 0,
      isRunning = false,
      startedAt = 0,
      updatedBy = actor_name
    }
    bump()
  end
end

if changed then
  redis.call("SET", KEYS[1], cjson.encode(state), "EX", ttl_seconds)
elseif raw then
  redis.call("EXPIRE", KEYS[1], ttl_seconds)
end

return cjson.encode(state)
`;

function roomKey(raw) {
  return String(raw || 'global')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40) || 'global';
}

function redisRoomKey(roomId) {
  return `lofi-spaces:jam:room:${roomKey(roomId)}`;
}

function clampFocusDuration(value) {
  const duration = Number(value) || 25 * 60 * 1000;
  return Math.min(3 * 60 * 60 * 1000, Math.max(60 * 1000, duration));
}

function normalizeFocusTimer(input) {
  const durationMs = clampFocusDuration(input?.durationMs);
  const rawRemaining = Number(input?.remainingMs);
  const remainingMs = Number.isFinite(rawRemaining)
    ? Math.min(durationMs, Math.max(0, rawRemaining))
    : durationMs;

  return {
    durationMs,
    remainingMs,
    isRunning: !!input?.isRunning,
    startedAt: Number(input?.startedAt) || 0,
    updatedBy: input?.updatedBy ? String(input.updatedBy) : null,
  };
}

function defaultState(roomId) {
  return {
    roomId,
    version: 1,
    hostId: null,
    hostName: null,
    suggestions: [],
    playback: null,
    focusTimer: normalizeFocusTimer(null),
    updatedAt: 0,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseStoredState(raw, roomId) {
  if (!raw) {
    return normalizeState(null, roomId);
  }

  try {
    return normalizeState(JSON.parse(raw), roomId);
  } catch {
    return normalizeState(null, roomId);
  }
}

function normalizeSuggestion(item) {
  if (!item || typeof item !== 'object') return null;
  if (!item.uri || !item.name) return null;

  const voters = Array.isArray(item.voters)
    ? item.voters.filter(Boolean).map(v => String(v))
    : [];

  return {
    uri: String(item.uri),
    name: String(item.name),
    artist: item.artist ? String(item.artist) : 'Unknown',
    art: item.art ? String(item.art) : null,
    addedBy: item.addedBy ? String(item.addedBy) : 'Guest',
    votes: Number.isFinite(Number(item.votes)) ? Number(item.votes) : voters.length,
    voters,
    createdAt: Number(item.createdAt) || 0,
  };
}

function normalizeState(input, roomId) {
  const fallback = defaultState(roomKey(roomId));
  const state = input && typeof input === 'object' ? input : fallback;
  const suggestions = Array.isArray(state.suggestions)
    ? state.suggestions.map(normalizeSuggestion).filter(Boolean)
    : [];

  return {
    roomId: roomKey(roomId),
    version: Number(state.version) || 1,
    hostId: state.hostId ? String(state.hostId) : null,
    hostName: state.hostName ? String(state.hostName) : null,
    suggestions,
    playback: state.playback && typeof state.playback === 'object'
      ? {
          trackUri: state.playback.trackUri ? String(state.playback.trackUri) : null,
          trackName: state.playback.trackName ? String(state.playback.trackName) : 'Track',
          artist: state.playback.artist ? String(state.playback.artist) : '',
          isPlaying: !!state.playback.isPlaying,
          positionMs: Number(state.playback.positionMs) || 0,
          durationMs: Number(state.playback.durationMs) || 0,
          startedAt: Number(state.playback.startedAt) || 0,
        }
      : null,
    focusTimer: normalizeFocusTimer(state.focusTimer),
    updatedAt: Number(state.updatedAt) || 0,
  };
}

function bump(state, now = Date.now()) {
  state.version = Number(state.version || 1) + 1;
  state.updatedAt = now;
}

function applyAction(state, action, payload, actor, now = Date.now()) {
  if (!action) return false;

  const actorId = actor?.id ? String(actor.id) : null;
  const actorName = actor?.name ? String(actor.name) : 'Guest';

  if (action === 'set-host') {
    state.hostId = actorId;
    state.hostName = actorId ? actorName : null;
    bump(state, now);
    return true;
  }

  if (action === 'clear-host') {
    if (state.hostId === actorId) {
      state.hostId = null;
      state.hostName = null;
      bump(state, now);
      return true;
    }
    return false;
  }

  if (action === 'suggest') {
    const track = payload?.track;
    if (!track?.uri || !track?.name) return false;
    if (state.suggestions.some(s => s.uri === track.uri)) return false;

    state.suggestions.unshift({
      uri: String(track.uri),
      name: String(track.name),
      artist: track.artist ? String(track.artist) : 'Unknown',
      art: track.art ? String(track.art) : null,
      addedBy: actorName,
      votes: 0,
      voters: [],
      createdAt: now,
    });
    state.suggestions = state.suggestions.slice(0, 20);
    bump(state, now);
    return true;
  }

  if (action === 'vote') {
    const uri = payload?.uri ? String(payload.uri) : null;
    if (!uri || !actorId) return false;

    const suggestion = state.suggestions.find(s => s.uri === uri);
    if (!suggestion) return false;

    const previous = state.suggestions.find(s => s.voters.includes(actorId));
    if (previous && previous.uri !== uri) {
      previous.voters = previous.voters.filter(v => v !== actorId);
      previous.votes = previous.voters.length;
    }

    if (suggestion.voters.includes(actorId)) {
      suggestion.voters = suggestion.voters.filter(v => v !== actorId);
    } else {
      suggestion.voters.push(actorId);
    }
    suggestion.votes = suggestion.voters.length;

    state.suggestions.sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return b.createdAt - a.createdAt;
    });
    bump(state, now);
    return true;
  }

  if (action === 'remove-suggestion') {
    if (state.hostId !== actorId) return false;
    const uri = payload?.uri ? String(payload.uri) : null;
    if (!uri) return false;

    const nextSuggestions = state.suggestions.filter(s => s.uri !== uri);
    if (nextSuggestions.length === state.suggestions.length) return false;

    state.suggestions = nextSuggestions;
    bump(state, now);
    return true;
  }

  if (action === 'playback') {
    if (state.hostId !== actorId) return false;
    const pb = payload?.playback;
    if (!pb?.trackUri) return false;

    state.playback = {
      trackUri: String(pb.trackUri),
      trackName: pb.trackName ? String(pb.trackName) : 'Track',
      artist: pb.artist ? String(pb.artist) : '',
      isPlaying: !!pb.isPlaying,
      positionMs: Number(pb.positionMs) || 0,
      durationMs: Number(pb.durationMs) || 0,
      startedAt: now,
    };
    bump(state, now);
    return true;
  }

  if (action === 'focus-set') {
    if (state.hostId !== actorId) return false;
    const durationMs = clampFocusDuration(payload?.durationMs);

    state.focusTimer = {
      durationMs,
      remainingMs: durationMs,
      isRunning: false,
      startedAt: 0,
      updatedBy: actorName,
    };
    bump(state, now);
    return true;
  }

  if (action === 'focus-start') {
    if (state.hostId !== actorId) return false;
    const timer = normalizeFocusTimer(state.focusTimer);
    const remainingMs = timer.remainingMs > 0 ? timer.remainingMs : timer.durationMs;

    state.focusTimer = {
      durationMs: timer.durationMs,
      remainingMs,
      isRunning: true,
      startedAt: now,
      updatedBy: actorName,
    };
    bump(state, now);
    return true;
  }

  if (action === 'focus-pause') {
    if (state.hostId !== actorId) return false;
    const timer = normalizeFocusTimer(state.focusTimer);
    const elapsedMs = timer.isRunning && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
    const remainingMs = Math.max(0, timer.remainingMs - elapsedMs);

    state.focusTimer = {
      durationMs: timer.durationMs,
      remainingMs,
      isRunning: false,
      startedAt: 0,
      updatedBy: actorName,
    };
    bump(state, now);
    return true;
  }

  if (action === 'focus-reset') {
    if (state.hostId !== actorId) return false;
    const timer = normalizeFocusTimer(state.focusTimer);

    state.focusTimer = {
      durationMs: timer.durationMs,
      remainingMs: timer.durationMs,
      isRunning: false,
      startedAt: 0,
      updatedBy: actorName,
    };
    bump(state, now);
    return true;
  }

  if (action === 'focus-complete') {
    if (state.hostId !== actorId) return false;
    const timer = normalizeFocusTimer(state.focusTimer);

    state.focusTimer = {
      durationMs: timer.durationMs,
      remainingMs: 0,
      isRunning: false,
      startedAt: 0,
      updatedBy: actorName,
    };
    bump(state, now);
    return true;
  }

  return false;
}

class MemoryJamStore {
  async getRoomState(roomId) {
    const key = roomKey(roomId);
    const state = ROOM_STORE.has(key) ? ROOM_STORE.get(key) : defaultState(key);

    return {
      driver: 'memory',
      consistencyToken: null,
      state: clone(normalizeState(state, key)),
    };
  }

  async applyAction(roomId, action, payload, actor) {
    const key = roomKey(roomId);
    const state = ROOM_STORE.has(key) ? ROOM_STORE.get(key) : defaultState(key);
    applyAction(state, action, payload, actor, Date.now());
    ROOM_STORE.set(key, state);

    return {
      driver: 'memory',
      consistencyToken: null,
      state: clone(normalizeState(state, key)),
    };
  }
}

class UpstashJamStore {
  constructor(redis, fallbackStore) {
    this.redis = redis;
    this.fallbackStore = fallbackStore;
  }

  async getRoomState(roomId) {
    try {
      const key = roomKey(roomId);
      const raw = await this.redis.get(redisRoomKey(key));
      const serialized = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : null);

      return {
        driver: 'redis',
        consistencyToken: null,
        state: parseStoredState(serialized, key),
      };
    } catch (error) {
      console.warn('[JamStore] Redis get failed, falling back to memory:', error?.message || error);
      const fallbackResult = await this.fallbackStore.getRoomState(roomId);
      return {
        ...fallbackResult,
        driver: 'memory-fallback',
      };
    }
  }

  async applyAction(roomId, action, payload, actor) {
    try {
      const key = roomKey(roomId);
      const result = await this.redis.eval(
        APPLY_ACTION_SCRIPT,
        [redisRoomKey(key)],
        [
          key,
          String(action || ''),
          JSON.stringify(payload || {}),
          JSON.stringify({
            id: actor?.id || null,
            name: actor?.name || null,
          }),
          String(ROOM_TTL_SECONDS),
        ]
      );
      const serialized = typeof result === 'string' ? result : (result ? JSON.stringify(result) : null);

      return {
        driver: 'redis',
        consistencyToken: null,
        state: parseStoredState(serialized, key),
      };
    } catch (error) {
      console.warn('[JamStore] Redis eval failed, falling back to memory:', error?.message || error);
      const fallbackResult = await this.fallbackStore.applyAction(roomId, action, payload, actor);
      return {
        ...fallbackResult,
        driver: 'memory-fallback',
      };
    }
  }
}

let cachedStore = null;

function createStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  const memoryFallback = new MemoryJamStore();

  if (url && token) {
    return new UpstashJamStore(Redis.fromEnv(), memoryFallback);
  }

  return memoryFallback;
}

function getJamStore() {
  if (!cachedStore) {
    cachedStore = createStore();
  }

  return cachedStore;
}

module.exports = {
  defaultState,
  getJamStore,
  normalizeState,
  roomKey,
};
