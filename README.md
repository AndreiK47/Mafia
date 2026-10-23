# MAFIA — multiplayer social deduction game

The existing HTML, CSS, and vanilla JavaScript interface is retained. This project now includes an Express JSON API, MySQL 8 schema and migration, server-managed authentication, an authoritative game rules module, and Ably notifications. Players sign in to create rooms, invite friends, or fill the waiting lobby with bots for solo testing. Game state and match rules are server-authoritative.

## Local setup

Requirements: Node.js 20 or newer, npm, and a MySQL 8 compatible database. Create an empty database and a restricted application user, then:

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `APP_ORIGIN`, and `CRON_SECRET`. For remote MySQL, set `DB_SSL=true` and use the provider's TLS endpoint and connection settings.
3. Apply the schema using `npm run migrate`.
4. Start the site and API with `npm run dev`, then open `http://localhost:3000`.

The schema is versioned in `migrations/001_initial.sql` through `migrations/005_sheriff_shoot.sql`. `npm run migrate` applies each unapplied migration. The bot migration adds a marker so generated players do not count as real account activity. Back up the database before applying migrations to an existing installation. The app's pool uses a bounded connection count; choose a limit compatible with the MySQL provider and its connection proxy.

## Accounts and rooms

Create an account from **Create Account** in the site. Passwords are hashed with Argon2id. Authentication uses a random server-managed session whose hash is stored in MySQL; the browser receives an HttpOnly session cookie and a separate CSRF cookie/token. No authentication token or password is stored in localStorage. Set `APP_ORIGIN` to the exact deployed site origin. A new room contains its creator only. From the waiting lobby, the host can fill the table with bots up to 6, 8, 10, or 12 players, or invite real players. Bots vote, take their role actions, and add occasional daytime chat. Their match results do not affect account statistics. Bots are available only in server-backed rooms so they play through the same real game rules as human players.

Private-room passwords are hashed before storage. Invitation codes contain 96 bits of randomness. Room membership, readiness, and game state are stored in MySQL. A guest can browse the public interface, but must sign in to create or join a playable room.

## Optional seed table

For local testing only, set `SEED_USERS_JSON` to a JSON array of 6–12 user objects with unique `username`, `email`, and `password` values, then run `npm run seed`. The script refuses `NODE_ENV=production`, hashes each password, and creates one ready public room. Keep this variable in a local-only environment and remove it afterward. Never add seed passwords to source control.

## Tests

Run the game-engine tests with `npm test`. They cover role assignment, role secrecy, action restrictions and locks, Don attack authority, Mafia tie resolution, Sheriff investigation and shooting, protection and blocking, visitor privacy, and win checks.

The HTTP integration suite is skipped unless `TEST_DATABASE_URL` points to a disposable MySQL database whose database name includes `test`. Apply all migrations to that database first, then run `npm test`; the suite exercises registration and login failures, CSRF/session checks, private-room access, concurrent capacity enforcement, empty-seat room creation, host-only start, readiness, role-reveal secrecy and the automatic first-night transition, persisted chat permissions, vote changes, phase transitions through day 99, night abilities, elimination, and win detection. It cleans up the rooms, games, chat, history, events, role results, and users it creates. Do not point it at production data.

## Game rules

