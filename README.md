# Rift Haven website and staff audit bot

The game homepage, community dashboard, profiles, market, guild directory, rankings, guide, and news run on the existing GitHub Pages site. Public records and Discord interactions run on `rift-haven-api.rift-haven-website.workers.dev`.

## Data flow

The game commits economy changes and audit records together in its MySQL transaction. A background publisher forwards pending records over signed HTTPS and publishes public-data snapshots once a minute. Cloudflare D1 stores the snapshots and audit records; no SQL password is stored in Cloudflare. A singleton dispatcher batches Discord messages and respects rate-limit responses. Delivery has stable event references and may duplicate a batch after a lost acknowledgement.

Public character profiles include staff. Leaderboard eligibility controls rankings only; UUIDs, private bank contents, social relationships, and staff audit records are excluded. Only public fields survive the Cloudflare ingestion projection. Auction prices represent the complete listing. Empty markets and guild directories reflect actual data. Dungeon player clears are not unique run counts. Unrecorded fastest times remain absent.

The first snapshot was seeded from the game database. Continuous synchronization requires the new game plugin and `portal-sync.properties` on the dedicated server. Database credentials stay in the existing game configuration. Keep the sync properties private; it contains the shared signing secret.

## Bot

The configured server, five channels, and five staff roles are in `server/audit-policy.json`. `/audit reference` returns private results. `/audit-case reference reason` preserves the transaction evidence for 180 days. Normal detailed records are retained for 30 days after successful delivery. Pending records are preserved. Existing game/bot recordings are not touched. Discord channel history has its own retention; these database retention settings do not delete Discord messages.

Cloudflare Secrets: `DISCORD_BOT_TOKEN` and `RIFT_SYNC_SECRET`. The Discord Public Key is public configuration. No gateway connection or message-content intent is required.

## Development

`npm install`, `npm start` opens the local preview on port 8092. `npm test` checks role authorization, signatures, safe public projections, precise prices, bounded batches, and rate-limit handling. `npm run check` checks JavaScript syntax. `npx wrangler deploy --dry-run` verifies the Cloudflare bundle; `npx wrangler deploy` publishes it.

The optional Node/MySQL adapter requires trusted TLS and remains available for environments with a provider certificate. Production uses signed snapshots instead.

## Guide and news

The initial guide contains the authored in-game handbook. Runtime-generated recipe, item, and profession pages require the live catalog export. News contains ten deduplicated user-supplied updates, with no invented dates. Historical posts do not define current gameplay mechanics.

## Native graphics and guide synchronization

Item icons resolve from the installed native assets and the accepted RiftCore artifact. `python scripts/build-item-catalog.py` regenerates the catalogue. Auction inspection projects saved attributes and requirements without publishing raw metadata.

Profiles use native GLB models generated from allowlisted saved cosmetic appearance. The current cache covers 71 characters with 66 unique appearances. The viewer uses Three.js (MIT; notice in assets/js/THREE-LICENSE.txt), native idle animation, visibility pauses, reduced-motion support and drag rotation. Equipment-aware cache variants now layer native equipped armor and supported main-hand models onto the saved cosmetic rig. Offhand and unavailable model parts are omitted rather than guessed, with coverage recorded in equipped-avatar-map.json. Uncached or unavailable appearances keep a neutral fallback. New skin combinations require a cache render; no always-on avatar renderer is claimed.

The staged game publisher exports the effective in-game GuideRuntime catalogue every 30 minutes over signed HTTPS. The site merges extra `/api/guide` articles with the current published handbook and verified item pages. Published articles take precedence so a delayed dedicated-server export cannot restore older instructions. The export has a one-MiB bound and does not prevent committed audit forwarding if it fails. Generated guide pages retain only public player instructions and links, with native icons and paginated search results.

The bot sends compact category-colored embeds, with structured economy/item fields and investigation references. Search results are private embeds. `/audit` accepts an event/transaction reference or an exact player name; `/audit-case` takes an event/transaction reference and a reason. A completed system test confirmed Discord delivery and the revised card format.

## Player browsing tools

