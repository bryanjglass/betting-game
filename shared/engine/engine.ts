/**
 * The authoritative game state machine.
 *
 *   lobby → betting ─(all locked | timer | host)→ wagerReveal ─(host)→ answerReveal ─(host)→ scoreboard
 *             ▲  │ skip (new question, same round)                                            │
 *             │  └──────────────┘                                                             │
 *             └──────────────────────────── (host: next round) ───────────────────────────────┤
 *                                                                  (host, after final round) ─┴→ gameOver ─rematch→ betting | lobby
 *
 * All functions are pure with respect to I/O: time and randomness are injected
 * through EngineContext, and state is mutated in place only after an action
 * has been fully validated. The Durable Object persists state after every
 * successful change.
 *
 * Chip rules (see scoring.ts):
 *  - Everyone starts with 1,000 chips.
 *  - Each completed round credits 250 chips, which may be wagered that round.
 *  - Correct answer: +wager. Wrong answer: −wager. No answer: no wager.
 *  - Balances are only changed once per round, on entering the answer reveal.
 */
import { CATEGORIES, CHIPS, DEFAULT_CONFIG, LIMITS, ROUND_OPTIONS, TIMER_OPTIONS, type Category } from "../constants";
import type { Action, ConfigPatch, ErrorCode } from "../protocol";
import type { GameConfig } from "../views";
import { randomId, shuffle, type RandomSource } from "./random";
import { availableChips, rankByChips, settleBet, validateWager } from "./scoring";
import type { FinalBet, GameState, Question, ServerPlayer, ServerRound } from "./state";

export interface EngineContext {
  now: number;
  random: RandomSource;
  questions: readonly Question[];
}

export type Actor =
  | { kind: "host" }
  | { kind: "tv" }
  | { kind: "guest" }
  | { kind: "player"; playerId: string };

export type ActionResult =
  | { ok: true; changed: boolean; joined?: { playerId: string; token: string }; kickedPlayerId?: string }
  | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message });
const OK_UNCHANGED: ActionResult = { ok: true, changed: false };
const OK_CHANGED: ActionResult = { ok: true, changed: true };

const HOST_ACTIONS = new Set<Action["type"]>([
  "configure",
  "start",
  "pause",
  "resume",
  "advance",
  "skipQuestion",
  "kick",
  "endGame",
  "rematch",
]);
const PLAYER_ACTIONS = new Set<Action["type"]>(["updateProfile", "setBet", "lockBet"]);

