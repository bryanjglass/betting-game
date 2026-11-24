# The Betting Game

A browser-based family trivia game where you bet virtual chips on how sure you are. Everyone answers the same multiple-choice question on their phone and secretly wagers chips on it. Right answers win the bet and wrong answers lose it. The TV then runs **The Big Bet Reveal**: the wagers come first, then the answer. Built for 2–10 players, ages 9 through adult.

All chips are virtual. There's no real money anywhere in the game.

- **Host controller**: a desktop Chrome tab that creates the room and runs the game.
- **TV display**: a second tab you cast to the television. It's a fixed 1920×1080 stage scaled to fit the screen.
- **Player controllers**: phones (iOS Safari or Android Chrome). Players join with a 4-letter code or a QR scan. There are no accounts and nothing to install. The host can also play from their own phone.

Built with React, TypeScript, Vite, Zustand and Tailwind on the frontend, and Cloudflare Workers with Durable Objects and WebSockets on the backend. Tests use Vitest and Playwright. There's no database, no auth provider, and no trivia or AI API.

It shares its multiplayer infrastructure, layout and visual language with **Who Said That?** (and, through it, Fib Factory), so the games can later be merged into one experience. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#reuse-and-merging).

---

## Quick start (local development)

Requires Node 20 or later.

```bash
npm install
npm run dev
```

That starts two things:

| Process | URL | What it does |
| --- | --- | --- |
| `wrangler dev` | http://127.0.0.1:8787 | Worker + Durable Objects, running locally in workerd |
| `vite` | http://localhost:5173 | Frontend. It proxies `/api` (HTTP and WebSocket) to the Worker |

Open http://localhost:5173, click **Create a Room**, then **Open TV Display**. Join from other browser windows, or from phones as described below.

**Playing with real phones locally:** phones can't reach `localhost`. Start the frontend on your LAN, and open the host page through your computer's LAN IP so the QR code points somewhere phones can reach:

```bash
npm run dev:worker
npm run dev:web:lan     # in a second terminal
```

Then browse to `http://<your-LAN-IP>:5173` on the computer. You can also set `VITE_PUBLIC_URL` (see `.env.example`).

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Worker + frontend together |
| `npm run dev:worker` / `npm run dev:web` | Run each one on its own |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end test. Starts its own Worker on :8788 and Vite on :5174 |
| `npm run test:all` | Typecheck, Vitest, then Playwright |
| `npm run validate:questions` | Validate the question bank after editing it |
| `npm run typecheck` | TypeScript for the frontend, shared code and Worker |
| `npm run build` | Typecheck, then build the production frontend into `dist/` |
| `npm run deploy:worker` | Deploy the Cloudflare backend |

---

## How to play

1. **Lobby**: the host creates a room. The TV shows a QR code and the room code. Each player picks a unique name (ignoring case) and one of 16 cartoon avatars. The host chooses 5, 10, 15 or 20 questions, a 15, 30, 45 or 60-second betting timer, and any of the seven categories.
2. **Question and betting**: the TV shows the question, four answers, a countdown and who has locked in. On their phone, each player picks an answer and sets a wager with the slider, the ±50 buttons, or the quick picks (0, 25%, 50%, ALL IN). The phone always shows the exact amount at risk and the balance if right or wrong. Bets can be changed until the player taps **Lock In**. Every change is saved to the server, so if time runs out, the last saved bet counts.
3. **The Big Bet Reveal**: when everyone has locked in, or time runs out, the TV reveals each player's wager from smallest to largest, as stacks of chips. Big bets and all-ins get extra drama. Answers are still hidden.
4. **Answer reveal**: after a drum-roll, the correct answer lights up. The TV shows everyone's pick, winning stacks double, losing stacks crumble ("BUSTED!" for a lost all-in), and balances count to their new values.
5. **Leaderboard**: the rankings animate, with rank changes and round highlights.
6. **Next question**: the host advances. After the last round comes **Game Over**: the champion (or tied champions), final standings, statistics and awards, then **Rematch**.

### Chip rules (computed only on the server)

- Everyone starts with **1,000 chips**.
- Every completed round adds **250 chips** for every player, including anyone who didn't bet. Those 250 can be wagered in the same round.
- A wager can be anything from **0** to **balance + 250**, in **multiples of 50**.
- Right answer: **+wager**. Wrong answer: **−wager**. No answer, or a bet of 0: no change.
- Balances can never go negative. A player with 0 chips can still bet the next round's 250.
- A **skipped question** awards nothing and costs nothing. The host's skip replaces it with a new question in the same round.
- The highest balance at the end wins, and ties share a rank.

