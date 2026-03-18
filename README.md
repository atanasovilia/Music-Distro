# LoFi Spaces

Minimal static build for Vercel hosting.

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