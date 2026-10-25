// ---------------------------------------------------------------------
// Background music playlist — data only (read by js/background-music.js)
// ---------------------------------------------------------------------
// Intentionally EMPTY: background music plays only the songs in
// Backend/songs/Indian, and only through the local development server
// (node scripts/dev-server.mjs → http://localhost:8788), which replaces
// this file with a playlist built from that folder.
//
// With this empty list, the player adds no music and no music control:
// the live site, file:// and other local servers stay silent. No other
// songs are ever played as a fallback.
window.PortfolioMusic = window.PortfolioMusic || {};
window.PortfolioMusic.playlist = [];