The player directory has server-side paging, class filters and name/level/gold/recent sorting. Highscores have paging and player search that retains the actual ordinal, with a separate unchanged podium. Saved players are stored only in that browser (up to 20 names). Global search covers the guide, public players, obtainable items and news, with / or Ctrl/Cmd+K shortcuts.

Profile XP is XP within the current level. Progression XP totals are reconstructed using XP requirement tables exported from the accepted server artifact; these are progression totals, not an all-time post-cap or reset history. Unknown profession curve versions do not produce invented totals. Regenerate assets/data/progression.json when the game progression curves change.

The additional website Druid guide is based on current Druid form, spellbook and healing source. It augments the live catalogue without replacing an existing authoritative Druid article. Website-only changes in this pass do not alter gameplay or require another game JAR.


## Compendium, equipment and live world tools

`/items` contains 323 items anchored to accepted merchant, gathering, creature, fishing-bag and crafting sources, with 169 craftable output IDs and ingredient alternatives. Run `python scripts/build-discovery-catalog.py` against the current accepted artifact to regenerate; it verifies inventory hashes and executes pure accepted catalog helpers offline, without starting the game. Native asset existence alone is not an obtainability source. Dynamic generated gear, metadata variants and customized live recipes can differ; this is a bounded compendium, not an exhaustive loot dump.

`/dungeons/:id` uses accepted public definitions and reward tables via `python scripts/build-dungeon-details.py`, overlaid with recorded unique-run rollups. Run times include instance preparation/loading. `/market/history` projects only committed auction.purchase events from the retained 30-day audit window; no buyer UUIDs, claim receipts or investigation references are public. Item charts summarize up to 1,000 purchases and cannot value individual generated stat rolls.

The next game publisher sends saved equipment, selected talent ranks and actual currently connected public characters, with no inventory dump or coordinates. Presence expires after 180 seconds and is never inferred from lastPlayed. `/status` refreshes every minute while visible; unknown presence is distinct from zero players or an offline server. An optional Worker variable `RIFT_PUBLIC_MAINTENANCE` provides an operator-authored public maintenance message; remove it to resume live status. Missing equipment fields from an older publisher preserve explicitly dated saved gear, while an explicit empty equipment array clears it.

`python scripts/build-equipped-avatars.py` regenerates equipment cache variants from the allowlisted private bootstrap snapshot. `python scripts/build-selected-talents.py` exports canonical labels for selected public talent IDs. Both need regeneration when new equipment appearances or new selected talent IDs appear. Neither raw inventory nor private appearance selectors are shipped to browsers. `/start` is a local-browser first-session checklist; no account registration or staff activity is public.

Gold audit cards now include the server-provided source and context (shop item/quantity, quest, contract, staff action, guild or auction reference when captured). Old records explicitly indicate that their source was not recorded; no cause is reconstructed from a balance delta alone.


Regenerate the public gameplay data in order: `python scripts/build-item-catalog.py`, `python scripts/build-discovery-catalog.py`, then `python scripts/build-current-guide.py`. Set `DISCOVERY_JAVA` to a Java 25 executable if it is not at the default path. Seed entries include brush/perk requirements, effective current creature drops, and all eligible bag tiers with profession requirements. Fish rarity comes from the accepted fishing catalog, not native asset quality. Raw hides link through Tannery recipes; socketing XP and bag counts follow the accepted handbook.

`/npcs` lists the 44 unique canonical V2 citizens and 83 released overworld creature roles. `python scripts/build-npc-catalog.py` validates the accepted artifact, merges phase duplicates, exports only public introductions/services/drop links, and renders existing native models and saved citizen cosmetics into static portraits. No citizen UUIDs, placement data, commands, or raw dialogue trees are published. `--refresh-creatures` refreshes creature previews. The same tool renders six current dungeon encounters for dungeon previews; these are model previews, not map screenshots.

Guild detail pages expose only existing public descriptions, founding dates, member counts, and a roster drawn from public character profiles. Internal membership IDs, ranks, guild banks, permissions, applications and logs are not included in the detail endpoint. The retired `/start` checklist has been removed; old links redirect to the player guide.