export function createGame(code: string, hostToken: string, now: number): GameState {
  return {
    schemaVersion: 1,
    code,
    hostToken,
    createdAt: now,
    lastActivity: now,
    version: 1,
    gameNumber: 1,
    config: { ...DEFAULT_CONFIG, categories: [...DEFAULT_CONFIG.categories] },
    phase: "lobby",
    players: [],
    nextJoinOrder: 0,
    round: null,
    history: [],
    questionQueue: [],
    usedQuestionIds: [],
    previousGameQuestionIds: [],
    timer: null,
    paused: false,
    closed: false,
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Control chars, zero-width & bidi-override characters.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]", "g");

/** Strip control characters, collapse whitespace, trim. */
export function cleanText(input: string): string {
  return input.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** Length in user-perceived code points (so emoji count as one). */
export function textLength(text: string): number {
  return [...text].length;
}

export function normalizeName(name: string): string {
  return cleanText(name).normalize("NFKC");
}

function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase("en-US");
}

// ---------------------------------------------------------------------------
// Presence / eligibility
// ---------------------------------------------------------------------------

export function isPresent(p: ServerPlayer, now: number): boolean {
  return p.connected || now - p.lastSeenAt < LIMITS.presenceGraceMs;
}

export function connectedCount(state: GameState): number {
  return state.players.filter((p) => p.connected).length;
}

/**
 * Betting is "done" if every player has locked in, or — so a vanished phone
 * can't stall the room — every *present* player has (and at least one is present).
 */
function everyoneLocked(state: GameState, now: number): boolean {
  const round = state.round;
  if (!round || state.players.length === 0) return false;
  const done = (p: ServerPlayer) => round.locked.includes(p.id);
  if (state.players.every(done)) return true;
  const present = state.players.filter((p) => isPresent(p, now));
  return present.length > 0 && present.every(done);
}

/** Update a player's connection flag. Returns true if anything changed. */
export function setPresence(state: GameState, playerId: string, connected: boolean, now: number): boolean {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.connected === connected) return false;
  p.connected = connected;
  p.lastSeenAt = now;
  bump(state, now);
  return true;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

function setPhaseTimer(state: GameState, seconds: number, now: number) {
  const ms = seconds * 1000;
  state.timer = state.paused
    ? { deadline: null, pausedRemainingMs: ms, durationMs: ms }
    : { deadline: now + ms, pausedRemainingMs: null, durationMs: ms };
}

export function remainingMs(state: GameState, now: number): number {
  if (!state.timer) return 0;
  if (state.timer.deadline === null) return state.timer.pausedRemainingMs ?? 0;
  return Math.max(0, state.timer.deadline - now);
}

/** The next moment the engine needs to be woken (timer expiry or presence-grace expiry). */
export function nextWakeTime(state: GameState, now: number): number | null {
  let next: number | null = state.timer?.deadline ?? null;
  if (state.phase === "betting") {
    for (const p of state.players) {
      if (!p.connected) {
        const t = p.lastSeenAt + LIMITS.presenceGraceMs;
        if (t > now && (next === null || t < next)) next = t;
      }
    }
  }
  return next;
}

/**
 * Advance the game for the passage of time: expire timers and re-check
 * auto-advance conditions. Safe to call at any time, any number of times.
 */
export function tick(state: GameState, ctx: EngineContext): boolean {
  let changed = false;
  if (state.timer?.deadline != null && ctx.now >= state.timer.deadline) {
    if (state.phase === "betting") closeBetting(state);
    else state.timer = null;
    changed = true;
  }
  changed = autoAdvance(state, ctx) || changed;
  if (changed) bump(state, ctx.now);
  return changed;
}

/** Close betting early once everyone eligible has locked in. */
export function autoAdvance(state: GameState, ctx: EngineContext): boolean {
  if (state.phase === "betting" && everyoneLocked(state, ctx.now)) {
    closeBetting(state);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function bump(state: GameState, now: number) {
  state.version += 1;
  state.lastActivity = now;
}

function questionPool(state: GameState, questions: readonly Question[]): Question[] {
  return questions.filter((q) => state.config.categories.includes(q.category));
}

function buildQuestionQueue(state: GameState, ctx: EngineContext) {
  const pool = questionPool(state, ctx.questions);
  const fresh = pool.filter((q) => !state.previousGameQuestionIds.includes(q.id));
  // Prefer questions not seen in earlier games in this room, if there are
  // enough (with headroom for skips); otherwise fall back to the whole pool.
  const source = fresh.length >= state.config.rounds + 5 ? fresh : pool;
  state.questionQueue = shuffle(source, ctx.random).map((q) => q.id);
}

function takeNextQuestion(state: GameState, ctx: EngineContext): Question {
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  const pull = (): Question | undefined => {
    while (state.questionQueue.length) {
      const id = state.questionQueue.shift()!;
      const q = byId.get(id);
      if (q && !state.usedQuestionIds.includes(id)) return q;
    }
    return undefined;
  };
  let question = pull();
  if (!question) {
    // Queue exhausted (many skips): draw from any unused question in the categories.
    const pool = questionPool(state, ctx.questions).filter((q) => !state.usedQuestionIds.includes(q.id));
    state.questionQueue = shuffle(pool, ctx.random).map((q) => q.id);
    question = pull();
  }
  if (!question) {
    // Every question in the chosen categories was used in this game — only
    // reachable after dozens of skips. Allow repeats rather than get stuck.
    state.usedQuestionIds = [];
    buildQuestionQueue(state, ctx);
    question = pull()!;
  }
  state.usedQuestionIds.push(question.id);
  return question;
}

/** Deal a question for round `number`: shuffle its options and open betting. */
function dealRound(state: GameState, number: number, ctx: EngineContext) {
  const q = takeNextQuestion(state, ctx);
  // Randomise answer order on the server; the correct index moves with it.
  const order = shuffle([0, 1, 2, 3], ctx.random);
  state.round = {
    number,
    dealId: `d_${randomId(ctx.random, 10)}`,
    questionId: q.id,
    category: q.category,
    text: q.text,
    options: order.map((i) => q.options[i]!),
    correctIndex: order.indexOf(q.correctIndex),
    source: q.source,
    fact: q.fact ?? null,
    bets: {},
    locked: [],
    finalBets: null,
    results: null,
    ranksBefore: null,
  };
  state.phase = "betting";
  setPhaseTimer(state, state.config.bettingSeconds, ctx.now);
}

/**
 * Close betting: freeze every player's last valid server-received bet.
 * Players without an answer abstain (no wager). Runs at most once per deal.
 */
function closeBetting(state: GameState) {
  const round = state.round!;
  state.phase = "wagerReveal";
  state.timer = null;
  if (round.finalBets) return; // idempotency guard
  const finalBets: Record<string, FinalBet> = {};
  for (const p of state.players) {
    const bet = round.bets[p.id];
    const available = availableChips(p.chips);
    finalBets[p.id] =
      bet && bet.choice !== null && validateWager(bet.wager, p.chips) === null
        ? { choice: bet.choice, wager: bet.wager, available }
        : { choice: null, wager: 0, available };
  }
  round.finalBets = finalBets;
}

/**
 * Reveal the answer and settle every bet. Chip balances change here and only
 * here, and the `results` guard means it can never be applied twice.
 */
function revealAnswer(state: GameState) {
  const round = state.round!;
  state.phase = "answerReveal";
  state.timer = null;
  if (round.results) return; // idempotency guard — never settle twice
  round.ranksBefore = Object.fromEntries(rankByChips(state.players));
  const results: ServerRound["results"] = {};
  for (const p of state.players) {
    const bet = round.finalBets?.[p.id] ?? null;
    const result = settleBet(p.chips, bet, round.correctIndex);
    results[p.id] = result;
    p.chips = result.after;
  }
  round.results = results;
  if (!state.history.some((h) => h.number === round.number)) {
    state.history.push({ number: round.number, questionId: round.questionId, results });
  }
}

function endGame(state: GameState) {
  state.phase = "gameOver";
  state.timer = null;
  state.paused = false;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateConfig(config: GameConfig): string | null {
  if (!(ROUND_OPTIONS as readonly number[]).includes(config.rounds)) return `Rounds must be one of ${ROUND_OPTIONS.join(", ")}`;
  if (!(TIMER_OPTIONS as readonly number[]).includes(config.bettingSeconds)) {
    return `Timer must be one of ${TIMER_OPTIONS.join(", ")} seconds`;
  }
  if (config.categories.length === 0) return "Choose at least one category";
  if (new Set(config.categories).size !== config.categories.length) return "Duplicate category";
  if (config.categories.some((c) => !CATEGORIES.includes(c))) return "Unknown category";
  return null;
}

export function startBlockers(state: GameState, questions: readonly Question[]): string[] {
  const out: string[] = [];
  const connected = connectedCount(state);
  if (connected < LIMITS.minPlayers) out.push(`Need at least ${LIMITS.minPlayers} connected players (${connected} now)`);
  if (state.players.length > LIMITS.maxPlayers) out.push(`At most ${LIMITS.maxPlayers} players`);
  if (questionPool(state, questions).length < state.config.rounds) {
    out.push("Not enough questions in the selected categories — pick more categories or fewer rounds");
  }
  return out;
}

function validateName(state: GameState, raw: string, selfId: string | null): ActionResult | string {
  const name = normalizeName(raw);
  if (textLength(name) < LIMITS.minNameLength) return fail("invalid", "Please enter a name");
  if (textLength(name) > LIMITS.maxNameLength) return fail("invalid", `Names can be at most ${LIMITS.maxNameLength} characters`);
  const key = nameKey(name);
  if (state.players.some((p) => p.id !== selfId && nameKey(p.name) === key)) {
    return fail("name_taken", `"${name}" is already taken — try another name`);
  }
  return name;
}

function validateAvatar(state: GameState, avatar: number, selfId: string | null): ActionResult | null {
  if (!Number.isInteger(avatar) || avatar < 0 || avatar >= LIMITS.avatarCount) return fail("invalid", "Unknown avatar");
  if (state.players.some((p) => p.id !== selfId && p.avatar === avatar)) return fail("invalid", "Someone already picked that avatar");
  return null;
}

/** Gate for bet actions: right round, right question, still betting, before the deadline. */
function bettingGate(state: GameState, round: number, dealId: string, ctx: EngineContext): ActionResult | null {
  const current = state.round;
  if (!current || state.phase === "lobby" || state.phase === "gameOver") return fail("wrong_phase", "No question is open");
  if (round < current.number) return fail("too_late", "That round is over");
  if (round > current.number) return fail("wrong_phase", "That round hasn't started");
  if (dealId !== current.dealId) return fail("stale", "That question was skipped — here's a new one");
  if (state.phase !== "betting") return fail("too_late", "Betting is closed");
  if (state.timer?.deadline != null && ctx.now >= state.timer.deadline) return fail("too_late", "Time's up — betting is closed");
  return null;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, actor: Actor, action: Action, ctx: EngineContext): ActionResult {
  if (state.closed) return fail("not_found", "This room has closed");
  if (HOST_ACTIONS.has(action.type) && actor.kind !== "host") return fail("unauthorized", "Only the host can do that");
  if (PLAYER_ACTIONS.has(action.type) && actor.kind !== "player") return fail("unauthorized", "Only players can do that");
  if (action.type === "join" && actor.kind !== "guest") {
    return fail(actor.kind === "player" ? "invalid" : "unauthorized", "Already joined");
  }
  const result = dispatch(state, actor, action, ctx);
  if (result.ok && result.changed) {
    autoAdvance(state, ctx);
    bump(state, ctx.now);
  }
  return result;
}

function dispatch(state: GameState, actor: Actor, action: Action, ctx: EngineContext): ActionResult {
  const me = actor.kind === "player" ? state.players.find((p) => p.id === actor.playerId) : undefined;
  if (actor.kind === "player" && !me) return fail("invalid_token", "You are no longer in this game");

  switch (action.type) {
    case "join": {
      if (state.phase !== "lobby") return fail("game_in_progress", "This game has already started");
      if (state.players.length >= LIMITS.maxPlayers) return fail("room_full", `This room is full (${LIMITS.maxPlayers} players max)`);
      const name = validateName(state, action.name, null);
      if (typeof name !== "string") return name;
      const avatarError = validateAvatar(state, action.avatar, null);
      if (avatarError) return avatarError;
      let playerId: string;
      do playerId = `p_${randomId(ctx.random, 8)}`;
      while (state.players.some((p) => p.id === playerId));
      const token = randomId(ctx.random, 32);
      state.players.push({
        id: playerId,
        token,
        name,
        avatar: action.avatar,
        joinOrder: state.nextJoinOrder++,
        chips: CHIPS.starting,
        connected: false,
        lastSeenAt: ctx.now,
      });
      return { ok: true, changed: true, joined: { playerId, token } };
    }

    case "updateProfile": {
      if (state.phase !== "lobby") return fail("wrong_phase", "You can only change your profile in the lobby");
      let name = me!.name;
      if (action.name !== undefined) {
        const v = validateName(state, action.name, me!.id);
        if (typeof v !== "string") return v;
        name = v;
      }
      if (action.avatar !== undefined) {
        const err = validateAvatar(state, action.avatar, me!.id);
        if (err) return err;
      }
      const avatar = action.avatar ?? me!.avatar;
      if (name === me!.name && avatar === me!.avatar) return OK_UNCHANGED;
      me!.name = name;
      me!.avatar = avatar;
      return OK_CHANGED;
    }

    case "setBet": {
      const gate = bettingGate(state, action.round, action.dealId, ctx);
      if (gate) return gate;
      const round = state.round!;
      const existing = round.bets[me!.id];
      if (round.locked.includes(me!.id)) {
        // A replayed draft that matches the locked bet is harmless; anything else is refused.
        return existing && existing.choice === action.choice && existing.wager === action.wager
          ? OK_UNCHANGED
          : fail("already_locked", "Your bet is locked in");
      }
      const wagerError = validateWager(action.wager, me!.chips);
      if (wagerError) return fail("invalid_wager", wagerError);
      if (existing && existing.choice === action.choice && existing.wager === action.wager) return OK_UNCHANGED;
      round.bets[me!.id] = { choice: action.choice, wager: action.wager, updatedAt: ctx.now };
      return OK_CHANGED;
    }

    case "lockBet": {
      const gate = bettingGate(state, action.round, action.dealId, ctx);
      if (gate) return gate;
      const round = state.round!;
      const existing = round.bets[me!.id];
      if (round.locked.includes(me!.id)) {
        // Idempotent: a duplicate of the same lock is acknowledged without change.
        return existing && existing.choice === action.choice && existing.wager === action.wager
          ? OK_UNCHANGED
          : fail("already_locked", "Your bet is already locked in");
      }
      const wagerError = validateWager(action.wager, me!.chips);
      if (wagerError) return fail("invalid_wager", wagerError);
      round.bets[me!.id] = { choice: action.choice, wager: action.wager, updatedAt: ctx.now };
      round.locked.push(me!.id);
      return OK_CHANGED;
    }

    case "configure": {
      if (state.phase !== "lobby") return fail("wrong_phase", "Settings can only be changed in the lobby");
      const next = mergeConfig(state.config, action.config);
      const err = validateConfig(next);
      if (err) return fail("invalid", err);
      if (JSON.stringify(next) === JSON.stringify(state.config)) return OK_UNCHANGED;
      state.config = next;
      return OK_CHANGED;
    }

    case "start": {
      if (state.phase !== "lobby") return fail("wrong_phase", "The game has already started");
      const blockers = startBlockers(state, ctx.questions);
      if (blockers.length) {
        return fail(connectedCount(state) < LIMITS.minPlayers ? "not_enough_players" : "invalid", blockers[0]!);
      }
      beginGame(state, ctx);
      return OK_CHANGED;
    }

    case "pause": {
      if (state.phase === "lobby" || state.phase === "gameOver") return fail("wrong_phase", "Nothing to pause");
      if (state.paused) return OK_UNCHANGED;
      state.paused = true;
      if (state.timer && state.timer.deadline !== null) {
        state.timer.pausedRemainingMs = Math.max(0, state.timer.deadline - ctx.now);
        state.timer.deadline = null;
      }
      return OK_CHANGED;
    }

    case "resume": {
      if (!state.paused) return OK_UNCHANGED;
      state.paused = false;
      if (state.timer && state.timer.deadline === null) {
        state.timer.deadline = ctx.now + (state.timer.pausedRemainingMs ?? 0);
        state.timer.pausedRemainingMs = null;
      }
      return OK_CHANGED;
    }

    case "advance": {
      const { from } = action;
      const round = state.round;
      if (from.phase !== state.phase || from.round !== (round?.number ?? 0)) {
        return fail("stale", "The game has already moved on");
      }
      if (round && from.dealId !== undefined && from.dealId !== round.dealId) {
        return fail("stale", "The game has already moved on");
      }
      switch (state.phase) {
        case "betting":
          closeBetting(state);
          return OK_CHANGED;
        case "wagerReveal":
          revealAnswer(state);
          return OK_CHANGED;
        case "answerReveal":
          state.phase = "scoreboard";
          return OK_CHANGED;
        case "scoreboard":
          if (round!.number >= state.config.rounds) endGame(state);
          else dealRound(state, round!.number + 1, ctx);
          return OK_CHANGED;
        default:
          return fail("wrong_phase", "Nothing to advance");
      }
    }

    case "skipQuestion": {
      if (state.phase !== "betting" && state.phase !== "wagerReveal") {
        return fail("wrong_phase", "Questions can only be skipped before the answer is revealed");
      }
      const round = state.round!;
      if (round.number !== action.round || round.dealId !== action.dealId) {
        return fail("stale", "That question was already skipped");
      }
      // Discard every bet; balances are untouched. Same round number, new question.
      dealRound(state, round.number, ctx);
      return OK_CHANGED;
    }

    case "kick": {
      if (state.phase !== "lobby") return fail("wrong_phase", "Players can only be removed in the lobby");
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0) return fail("invalid", "No such player");
      state.players.splice(idx, 1);
      return { ok: true, changed: true, kickedPlayerId: action.playerId };
    }

    case "endGame": {
      if (state.phase === "lobby" || state.phase === "gameOver") return fail("wrong_phase", "No game in progress");
      // An unsettled round is discarded; chips already won or lost stand.
      if (state.phase === "betting" || state.phase === "wagerReveal") state.round = null;
      endGame(state);
      return OK_CHANGED;
    }

    case "rematch": {
      if (state.phase !== "gameOver") return fail("wrong_phase", "Rematches start from the final results");
      if (!action.toLobby && connectedCount(state) < LIMITS.minPlayers) {
        return fail("not_enough_players", `Need at least ${LIMITS.minPlayers} connected players`);
      }
      resetForRematch(state);
      if (action.toLobby) state.phase = "lobby";
      else beginGame(state, ctx);
      return OK_CHANGED;
    }
  }
}

function mergeConfig(current: GameConfig, patch: ConfigPatch): GameConfig {
  return {
    rounds: patch.rounds ?? current.rounds,
    bettingSeconds: patch.bettingSeconds ?? current.bettingSeconds,
    categories: patch.categories ? CATEGORIES.filter((c) => patch.categories!.includes(c)) : [...current.categories],
  } satisfies GameConfig;
}

function beginGame(state: GameState, ctx: EngineContext) {
  for (const p of state.players) p.chips = CHIPS.starting;
  state.history = [];
  state.usedQuestionIds = [];
  state.paused = false;
  buildQuestionQueue(state, ctx);
  dealRound(state, 1, ctx);
}

function resetForRematch(state: GameState) {
  state.previousGameQuestionIds = [...new Set([...state.previousGameQuestionIds, ...state.usedQuestionIds])];
  state.usedQuestionIds = [];
  state.questionQueue = [];
  state.history = [];
  state.round = null;
  state.timer = null;
  state.paused = false;
  state.gameNumber += 1;
  for (const p of state.players) p.chips = CHIPS.starting;
}

export type { Category };
