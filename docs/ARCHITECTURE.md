# Architecture

## Overview

```
 Phones (player)  ─┐
 Host tab (host)  ─┼── WebSocket ──▶ Worker router ──▶ GameRoom Durable Object (one per room code)
 TV tab (tv)      ─┘     /api/rooms/:code/ws              │
                                                          ├─ RoomCore   auth · validation · persistence · broadcast
                                                          ├─ engine     pure state machine + chip maths
                                                          ├─ projection per-role views (secrecy boundary)
                                                          └─ storage    "state" key + alarm (server timer)
```

## Reuse and merging

The Betting Game reuses **Who Said That?**'s multiplayer infrastructure nearly line for line, so a future merge only has to swap game modules:

| Piece | Status |
| --- | --- |
| `server/roomCore.ts` (rooms, identity, reconnection, broadcast, alarms) | Same code; the prompt bank is replaced with the question bank |
| `worker/src/index.ts`, `worker/src/gameRoom.ts`, `wrangler.toml` | Same code; renamed Worker |
| `web/src/lib/socket.ts`, `store/gameStore.ts`, `router.ts`, `config.ts`, `api.ts` | Same code |
| `components/TvStage`, `QRCode`, `Avatar`, `Timer`, `ui` (Button, Toasts, ConnectionBanner…) | Same code; a new `Logo` |
| Tailwind palette (`ink`, `cream`, `pop`), fonts (Fredoka + Nunito), hash routes (`#/host`, `#/tv`, `#/play`) | Shared, extended with `felt`, `gold`, `chip`, `opt` |
| Room codes, tokens, `hello`/`action`/`ack`/`error` protocol, `ping`/`pong` keepalive | Same |
| Test harness (`tests/helpers.ts`: fake sockets, storage, alarms, hibernation) | Same core, with betting helpers |

Game-specific pieces are `shared/engine/*`, `shared/views.ts`, `shared/protocol.ts` (actions), `shared/questions.ts`, and the screens. localStorage keys are namespaced (`btg:`) so the games don't clash on one origin.

## State machine

```
lobby ─start─▶ betting ─(all locked | timer)─▶ wagerReveal ─(timer)─▶ answerReveal ─(timer)─▶ scoreboard
               ▲  │                                 │                                              │
               │  └◀─ skip (new question) ──────────┘                                              │
               └────────────────────────────── (timer: next round) ◀───────────────────────────────┤
                                                                     (timer, after final round) ──▶ gameOver ─rematch─▶ betting | lobby
```

