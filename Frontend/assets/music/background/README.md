# Background music tracks

Put audio files for the site-wide background music here (MP3 recommended;
.m4a/.aac/.ogg/.opus/.wav also work; max 25 MiB per file on Cloudflare Pages),
then run from the repository root:

    node scripts/build-music-playlist.mjs

That rewrites `Frontend/js/background-playlist.js`. Optional `credits.json` in this
folder adds titles/artists/licence credits per file.

Only add music you have the right to publish publicly (your own productions or
tracks whose licence allows it). Do not add songs downloaded from YouTube /
YouTube Music or other commercial recordings.
