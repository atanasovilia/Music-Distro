const API_PATH = '/api/jam/state';

export class JamSync {
  constructor() {
    this.roomId = 'global';
    this.userId = null;
    this.userName = 'Guest';
    this.state = null;
    this._pollTimer = null;
    this.onState = () => {};
  }

  async init(roomId, userId, userName) {
    this.roomId = roomId || 'global';
    this.userId = userId;
    this.userName = userName || 'Guest';
    await this.refresh();
    this._startPolling();
  }

  destroy() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  _startPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      this.refresh().catch(() => {});
    }, 2500);
  }

  async refresh() {
    const params = new URLSearchParams({ roomId: this.roomId });
    const res = await fetch(`${API_PATH}?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load jam room state');
    const data = await res.json();
    this._setState(data.state);
    return this.state;
  }

  _setState(next) {
    const prevVersion = this.state?.version || 0;
    this.state = next;
    if ((next?.version || 0) !== prevVersion) {
      this.onState(next);
    }
  }

  async _action(action, payload = {}) {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: this.roomId,
        action,
        payload,
        userId: this.userId,
        userName: this.userName,
      }),
    });

    if (!res.ok) throw new Error('Jam action failed');
    const data = await res.json();
    this._setState(data.state);
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
}
