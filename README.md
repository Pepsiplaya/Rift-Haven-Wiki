# Rift Haven website and staff audit bot

The game homepage, community dashboard, profiles, market, guild directory, rankings, guide, and news run on the existing GitHub Pages site. Public records and Discord interactions run on `rift-haven-api.rift-haven-website.workers.dev`.

## Data flow

The game commits economy changes and audit records together in its MySQL transaction. A background publisher forwards pending records over signed HTTPS and publishes public-data snapshots once a minute. Cloudflare D1 stores the snapshots and audit records; no SQL password is stored in Cloudflare. A singleton dispatcher batches Discord messages and respects rate-limit responses. Delivery has stable event references and may duplicate a batch after a lost acknowledgement.

Public profiles exclude hidden accounts and hidden characters, UUIDs, private bank contents, social relationships, and staff records. Only public fields survive the Cloudflare ingestion projection. Auction prices represent the complete listing. Empty markets and guild directories reflect actual data. Dungeon player clears are not unique run counts. Unrecorded fastest times remain absent.

The first snapshot was seeded from the game database. Continuous synchronization requires the new game plugin and `portal-sync.properties` on the dedicated server. Database credentials stay in the existing game configuration. Keep the sync properties private; it contains the shared signing secret.

## Bot

The configured server, five channels, and five staff roles are in `server/audit-policy.json`. `/audit reference` returns private results. `/audit-case reference reason` preserves the transaction evidence for 180 days. Normal detailed records are retained for 30 days after successful delivery. Pending records are preserved. Existing game/bot recordings are not touched. Discord channel history has its own retention; these database retention settings do not delete Discord messages.

Cloudflare Secrets: `DISCORD_BOT_TOKEN` and `RIFT_SYNC_SECRET`. The Discord Public Key is public configuration. No gateway connection or message-content intent is required.

## Development

`npm install`, `npm start` opens the local preview on port 8092. `npm test` checks role authorization, signatures, safe public projections, precise prices, bounded batches, and rate-limit handling. `npm run check` checks JavaScript syntax. `npx wrangler deploy --dry-run` verifies the Cloudflare bundle; `npx wrangler deploy` publishes it.

The optional Node/MySQL adapter requires trusted TLS and remains available for environments with a provider certificate. Production uses signed snapshots instead.

## Guide and news

The initial guide contains the authored in-game handbook. Runtime-generated recipe, item, and profession pages require the live catalog export. News contains ten deduplicated user-supplied updates, with no invented dates. Historical posts do not define current gameplay mechanics.
