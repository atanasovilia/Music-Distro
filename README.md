# LoFi Spaces

Minimal static build for Vercel hosting.

## Jam Mode

- Shared room state endpoint: api/jam/state.js
- Room URL: add ?room=your-room-id to the app URL
- Users can become host, suggest tracks, vote, and host can push playback sync
- Spotify login is still required per user for Spotify playback controls

The Jam API now supports persistent storage through Upstash Redis on Vercel. If `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present, room state is stored in Redis. If they are missing, the API falls back to local in-memory storage for lightweight development.

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
5. Add an Upstash Redis integration from the Vercel Marketplace.
6. Confirm the project has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set.
7. Deploy.

The app is static, and vercel.json rewrites /callback to /index.html so Spotify OAuth return works.

## Notes

- Update Spotify/Discord IDs in js files as needed.
- Spotify Premium is required for Web Playback SDK.
