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
      { id: 'beach_waves',    label: 'Ocean Waves', icon: '🌊', defaultOn: false, defaultVol: 0.1 },
      { id: 'beach_seagulls', label: 'Seagulls',    icon: '🐦', defaultOn: false, defaultVol: 0.1 },
      { id: 'beach_breeze',   label: 'Sea Breeze',  icon: '💨', defaultOn: false, defaultVol: 0.1 },
    ],
  },
  {
    id: 'rain',
    name: 'Lofi Rain',
    tagline: 'Raindrops on the window',
    emoji: '🌧️',
    ambients: [
      { id: 'rain',    label: 'Rain',        icon: '🌧️', defaultOn: false, defaultVol: 0.1 },
      { id: 'thunder', label: 'Thunder',     icon: '⛈️', defaultOn: false, defaultVol: 0.1 },
    ],
  },
  {
    id: 'traffic',
    name: 'City Traffic',
    tagline: 'Neon lights, endless night',
    emoji: '🚗',
    ambients: [
      { id: 'traffic', label: 'Traffic',     icon: '🚗', defaultOn: false, defaultVol: 0.1 },
      { id: 'traffic_rain',    label: 'City Rain',   icon: '🌧️', defaultOn: false, defaultVol: 0.1 },
      { id: 'traffic_thunder', label: 'Storm',       icon: '⚡', defaultOn: false, defaultVol: 0.1 },
      { id: 'city',    label: 'City Noise',  icon: '🏙️', defaultOn: false, defaultVol: 0.1 },
    ],
  },
  {
    id: 'cafe',
    name: 'Cozy Cafe',
    tagline: 'Warmth in every cup',
    emoji: '☕',
    ambients: [
      { id: 'cafe',   label: 'Chatter',     icon: '💬', defaultOn: false, defaultVol: 0.1 },
      { id: 'coffee', label: 'Machine',     icon: '☕', defaultOn: false, defaultVol: 0.1 },
      { id: 'rain',   label: 'Outside',     icon: '🌧️', defaultOn: false, defaultVol: 0.1 },
    ],
  },
  {
    id: 'forest',
    name: 'Deep Forest',
    tagline: 'Ancient trees, quiet paths',
    emoji: '🌲',
    ambients: [
      { id: 'wind',   label: 'Wind',        icon: '🍃', defaultOn: false, defaultVol: 0.1 },
      { id: 'birds',  label: 'Birds',       icon: '🐦', defaultOn: false, defaultVol: 0.1 },
      { id: 'creek',  label: 'Creek',       icon: '💧', defaultOn: false, defaultVol: 0.1 },
    ],
  },
  {
    id: 'nightsky',
    name: 'Night Sky',
    tagline: 'Stars, fire & stillness',
    emoji: '🌙',
    ambients: [
      { id: 'crickets', label: 'Crickets',  icon: '🦗', defaultOn: false, defaultVol: 0.1 },
      { id: 'wind',     label: 'Night Wind',icon: '💨', defaultOn: false, defaultVol: 0.1 },
      { id: 'fire',     label: 'Campfire',  icon: '🔥', defaultOn: false, defaultVol: 0.1 },
    ],
  },
];

export function getScene(id) {
  return SCENES.find(s => s.id === id) ?? SCENES[0];
}
