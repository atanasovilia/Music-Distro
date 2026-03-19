// ── ambient.js ──────────────────────────────────────────────────
// Procedural ambient sound engine using Web Audio API
// No audio files needed — everything is synthesised in real time
// ──────────────────────────────────────────────────────────────

export class AmbientEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;        // Soft limiter to prevent clipping
    this.channels = {};    // id → { gainNode, volume, isOn, nodes, timers }
    this._ready = false;
  }

  /** Must be called after a user gesture (click) */
  init() {
    if (this._ready) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create a soft limiter chain to prevent clipping and distortion
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7; // Slightly reduced to prevent clipping
    
    // Create compressor limiter for audio protection
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;    // Kick in before clipping
    this.limiter.knee.value = 10;          // Smooth transition
    this.limiter.ratio.value = 8;          // Soft limiting
    this.limiter.attack.value = 0.005;     // Fast attack
    this.limiter.release.value = 0.1;      // Quick release
    
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this._ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Noise buffer factories ────────────────────────────────────

  _makeWhiteBuffer(seconds = 2) {
    const n = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makePinkBuffer(seconds = 2) {
    const n = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  _loopNoise(buf) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }

  _filter(type, freq, Q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }

  _lfo(freq, amount, target) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = amount;
    osc.connect(gain);
    gain.connect(target);
    osc.start();
    return [osc, gain];
  }

  _loopAudioFile(filename, gainNode, channel) {
    try {
      const audio = new Audio(new URL(`../${filename}`, import.meta.url).href);
      audio.loop = true;
      audio.preload = 'auto';

      const src = this.ctx.createMediaElementSource(audio);
      src.connect(gainNode);

      channel.mediaElement = audio;
      return [src];
    } catch {
      return null;
    }
  }

  _loopAudioFiles(filenames, gainNode, channel) {
    for (const filename of filenames) {
      const nodes = this._loopAudioFile(filename, gainNode, channel);
      if (nodes) return nodes;
    }
    return null;
  }

  // ── Channel setup ─────────────────────────────────────────────

  _build(id, gainNode, channel) {
    const nodes = [];
    const ctx = this.ctx;

    const addNodes = (...n) => nodes.push(...n);

    switch (id) {

      case 'beach_waves': {
        const fileNodes = this._loopAudioFile('assets/sounds/beach/soundreality-maldives-beach-381097.mp3', gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 600, 0.5);
        const [lfoOsc, lfoGain] = this._lfo(0.08, 300, lp.frequency);
        src.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, lfoOsc, lfoGain);
        break;
      }

      case 'beach_seagulls': {
        const fileNodes = this._loopAudioFile('assets/sounds/beach/dammafra-seagulls-435999.mp3', gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        this._scheduleChirps(gainNode, channel, 700, 1100, 2500, 7000);
        break;
      }

      case 'beach_breeze': {
        const fileNodes = this._loopAudioFile('assets/sounds/beach/soul_serenity_sounds-distant-breeze-241047.mp3', gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 450, 0.6);
        const [lfoOsc, lfoGain] = this._lfo(0.06, 150, lp.frequency);
        src.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, lfoOsc, lfoGain);
        break;
      }

      case 'waves': {
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 600, 0.5);  // Smoother Q
        const [lfoOsc, lfoGain] = this._lfo(0.08, 300, lp.frequency);  // Reduced LFO depth
        src.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, lfoOsc, lfoGain);
        break;
      }

      case 'rain': {
        const fileNodes = this._loopAudioFile('assets/sounds/rain/dragon-studio-relaxing-rain-444802.mp3', gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makeWhiteBuffer(2));
        const bp = this._filter('bandpass', 3200, 0.4);  // Lower Q for cleaner filtering
        const lp = this._filter('lowpass', 6000, 0.7);
        src.connect(bp); bp.connect(lp); lp.connect(gainNode);
        addNodes(src, bp, lp);
        break;
      }

      case 'traffic_rain': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/traffic/heavy-rain.mp3',
          'assets/sounds/rain/dragon-studio-relaxing-rain-444802.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makeWhiteBuffer(2));
        const bp = this._filter('bandpass', 3200, 0.4);
        const lp = this._filter('lowpass', 6000, 0.7);
        src.connect(bp); bp.connect(lp); lp.connect(gainNode);
        addNodes(src, bp, lp);
        break;
      }

      case 'swamp_rain': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/forest/soul_serenity_sounds-water-noises-241049.mp3',
          'assets/sounds/rain/dragon-studio-relaxing-rain-444802.mp3',
          'assets/sounds/traffic/heavy-rain.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makeWhiteBuffer(2));
        const bp = this._filter('bandpass', 2600, 0.4);
        const lp = this._filter('lowpass', 5600, 0.7);
        src.connect(bp); bp.connect(lp); lp.connect(gainNode);
        addNodes(src, bp, lp);
        break;
      }

      case 'wind': {
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 450, 0.6);  // More subtle filtering
        const [lfoOsc, lfoGain] = this._lfo(0.06, 150, lp.frequency);  // Reduced LFO
        src.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, lfoOsc, lfoGain);
        break;
      }

      case 'indoor': {
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 800, 0.6);
        const hp = this._filter('highpass', 60, 0.7);
        src.connect(hp); hp.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, hp);
        break;
      }

      case 'traffic': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/traffic/traffic.mp3',
          'assets/sounds/traffic/traffics.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        // Low rumble with slow LFO simulating passing cars
        const src = this._loopNoise(this._makePinkBuffer(4));
        const lp = this._filter('lowpass', 350, 0.5);  // Smoother Q
        const [lfoOsc, lfoGain] = this._lfo(0.22, 120, lp.frequency);  // Reduced LFO
        const hiSrc = this._loopNoise(this._makeWhiteBuffer(2));
        const hiLp = this._filter('bandpass', 1800, 0.3);
        const hiGain = ctx.createGain(); hiGain.gain.value = 0.1;  // Reduced volume
        src.connect(lp); lp.connect(gainNode);
        hiSrc.connect(hiLp); hiLp.connect(hiGain); hiGain.connect(gainNode);
        addNodes(src, lp, lfoOsc, lfoGain, hiSrc, hiLp, hiGain);
        break;
      }

      case 'traffic_birds':
      case 'city': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/traffic/city-birds.mp3',
          'assets/sounds/beach/dammafra-seagulls-435999.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 1200, 0.6);
        const hp = this._filter('highpass', 150, 0.7);
        src.connect(hp); hp.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, hp);
        break;
      }

      case 'cafe': {
        const src = this._loopNoise(this._makePinkBuffer(3));
        const lp = this._filter('lowpass', 1800, 0.6);  // Smoother
        const hp = this._filter('highpass', 250, 0.7);
        const [lfoOsc, lfoGain] = this._lfo(0.18, 200, lp.frequency);  // Reduced LFO
        src.connect(hp); hp.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, hp, lfoOsc, lfoGain);
        break;
      }

      case 'creek': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/forest/soul_serenity_sounds-water-noises-241049.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        const src = this._loopNoise(this._makeWhiteBuffer(2));
        const bp = this._filter('bandpass', 1800, 0.6);
        const lp = this._filter('lowpass', 4000, 0.7);
        src.connect(bp); bp.connect(lp); lp.connect(gainNode);
        addNodes(src, bp, lp);
        break;
      }

      case 'fire': {
        const src = this._loopNoise(this._makePinkBuffer(2));
        const lp = this._filter('lowpass', 700, 0.4);  // Smoother
        const hp = this._filter('highpass', 80, 0.7);
        const [lfoOsc, lfoGain] = this._lfo(2.5, 150, lp.frequency);  // Reduced LFO
        src.connect(hp); hp.connect(lp); lp.connect(gainNode);
        addNodes(src, lp, hp, lfoOsc, lfoGain);
        break;
      }

      case 'crickets': {
        const makeChirper = (freq, detune) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine'; osc.frequency.value = freq;
          const tremoloOsc = ctx.createOscillator();
          const tremoloGain = ctx.createGain();
          tremoloOsc.frequency.value = 17;
          tremoloGain.gain.value = 0.35;  // Reduced tremolo depth
          const mixer = ctx.createGain(); mixer.gain.value = 0.4; // Reduced volume
          tremoloOsc.connect(tremoloGain);
          tremoloGain.connect(mixer.gain);
          osc.connect(mixer); mixer.connect(gainNode);
          osc.start(); tremoloOsc.start();
          return [osc, tremoloOsc, tremoloGain, mixer];
        };
        const c1 = makeChirper(3950, 0);
        const c2 = makeChirper(4100, 5);
        const c3 = makeChirper(3820, -3);
        addNodes(...c1, ...c2, ...c3);
        break;
      }

      case 'seagulls':
      case 'birds': {
        const freqMin = id === 'seagulls' ? 700 : 2200;
        const freqMax = id === 'seagulls' ? 1100 : 4200;
        const intervalMin = id === 'seagulls' ? 2500 : 1800;
        const intervalMax = id === 'seagulls' ? 7000 : 5500;
        this._scheduleChirps(gainNode, channel, freqMin, freqMax, intervalMin, intervalMax);
        break;
      }

      case 'swamp_frogs': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/forest/soundreality-frogs-151962.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        this._scheduleFrogCroaks(gainNode, channel);
        break;
      }

      case 'thunder': {
        const fileNodes = this._loopAudioFile('assets/sounds/rain/dragon-studio-dry-thunder-364468.mp3', gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        this._scheduleThunder(gainNode, channel);
        break;
      }

      case 'traffic_thunder': {
        const fileNodes = this._loopAudioFiles([
          'assets/sounds/traffic/heavy-thunder.mp3',
          'assets/sounds/rain/dragon-studio-dry-thunder-364468.mp3',
        ], gainNode, channel);
        if (fileNodes) {
          addNodes(...fileNodes);
          break;
        }
        this._scheduleThunder(gainNode, channel);
        break;
      }

      case 'coffee': {
        this._scheduleCoffeeMachine(gainNode, channel);
        break;
      }
    }

    channel.nodes = nodes;
  }

  // ── Periodic sound schedulers ─────────────────────────────────

  _scheduleChirps(gainNode, channel, freqMin, freqMax, iMin, iMax) {
    const schedule = () => {
      if (!channel.isOn) { channel._t1 = setTimeout(schedule, 1500); return; }
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env); env.connect(gainNode);
      osc.type = 'sine';
      osc.frequency.value = freqMin + Math.random() * (freqMax - freqMin);
      const now = ctx.currentTime;
      const dur = 0.1 + Math.random() * 0.25;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.3, now + 0.04);  // Reduced peak volume
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.start(now); osc.stop(now + dur + 0.05);
      const interval = iMin + Math.random() * (iMax - iMin);
      channel._t1 = setTimeout(schedule, interval);
    };
    schedule();
  }

  _scheduleFrogCroaks(gainNode, channel) {
    const schedule = () => {
      if (!channel.isOn) {
        channel._frogTimer = setTimeout(schedule, 1200);
        return;
      }

      const ctx = this.ctx;
      const start = ctx.currentTime + 0.02;
      const base = 95 + Math.random() * 45;
      const pulses = Math.random() < 0.5 ? 2 : 3;

      for (let i = 0; i < pulses; i++) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();
        const pulseAt = start + i * 0.11;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(base + Math.random() * 20, pulseAt);
        osc.frequency.exponentialRampToValueAtTime(base * (0.65 + Math.random() * 0.1), pulseAt + 0.09);

        filter.type = 'bandpass';
        filter.frequency.value = 240;
        filter.Q.value = 0.8;

        env.gain.setValueAtTime(0.0001, pulseAt);
        env.gain.linearRampToValueAtTime(0.12, pulseAt + 0.03);
        env.gain.exponentialRampToValueAtTime(0.0001, pulseAt + 0.17);

        osc.connect(filter);
        filter.connect(env);
        env.connect(gainNode);

        osc.start(pulseAt);
        osc.stop(pulseAt + 0.22);
      }

      const wait = 900 + Math.random() * 2500;
      channel._frogTimer = setTimeout(schedule, wait);
    };

    schedule();
  }

  _scheduleThunder(gainNode, channel) {
    const schedule = () => {
      if (!channel.isOn) { channel._t2 = setTimeout(schedule, 5000); return; }
      const ctx = this.ctx;
      const src = this._loopNoise(this._makePinkBuffer(3));
      const lp = this._filter('lowpass', 180, 0.7);
      const env = ctx.createGain();
      src.connect(lp); lp.connect(env); env.connect(gainNode);
      const now = ctx.currentTime;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.6, now + 0.08);  // Reduced thunder intensity
      env.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
      src.stop(now + 3.5);
      const interval = 9000 + Math.random() * 22000;
      channel._t2 = setTimeout(schedule, interval + 1000);
    };
    schedule();
  }

  _scheduleCoffeeMachine(gainNode, channel) {
    const schedule = () => {
      if (!channel.isOn) { channel._t3 = setTimeout(schedule, 3000); return; }
      const ctx = this.ctx;
      const src = this._loopNoise(this._makeWhiteBuffer(2));
      const hp = this._filter('highpass', 2500, 0.6);
      const env = ctx.createGain();
      src.connect(hp); hp.connect(env); env.connect(gainNode);
      const now = ctx.currentTime;
      const dur = 1.2 + Math.random() * 1.5;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.25, now + 0.15);  // Reduced volume
      env.gain.setValueAtTime(0.25, now + dur);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.4);
      src.stop(now + dur + 0.6);
      channel._t3 = setTimeout(schedule, 6000 + Math.random() * 18000);
    };
    schedule();
  }

  // ── Public API ────────────────────────────────────────────────

  /** Set up a channel. Call once per ambient id. */
  setup(id, defaultOn = false, defaultVol = 0.5) {
    if (!this._ready) return;
    if (this.channels[id]) return; // already set up

    const gainNode = this.ctx.createGain();
    gainNode.connect(this.masterGain);
    gainNode.gain.value = 0;

    const channel = {
      gainNode,
      volume: defaultVol,
      isOn: false,
      nodes: [],
      _t1: null, _t2: null, _t3: null, _frogTimer: null,
    };

    this._build(id, gainNode, channel);
    this.channels[id] = channel;

    if (defaultOn) this.toggle(id, true);
  }

  setVolume(id, volume) {
    const ch = this.channels[id];
    if (!ch) return;
    ch.volume = volume;
    if (ch.isOn) {
      // Use smoother gain ramping to avoid clicks/pops
      ch.gainNode.gain.setTargetAtTime(volume * 0.75, this.ctx.currentTime, 0.15);
    }
  }

  toggle(id, on) {
    const ch = this.channels[id];
    if (!ch) return;
    ch.isOn = on;
    if (on && ch.mediaElement && ch.mediaElement.paused) {
      ch.mediaElement.play().catch(() => {});
    }
    if (!on && ch.mediaElement && !ch.mediaElement.paused) {
      ch.mediaElement.pause();
    }
    // Smooth crossfade to prevent clicks
    ch.gainNode.gain.setTargetAtTime(
      on ? ch.volume * 0.75 : 0,
      this.ctx.currentTime,
      0.3
    );
  }

  toggleAll(on) {
    Object.keys(this.channels).forEach(id => this.toggle(id, on));
  }

  setMasterVolume(v) {
    if (!this.masterGain) return;
    // Clamp to prevent excessive signal levels
    const clampedVol = Math.max(0, Math.min(1, v));
    this.masterGain.gain.setTargetAtTime(clampedVol * 0.7, this.ctx.currentTime, 0.1);
  }

  /** Stop/disconnect everything for a scene change */
  teardown(ids = []) {
    ids.forEach(id => {
      const ch = this.channels[id];
      if (!ch) return;
      clearTimeout(ch._t1); clearTimeout(ch._t2); clearTimeout(ch._t3);
      clearTimeout(ch._frogTimer);
      ch.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => {
        if (ch.mediaElement) {
          try {
            ch.mediaElement.pause();
            ch.mediaElement.currentTime = 0;
          } catch {}
        }
        ch.nodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch {} });
        ch.gainNode.disconnect();
        delete this.channels[id];
      }, 400);
    });
  }
}