- **Hands-free after Start.** Every in-game phase is timed by the server, so a game plays from Start to `gameOver` with no host input: `betting` (host-configured), `wagerReveal` (4.5 s + 0.7 s per player, to match the TV's staggered stacks), `answerReveal` (10 s) and `scoreboard` (10 s). The durations live in `PHASE_TIMING` in `shared/constants.ts`. The host can still skip ahead with `advance` (the timer and the host share one `advancePhase()` transition), skip a question, pause/resume, or end the game. `gameOver` waits for the host's rematch.

- Every transition happens in `shared/engine/engine.ts`. The engine is pure: time and randomness come in through `EngineContext`, which makes it deterministic in tests.
- Invalid actions are rejected with a typed error code: `wrong_phase`, `too_late`, `stale`, `already_locked`, `invalid_wager`, `unauthorized`, and so on.
- The host's `advance` carries a `from` snapshot (`phase`, `round`, `dealId`). A double-click, a replayed message, or a click that lands just after the timer already moved on no longer matches and gets `stale`, so it can never skip ahead twice. `skipQuestion` carries the `dealId` for the same reason.
- **Bets are frozen exactly once**, when betting closes (`round.finalBets`). **Chips are settled exactly once**, on entering the answer reveal. That step is guarded by `round.results`, and history is guarded by round number. Repeated advances, alarms that fire twice, hibernation and message replays have no effect, as the tests show.
- Balances change only at the answer reveal, so a skip during betting or the wager reveal can't touch them.

## Betting rules in code

- `availableChips(balance) = balance + 250`, and `validateWager` enforces `0 ≤ wager ≤ available` in steps of 50. Balances are always multiples of 50, so "All In" is always a valid wager.
- `setBet {round, dealId, choice|null, wager}` saves a draft. `lockBet {round, dealId, choice, wager}` validates and locks in one atomic step. A duplicate of an identical lock is acknowledged with no change; any other change after locking gets `already_locked`.
- When betting closes, each player's last **valid** server-received draft becomes final. A draft with no answer is an abstention (wager 0). An invalid draft was never stored in the first place.
- `settleBet` returns `after = max(0, balance + 250 ± wager)`, plus the outcome, deltas and the all-in and big-bet flags. Every player in the round, abstainers included, gets the 250.
- The question's options are shuffled on the server each time it's dealt (`dealRound`), and `correctIndex` is remapped. `dealId` is random, so a bet aimed at a skipped question can never land on its replacement.

## Timers

Timers run on the server. Every in-game phase stores an absolute `deadline`, or `pausedRemainingMs` while paused, in Durable Object storage. The object's single storage alarm is set to the earliest of:

- the current phase's deadline;
- the end of a disconnected player's presence grace period (15 s);
- the room's expiry.

`tick()` runs on every alarm *and* before every incoming message. When a deadline passes, `tick()` moves to the next phase and starts its timer. So even if an alarm fires late, a bet sent after the deadline is still rejected as `too_late`. Clients render the countdown from `deadline` plus a clock offset they estimate from `serverNow`. Pausing freezes the remaining time in any phase (the host can linger on a reveal or the leaderboard), players can still adjust bets while paused, and any phase reached while paused starts frozen.

## Secrecy: per-role projections

The server never sends its own state to clients. `projection.ts` builds a separate `ClientView` for each role:

| Data | When it becomes visible |
| --- | --- |
| Correct answer, fun fact, source | Only from `answerReveal` onward, for every role, including the host (who may also be playing). The question bank itself never ships to the browser. |
| A player's own draft or locked bet | Only to that player, at any time. |
| Other players' answers and wagers during betting | Never. Others see only who has locked in (`lockedIds`). |
| Wagers | From `wagerReveal`, as amount, available chips, and the abstained, all-in and big-bet flags. The wager view has no `choice` field. |
| Every player's pick and result | From `answerReveal`. |
| Tokens | Never in any view. A player's token is sent once, to that player, when they join. The host token is never sent. |

Tests scan every message each socket received for `correctIndex`, the fact and source text, other players' wager values, and tokens.

## Protocol and authentication

- Client to server: `hello {role, token?}`, then `action {ref, action}`. Every message is parsed with zod. Unknown, oversized or malformed messages get `bad_message`. That includes negative wagers and option indexes above 3, so they never reach the engine.
- Identity comes from the connection, not from the message. After `hello`, the socket's attachment records `{role, playerId}`. Actions never carry a player id, so a client can't bet as someone else.
- **Host**: a 32-character random `hostToken` returned when the room is created and kept in that browser's localStorage. **Players**: a 32-character random token issued on join, kept in localStorage under the room code, and used to reconnect. **TV**: needs no secret, because its view is public.
- Server to client: `welcome`, `state {view}`, `joined {playerId, token}`, `ack {ref}`, `error {code, message, ref}`, `kicked`, `roomClosed`.
- Keepalive: the client sends the plain text `ping` every 15 seconds, which the runtime answers through `setWebSocketAutoResponse` without waking a hibernated object.

## Reliability

- **Durable Object hibernation.** The room uses the WebSocket Hibernation API. Socket identity lives in `serializeAttachment`. State is written with `storage.put` before any broadcast, and the constructor reloads it in `blockConcurrencyWhile`. Tests simulate eviction by rebuilding `RoomCore` from storage mid-round, in the middle of a timer and mid-reveal.
- **Presence** comes from the sockets that are actually open, recomputed on every event.
- **Reconnection.** Clients use exponential backoff with jitter, reconnect immediately on `visibilitychange`, `online` or `focus`, and re-send `hello` with the stored token. Refreshing a phone, the TV or the host restores the exact view, including a player's unsent draft bet as last saved on the server.
- **Disconnected players don't block.** Betting auto-closes once every *present* player has locked in. A player counts as present while connected, or for 15 s after disconnecting. The timer is the final backstop.
- **Animations never gate state.** The DOM always shows the latest server state, and final values are in `data-*` attributes immediately. Animations are cosmetic counters and stacks, and they respect `prefers-reduced-motion` through `MotionConfig reducedMotion="user"`, CSS rules, and confetti's `disableForReducedMotion`. Sound is off by default and the game is fully playable without it.

## Design decisions

These are areas where the spec left room, and what was chosen.

- **Skip** replaces the question within the same round number. All bets are discarded and no chips move. Skipping is allowed during betting and the wager reveal. Once the answer is out the round is settled, so the button disappears.
- **Question + betting is one phase.** The question appears with the betting timer running; there's no separate "get ready" step.
- **Locking requires an answer.** A player who wants to bet nothing picks an answer and locks a wager of 0. Players who never pick an answer abstain.
- **Big bet** means at least 50% of the player's available chips. **All in** means wagering exactly the available amount.
- **Wager reveal order** goes from smallest to largest, with abstainers first, so the biggest bet lands last.
- **End Game** lets the host finish early. A round that's still betting or in the wager reveal is discarded; a settled round stands.
- **Rematch** offers either "Rematch" (start immediately with the same roster and settings) or "Change Settings / New Players" (back to the lobby, roster kept). Both reset balances and history, and prefer questions not used in earlier games in that room.
- **Rooms expire** after 12 hours with no connections and no activity.

## Known limitations

- **Host identity is tied to one browser** through its localStorage token. Anyone can open the TV, or join as a player, from any device.
- **New players can't join a game in progress.** They join at the next rematch-to-lobby. A player on a different phone or browser can't reclaim a seat.
- **The question bank is English only and static.** Facts were checked against the cited sources at the time of writing. Time-sensitive facts (for example, the most populous country) may need occasional review.
- **There's no rate limiting** beyond Cloudflare's defaults. Add a Cloudflare rate-limiting rule if the Worker is public.
- **Browser coverage:** iOS Safari and Android Chrome are emulated in Playwright on Chromium. A real-device pass on WebKit is recommended.
