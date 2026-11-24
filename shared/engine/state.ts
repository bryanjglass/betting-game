/**
 * Authoritative server-side game state. This object lives only inside the
 * Durable Object (and its storage). It is NEVER sent to clients directly —
 * see projection.ts for the per-role views that are.
 */
import type { Category, Phase } from "../constants";
import type { GameConfig } from "../views";

/** A question as stored in the bank (shared/data/questions.json). */
export interface Question {
  id: string;
  category: Category;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  source: string;
  fact?: string;
}

export interface ServerPlayer {
  id: string;
  /** Secret reconnect credential (only ever sent to this player, once, on join). */
  token: string;
  name: string;
  avatar: number;
  joinOrder: number;
  chips: number;
  connected: boolean;
  /** Epoch ms of last connect/disconnect — used for the presence grace period. */
  lastSeenAt: number;
}

export interface Bet {
  /** Displayed option index (after the server's shuffle), or null = no answer yet. */
  choice: number | null;
  wager: number;
  updatedAt: number;
}

export interface FinalBet {
  choice: number | null;
  wager: number;
  available: number;
}

export interface PlayerRoundResult {
  choice: number | null;
  wager: number;
  available: number;
  correct: boolean | null;
  outcome: "won" | "lost" | "abstained";
  wagerDelta: number;
  allowance: number;
  before: number;
  after: number;
  allIn: boolean;
  bigBet: boolean;
}

export interface ServerRound {
  number: number;
  /** Random id for this dealt question; bets must quote it. */
  dealId: string;
  questionId: string;
  category: Category;
  text: string;
  /** Options in the shuffled display order. */
  options: string[];
  /** SECRET until the answer reveal: index into `options`. */
  correctIndex: number;
  source: string;
  fact: string | null;
  /** playerId → draft or locked bet. SECRET until the reveal phases. */
  bets: Record<string, Bet>;
  locked: string[];
  /** Frozen exactly once when betting closes. */
  finalBets: Record<string, FinalBet> | null;
  /** Computed and applied exactly once, on entering the answer reveal. */
  results: Record<string, PlayerRoundResult> | null;
  /** Ranks before this round's chips were applied. */
  ranksBefore: Record<string, number> | null;
}

export interface RoundHistoryEntry {
  number: number;
  questionId: string;
  results: Record<string, PlayerRoundResult>;
}

export interface TimerState {
  /** Epoch ms deadline while running; null when paused. */
  deadline: number | null;
  /** Remaining ms captured when paused. */
  pausedRemainingMs: number | null;
  durationMs: number;
}

export interface GameState {
  schemaVersion: 1;
  code: string;
  hostToken: string;
  createdAt: number;
  lastActivity: number;
  /** Monotonic revision counter; bumps on every change. */
  version: number;
  gameNumber: number;
  config: GameConfig;
  phase: Phase;
  players: ServerPlayer[];
  nextJoinOrder: number;
  round: ServerRound | null;
  history: RoundHistoryEntry[];
  /** Remaining question ids for this game, in pre-shuffled order. */
  questionQueue: string[];
  /** Questions used (asked or skipped) in this game — never repeated. */
  usedQuestionIds: string[];
  /** Questions used in earlier games in this room (rematches avoid them when possible). */
  previousGameQuestionIds: string[];
  timer: TimerState | null;
  /** Host pause: timers are frozen (new phase timers start frozen too). */
  paused: boolean;
  /** Room is shut down; awaiting deletion. */
  closed: boolean;
}