Example: you start a round with 1,000 and bet 500. Right gives 1,750, wrong gives 750, and not betting gives 1,250.

---

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SERVER_URL` | frontend build | Worker URL, for example `https://betting-game.you.workers.dev`. WebSocket URLs are derived from it (`https` becomes `wss`). Leave it unset in development. |
| `VITE_BASE` | frontend build | Base path. GitHub Pages project sites need `/<repo>/`. |
| `VITE_PUBLIC_URL` | frontend build | Optional override for the URL inside the join QR code. |
| `DEV_WORKER_URL` | dev only | Where the Vite proxy forwards `/api` (default `http://127.0.0.1:8787`). |
| `ALLOWED_ORIGINS` | `worker/wrangler.toml` `[vars]` | Comma-separated browser origins allowed to create and join rooms. The default `*` is fine for development. In production, set it to your Pages origin, for example `https://you.github.io`. |

See `.env.example`. Deployment steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Questions

`shared/data/questions.json` holds 119 family-friendly questions across Science & Nature, Sports, Movies & Entertainment, Geography, History, Weird Facts and General Knowledge. Each one has four options, one correct answer, a source reference, and usually a fun fact shown at the reveal. The bank only ever ships inside the Worker. The browser bundle doesn't contain it, so answers can't be read from the frontend code. To add your own questions, see [docs/QUESTIONS.md](docs/QUESTIONS.md).

---

## Testing

```bash
npm test
```

That runs 58 Vitest tests covering:

- **Chip maths** (`tests/unit/scoring.test.ts`): wager limits and steps, the worked example, zero and all-in wagers, abstentions, round allowances, broke players, no negative balances, tied rankings, highlights and awards.
- **Question bank** (`tests/unit/questions.test.ts`): at least 100 questions, every category covered, four distinct options, one answer, a source each, and helpful validation errors.
- **The room server** (`tests/integration/room.test.ts`): the real `RoomCore` driven through fake sockets, storage and alarms. It covers lobby rules, host-only controls, random questions that never repeat, private bets, editing then locking, idempotent locks, auto-close, timeouts that finalise the last valid draft, abstentions, late, stale and unauthorized submissions, disconnected players, wagers revealed before answers, **chips applied exactly once despite replays, repeated alarms and hibernation**, skips, pause and resume, ties, game end, rematch, reconnection, host and TV refresh, token and answer leak scans, and room isolation.
- **The Worker router** (`tests/integration/worker.test.ts`): the real `GameRoom` Durable Object class against in-memory storage. It covers room-code collisions, info lookups and the origin allow-list.

```bash
npm run test:e2e
```

That's the Playwright end-to-end test (`e2e/full-game.spec.ts`). It runs against the real `wrangler dev` backend with a host, a TV opened from the host's button, and four phones (two emulated iPhones, two emulated Pixels). They play all five rounds with **exact chip balances asserted on the host, the TV and every phone after every round**, covering:

- wins, losses and a zero bet;
- all-in wins and losses;
- a broke player betting the allowance;
- a skipped question;
- a timeout that finalises an unlocked draft;
- a player who never bets.

It also checks refresh recovery, the final standings and a rematch.

---

## Project layout

```
shared/              Code used by the server and (types/constants only) the browser
  constants.ts       Phases, chip rules, limits, categories, room-code alphabet
  protocol.ts        zod-validated WebSocket messages
  views.ts           Client-facing projection types (all that's ever sent to browsers)
  questions.ts       Question bank loader + validator (server only)
  data/questions.json  119 trivia questions with sources (see docs/QUESTIONS.md)
  engine/
    engine.ts        Authoritative state machine (pure: time + randomness injected)
    scoring.ts       Wager validation, settling bets, rankings, highlights, awards
    projection.ts    Per-role projections (the secrecy boundary)
    state.ts         Server-only state types
server/roomCore.ts   Transport-agnostic room: auth, validation, persistence, alarms, broadcast
worker/              Cloudflare Worker router + GameRoom Durable Object + wrangler.toml
web/                 React app (host / TV / player), Zustand store, resilient socket client
tests/               Vitest unit + integration tests
e2e/                 Playwright end-to-end test
docs/                Architecture, deployment, question format
```
