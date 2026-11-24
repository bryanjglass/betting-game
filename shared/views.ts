/**
 * Client-facing state projections.
 *
 * These are the ONLY shapes the server ever sends to browsers. Each role gets
 * a projection built specifically for it (see engine/projection.ts). Secret
 * data — the correct answer, the fun fact and source, other players' answers
 * and wagers — is never placed in these objects before the phase in which it
 * becomes public.
 */
import type { Category, Phase } from "./constants";

export type Role = "host" | "tv" | "player" | "guest";

export interface GameConfig {
  rounds: number;
  bettingSeconds: number;
  categories: Category[];
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
  /** Current chip balance (changes only when a round's answer is revealed). */
  chips: number;
  rank: number;
}

export interface TimerView {
  /** Server epoch ms when the phase ends; null while paused. */
  deadline: number | null;
  /** Remaining ms as of `serverNow`. */
  remainingMs: number;
  durationMs: number;
  paused: boolean;
}

/** A question as shown to players: options already shuffled by the server, no answer. */
export interface QuestionView {
  id: string;
  category: Category;
  text: string;
  options: string[];
}

/** One player's wager. Public from the Wager Reveal onward (their answer is not). */
export interface WagerView {
  playerId: string;
  wager: number;
  /** Chips the player could have wagered (balance + round allowance). */
  available: number;
  /** No answer was submitted — the player sits this question out. */
  abstained: boolean;
  allIn: boolean;
  bigBet: boolean;
}

export type BetOutcome = "won" | "lost" | "abstained";

export interface PlayerResultView {
  playerId: string;
  choice: number | null;
  wager: number;
  available: number;
  correct: boolean | null;
  outcome: BetOutcome;
  /** Chips won (+) or lost (−) from the wager alone. */
  wagerDelta: number;
  /** Round allowance credited (250 for every completed round). */
  allowance: number;
  before: number;
  after: number;
  allIn: boolean;
  bigBet: boolean;
}

/** Public from the Answer Reveal onward. */
export interface AnswerRevealView {
  correctIndex: number;
  fact: string | null;
  source: string;
  /** In join order. */
  results: PlayerResultView[];
  /** Player ids per option index (who picked what). */
  pickers: string[][];
}

export interface RoundView {
  number: number;
  total: number;
  /** Identifies this particular dealt question (changes when the host skips). */
  dealId: string;
  question: QuestionView;
  /** Players who have locked their bet (identity only, never content). */
  lockedIds: string[];
  /** Null until the Wager Reveal. */
  wagers: WagerView[] | null;
  /** Null until the Answer Reveal. */
  reveal: AnswerRevealView | null;
}

export interface StandingRow {
  playerId: string;
  name: string;
  avatar: number;
  chips: number;
  rank: number;
  previousRank: number | null;
  /** Net change this round including the allowance. */
  roundDelta: number;
}

export type HighlightKind = "highRoller" | "bigWinner" | "ouch" | "climber" | "allInHero" | "busted";

export interface Highlight {
  kind: HighlightKind;
  emoji: string;
  title: string;
  description: string;
  playerIds: string[];
}

export interface RoundSummaryView {
  number: number;
  standings: StandingRow[];
  highlights: Highlight[];
}

export interface Award {
  id: string;
  emoji: string;
  title: string;
  description: string;
  playerIds: string[];
}

export interface PlayerStatsView {
  playerId: string;
  correct: number;
  wrong: number;
  abstained: number;
  totalWagered: number;
  biggestWin: number;
  biggestLoss: number;
  allInWins: number;
  allInLosses: number;
  peakChips: number;
}

export interface FinalView {
  standings: StandingRow[];
  winnerIds: string[];
  awards: Award[];
  stats: PlayerStatsView[];
  roundsPlayed: number;
}

export interface MyBetView {
  choice: number | null;
  wager: number;
}

export interface MyPrivateView {
  id: string;
  name: string;
  avatar: number;
  chips: number;
  /** Chips I may wager this round: balance + round allowance (betting phases only). */
  available: number;
  /** My own bet for the current question (only ever sent to me). */
  bet: MyBetView | null;
  locked: boolean;
  /** My result, once the answer is revealed. */
  result: PlayerResultView | null;
}

export interface HostExtras {
  canStart: boolean;
  startBlockers: string[];
  tvConnections: number;
}

export interface ClientView {
  role: Role;
  roomCode: string;
  version: number;
  serverNow: number;
  gameNumber: number;
  phase: Phase;
  paused: boolean;
  config: GameConfig;
  players: PlayerPublic[];
  hostConnected: boolean;
  round: RoundView | null;
  timer: TimerView | null;
  scoreboard: RoundSummaryView | null;
  final: FinalView | null;
  me: MyPrivateView | null;
  host: HostExtras | null;
}
