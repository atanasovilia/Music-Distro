const API_PATH = '/api/jam/state';

export class JamSync {
  constructor() {
    this.roomId = 'global';
    this.userId = null;
    this.userName = 'Guest';
    this.state = null;
    this.consistencyToken = null;
    this._pollTimer = null;
    this._pollDelayMs = 1500;
    this._refreshPromise = null;
    this._destroyed = false;
    this.onState = () => {};
  }

  async init(roomId, userId, userName) {
    this.destroy();
    this.roomId = roomId || 'global';
    this.userId = userId;
    this.userName = userName || 'Guest';
    this.consistencyToken = null;
    this._destroyed = false;
    await this.refresh();
    this._startPolling();
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this._refreshPromise = null;
  }

  _startPolling() {
    clearTimeout(this._pollTimer);

    const poll = async () => {
      if (this._destroyed) return;

      try {
        await this.refresh();
      } catch {
        // Keep polling; transient fetch failures should not stop sync.
      } finally {
        if (!this._destroyed) {
          this._pollTimer = setTimeout(poll, this._pollDelayMs);
        }
      }
    };

    this._pollTimer = setTimeout(poll, this._pollDelayMs);
  }

  async refresh() {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    const requestRoomId = this.roomId;
    const params = new URLSearchParams({ roomId: requestRoomId });
    const request = fetch(`${API_PATH}?${params}`, {
      cache: 'no-store',
      headers: this.consistencyToken ? { 'x-jam-sync-token': this.consistencyToken } : {},
    })
      .then(async res => {
        if (!res.ok) throw new Error('Could not load jam room state');
        const data = await res.json();
        this._setConsistencyToken(res.headers.get('x-jam-sync-token'));
        if (this._destroyed || requestRoomId !== this.roomId) {
          return this.state;
        }
        this._setState(data.state);
        return this.state;
      })
      .finally(() => {
        if (this._refreshPromise === request) {
          this._refreshPromise = null;
        }
      });

    this._refreshPromise = request;
    return request;
  }

  _shouldApplyState(next) {
    if (!next) return false;
    if (!this.state) return true;

    const nextVersion = Number(next.version || 0);
    const currentVersion = Number(this.state.version || 0);

    if (nextVersion > currentVersion) return true;
    if (nextVersion < currentVersion) return false;

    const nextUpdatedAt = Number(next.updatedAt || 0);
    const currentUpdatedAt = Number(this.state.updatedAt || 0);

    return nextUpdatedAt >= currentUpdatedAt;
  }

  _setState(next) {
    if (!this._shouldApplyState(next)) {
      return;
    }

    const hadState = !!this.state;
    const prevVersion = Number(this.state?.version || 0);
    const prevUpdatedAt = Number(this.state?.updatedAt || 0);
    this.state = next;

    const nextVersion = Number(next?.version || 0);
    const nextUpdatedAt = Number(next?.updatedAt || 0);
    if (!hadState || nextVersion !== prevVersion || nextUpdatedAt !== prevUpdatedAt) {
      this.onState(next);
    }
  }

  async _action(action, payload = {}) {
    const requestRoomId = this.roomId;
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.consistencyToken ? { 'x-jam-sync-token': this.consistencyToken } : {}),
      },
      body: JSON.stringify({
        roomId: requestRoomId,
        action,
        payload,
        userId: this.userId,
        userName: this.userName,
      }),
    });

    if (!res.ok) {
      let message = 'Jam action failed';
      try {
        const body = await res.json();
        if (body?.error) {
          message = String(body.error);
        }
      } catch {
        // Keep generic message if response body is not JSON.
      }
      throw new Error(message);
    }

    const data = await res.json();
    this._setConsistencyToken(res.headers.get('x-jam-sync-token'));
    if (!this._destroyed && requestRoomId === this.roomId) {
      this._setState(data.state);
    }
    return this.state;
  }

  async becomeHost() {
    return this._action('set-host');
  }

  async releaseHost() {
    return this._action('clear-host');
  }

  async suggest(track) {
    return this._action('suggest', { track });
  }

  async vote(uri) {
    return this._action('vote', { uri });
  }

  async removeSuggestion(uri) {
    return this._action('remove-suggestion', { uri });
  }

  async publishPlayback(playback) {
    return this._action('playback', { playback });
  }

  async setFocusTimer(durationMs) {
    return this._action('focus-set', { durationMs });
  }

  async startFocusTimer() {
    return this._action('focus-start');
  }

  async pauseFocusTimer() {
    return this._action('focus-pause');
  }

  async resetFocusTimer() {
    return this._action('focus-reset');
  }

  async completeFocusTimer() {
    return this._action('focus-complete');
  }

  _setConsistencyToken(token) {
    if (token) {
      this.consistencyToken = token;
    }
  }
}
