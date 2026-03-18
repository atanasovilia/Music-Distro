// ── scenes.js ──────────────────────────────────────────────────
// All scene data: metadata, ambient channels, colors, taglines
// ──────────────────────────────────────────────────────────────

export const SCENES = [
  {
    id: 'beach',
    name: 'Beach Vibes',
    tagline: 'Sun, salt & good vibes',
    emoji: '🌊',
    ambients: [
      { id: 'waves',    label: 'Ocean Waves', icon: '🌊', defaultOn: true,  defaultVol: 0.65 },
      { id: 'seagulls', label: 'Seagulls',    icon: '🐦', defaultOn: false, defaultVol: 0.35 },
      { id: 'wind',     label: 'Sea Breeze',  icon: '💨', defaultOn: true,  defaultVol: 0.3  },
    ],
  },
  {
    id: 'rain',
    name: 'Lofi Rain',
    tagline: 'Raindrops on the window',
    emoji: '🌧️',
    ambients: [
      { id: 'rain',    label: 'Rain',        icon: '🌧️', defaultOn: true,  defaultVol: 0.7  },
      { id: 'thunder', label: 'Thunder',     icon: '⛈️', defaultOn: false, defaultVol: 0.5  },
      { id: 'indoor',  label: 'Indoors',     icon: '🏠', defaultOn: true,  defaultVol: 0.2  },
    ],
  },
  {
    id: 'traffic',
    name: 'City Traffic',
    tagline: 'Neon lights, endless night',
    emoji: '🚗',
    ambients: [
      { id: 'traffic', label: 'Traffic',     icon: '🚗', defaultOn: true,  defaultVol: 0.55 },
      { id: 'rain',    label: 'City Rain',   icon: '🌧️', defaultOn: true,  defaultVol: 0.4  },
      { id: 'city',    label: 'City Noise',  icon: '🏙️', defaultOn: false, defaultVol: 0.35 },
    ],
  },
  {
    id: 'cafe',
    name: 'Cozy Cafe',
    tagline: 'Warmth in every cup',
    emoji: '☕',
    ambients: [
      { id: 'cafe',   label: 'Chatter',     icon: '💬', defaultOn: true,  defaultVol: 0.45 },
      { id: 'coffee', label: 'Machine',     icon: '☕', defaultOn: false, defaultVol: 0.4  },
      { id: 'rain',   label: 'Outside',     icon: '🌧️', defaultOn: true,  defaultVol: 0.3  },
    ],
  },
  {
    id: 'forest',
    name: 'Deep Forest',
    tagline: 'Ancient trees, quiet paths',
    emoji: '🌲',
    ambients: [
      { id: 'wind',   label: 'Wind',        icon: '🍃', defaultOn: true,  defaultVol: 0.4  },
      { id: 'birds',  label: 'Birds',       icon: '🐦', defaultOn: true,  defaultVol: 0.5  },
      { id: 'creek',  label: 'Creek',       icon: '💧', defaultOn: false, defaultVol: 0.45 },
    ],
  },
  {
    id: 'nightsky',
    name: 'Night Sky',
    tagline: 'Stars, fire & stillness',
    emoji: '🌙',
    ambients: [
      { id: 'crickets', label: 'Crickets',  icon: '🦗', defaultOn: true,  defaultVol: 0.5  },
      { id: 'wind',     label: 'Night Wind',icon: '💨', defaultOn: true,  defaultVol: 0.25 },
      { id: 'fire',     label: 'Campfire',  icon: '🔥', defaultOn: false, defaultVol: 0.55 },
    ],
  },
];

export function getScene(id) {
  return SCENES.find(s => s.id === id) ?? SCENES[0];
}
