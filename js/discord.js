// ── discord.js ──────────────────────────────────────────────────
// Discord Embedded App SDK - participants, presence, shared state
// Docs: https://discord.com/developers/docs/activities/overview
// ──────────────────────────────────────────────────────────────

export class DiscordManager {
  constructor() {
    this.sdk = null;
    this.sdkDetected = false;
    this.isInActivity = false;
    this.participants = [];
    this.currentUser = null;
    this.channelId = null;
    this.guildId = null;
    this.clientId = null;

    // Callbacks
    this.onParticipantsChange = () => {};
    this.onUserJoin = () => {};
    this.onUserLeave = () => {};
  }

  async init() {
    // Check if Discord SDK is available (only present inside Discord Activity)
    if (typeof window.DiscordSDK === 'undefined' && typeof window.Discord === 'undefined') {
      this.sdkDetected = false;
      console.log('[Discord] SDK not found — running in standalone mode');
      this._standaloneFallback();
      return false;
    }

    this.sdkDetected = true;

    try {
      // The SDK is injected as a global by the Discord client
      const SDK = window.DiscordSDK || window.Discord?.DiscordSDK;
      if (!SDK) throw new Error('SDK class not found');

      if (!this.clientId) {
        const cfgRes = await fetch('/api/config');
        const cfg = await cfgRes.json();
        this.clientId = cfg.discordClientId;
      }

      if (!this.clientId) throw new Error('Missing Discord client ID');

      this.sdk = new SDK(this.clientId);
      await this.sdk.ready();

      // Authorize & authenticate
      const { code } = await this.sdk.commands.authorize({
        client_id: this.clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds', 'rpc.voice.read'],
      });

      // Exchange code for token (goes through your server)
      const res = await fetch('/api/discord/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const { access_token } = await res.json();

      await this.sdk.commands.authenticate({ access_token });

      // Fetch context
      const channelRes = await this.sdk.commands.getChannel({
        channel_id: this.sdk.channelId,
      });

      this.channelId = this.sdk.channelId;
      this.guildId   = this.sdk.guildId;
      this.isInActivity = true;

      // Get initial participants
      await this._refreshParticipants();

      // Subscribe to voice state changes
      this.sdk.subscribe('VOICE_STATE_UPDATE', (data) => {
        this._refreshParticipants();
      });

      // Get current user
      const user = await this.sdk.commands.getUser();
      this.currentUser = user;

      console.log('[Discord] Activity running in channel:', this.channelId);
      return true;

    } catch (err) {
      console.warn('[Discord] Activity init failed:', err.message);
      this._standaloneFallback();
      return false;
    }
  }

  async _refreshParticipants() {
    if (!this.sdk) return;
    try {
      const { members } = await this.sdk.commands.getChannel({
        channel_id: this.channelId,
      });
      const prev = new Set(this.participants.map(p => p.id));
      const curr = new Set(members?.map(m => m.user?.id));

      // Detect joins
      members?.forEach(m => {
        if (!prev.has(m.user?.id)) this.onUserJoin(m.user);
      });

      // Detect leaves
      this.participants.forEach(p => {
        if (!curr.has(p.id)) this.onUserLeave(p);
      });

      this.participants = members?.map(m => ({
        id:     m.user?.id,
        name:   m.user?.global_name || m.user?.username,
        avatar: m.user?.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64`
          : null,
        initials: (m.user?.username || '?').slice(0, 2).toUpperCase(),
      })) || [];

      this.onParticipantsChange(this.participants);
    } catch (err) {
      console.warn('[Discord] Failed to fetch participants:', err.message);
    }
  }

  /** Fallback for running outside Discord (browser testing) */
  _standaloneFallback() {
    this.participants = [
      { id: 'local', name: 'You (Local)', initials: 'YO', avatar: null },
    ];
    this.isInActivity = false;
    setTimeout(() => this.onParticipantsChange(this.participants), 200);
  }

  /** Render avatar elements into a container */
  renderAvatars(container) {
    container.innerHTML = '';
    const max = 6;
    const shown = this.participants.slice(0, max);
    shown.forEach(p => {
      const el = document.createElement('div');
      el.className = 'avatar';
      el.title = p.name;
      if (p.avatar) {
        const img = document.createElement('img');
        img.src = p.avatar;
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
        el.appendChild(img);
      } else {
        el.textContent = p.initials;
      }
      container.appendChild(el);
    });

    if (this.participants.length > max) {
      const more = document.createElement('div');
      more.className = 'avatar';
      more.textContent = `+${this.participants.length - max}`;
      more.style.fontSize = '9px';
      container.appendChild(more);
    }
  }

  getParticipantCount() {
    return this.participants.length;
  }

  isEmbeddedClient() {
    return this.sdkDetected;
  }
}