- Classic rooms can set a minimum of 6–12 players and a maximum of 6, 8, 10, or 12. Every active human must be Ready; generated bots are marked Ready automatically. The server assigns roles using Node's cryptographically secure random generator. Custom rooms require an exact role distribution that includes Mafia and Town; that roster size is also the start size.
- Starting locks the room and reveals each player's private role for 8 seconds, then starts Night 1. Its resolution opens Day 1 discussion; discussion then opens public voting. A unique plurality leader opens the timed convict-or-spare verdict; a tie or a winning skip advances to night without nomination. Players can change a vote or skip before the timer expires. Verdict conviction requires more 👍 than 👎 votes. Night, day, voting, and verdict phases use server timers and room settings (defaults: 60, 60, and 30 seconds for night, day, and vote/verdict). Database UTC timestamps are authoritative. Vercel Cron checks expired games every minute; local development does the same. Waiting rooms with no human member heartbeat for two minutes are deleted when cleanup runs. In-progress game rooms and rooms with a recently active human are preserved.
- Votes can be changed while voting is open. Abstention is off by default. A daytime nomination requires a strict majority of submitted ballots; ties, no votes, and votes without a majority nominate nobody. A majority of verdict votes convicts the nominee; otherwise they are spared. Live vote totals are hidden by default and can be enabled per room. Living Mafia win when their number is equal to or greater than the living Town. Town wins when Mafia and any active solo Maniac threat are eliminated; the Maniac wins only as the last survivor.
- Roles are Civilian, Mafia, Don, Sheriff, Doctor, Detective, Jailor, Prostitute, Vagabond, and Maniac. Each match has at most one Don and one Sheriff. While Don is alive, Mafia members may lock proposals, but only the Don's confirmed target determines the team's attack; a missing or blocked Don action cancels it. Without a living Don, confirmed Mafia targets resolve by plurality and ties are chosen randomly among tied leaders; no votes means no Mafia attack. Night actions lock after confirmation and persist when players reconnect.
- The Sheriff chooses one action each night: privately investigate for Mafia/not Mafia, or shoot. A shot at Mafia is safe for the Sheriff; shooting a Town member also kills the Sheriff, even if the Doctor saves the target. Other factions do not trigger the Sheriff penalty under the current configuration. Doctor may protect themself but cannot protect the same player two nights in a row. Jailor detention and Doctor protection prevent ordinary night attacks; Prostitute blocks the target's action; Vagabond privately sees visitor identities only, with just the final Mafia attacker counted as the Mafia visitor; Maniac makes an independent night attack. Role reports are stored privately.
- Other players' roles, private night actions, and unrevealed votes are filtered from live game state. Completed matches reveal roles to their participants. The backend, not the browser, decides roles, votes, phase transitions, eliminations, and winners.

## Ably realtime

Create an Ably app and provide its private API key in `ABLY_API_KEY` on the server only. The key needs permission to publish server events and create scoped subscriber/presence tokens. The frontend uses the official Ably JavaScript CDN SDK; the private key is never sent to it. The API issues one-minute TokenRequests limited to the signed-in player's rooms, game, personal event channel, and (for living Mafia only) the private Mafia channel.

MySQL commits happen before the API publishes events. If a notification is missed, clients can fetch the authoritative state again. No WebSocket server or in-memory message bus runs inside the Vercel Function. Ably presence is an online hint only; it does not grant game permissions.

Without an Ably account/key, the API continues to work, but realtime subscriptions are unavailable. Install and configure a provider before treating the deployment as a live multiplayer service.

## Vercel deployment

Connect this folder as the project root. Vercel serves the existing static frontend and routes `/api/*` to the Express function in `api/`. Direct UI routes are rewritten to `index.html`; the route IDs remain in the browser History API. No permanent server process or WebSocket connection is used by the function.

Add these settings in the Vercel project environment for each deployment target:

- `NODE_ENV=production`
- `APP_ORIGIN=https://your-site.example` (exact origin)
- `DATABASE_URL` using the MySQL provider's TLS-enabled connection endpoint
- `DB_CONNECTION_LIMIT` sized for the database plan and any serverless connection proxy
- `DB_SSL=true`
- `CRON_SECRET` as a random value of at least 16 characters
- `ABLY_API_KEY` from the Ably dashboard
- `REALTIME_PROVIDER=ably`

Run the migration against the provisioned database before inviting players. Deploying `vercel.json` registers the phase-reconciliation Cron. Add the app's Vercel function region near the MySQL region to reduce latency. Verify the provider's connection limits and IP/network access rules; serverless functions may scale across instances. The Cron is a fallback for idle games and is not an exact real-time clock.

## API overview

`/api/auth/{register,login,logout,me}`, `/api/users/me`, `/api/rooms`, `/api/rooms/:id/{join,leave,ready,start,close,messages}`, `/api/games/:id/{state,role,actions,votes,verdict,advance-phase}`, `/api/history`, and `/api/realtime/token` are implemented. All SQL values use prepared statements. State-changing signed-in requests require the session CSRF token. Inputs are validated, unknown API routes return JSON errors, and server logs omit passwords, cookies, roles, and query details.

## Limitations before production launch

Credentials for MySQL, Vercel, and Ably are not present in this workspace, so no external service connection or deployment was tested. The browser UI has the online account, room, lobby, phase, vote, chat, profile, and history integrations; polish such as surfacing private investigation history and a production-grade account recovery/moderation flow remains future work. Use a dedicated security review, operational monitoring, backups, and isolated deployment testing before launching to real players.
