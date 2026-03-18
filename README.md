# LoFi Spaces

Minimal static build for Vercel hosting.

## Jam Mode

- Shared room state endpoint: api/jam/state.js
- Room URL: add ?room=your-room-id to the app URL
- Users can become host, suggest tracks, vote, and host can push playback sync
- Spotify login is still required per user for Spotify playback controls

Note: the current Jam state backend is in-memory for quick rollout. It works for lightweight testing, but it is not durable storage. For production-grade rooms, switch the API to persistent storage (Redis, Postgres, or Supabase).

## Project Structure

- index.html
- css/style.css
- css/scenes.css
- js/main.js
- js/scenes.js
- js/ambient.js
- js/spotify.js
- js/discord.js
- vercel.json

## Deploy to Vercel

1. Import this repository into Vercel.
2. Framework preset: Other.
3. Build command: leave empty.
4. Output directory: leave empty.
5. Deploy.

The app is static, and vercel.json rewrites /callback to /index.html so Spotify OAuth return works.

## Notes

- Update Spotify/Discord IDs in js files as needed.
- Spotify Premium is required for Web Playback SDK.