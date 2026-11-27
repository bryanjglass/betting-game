/**
 * Game-wide constants shared by the server (Durable Object) and all clients.
 */

/**
 * Lobby → Betting (question shown, private bets) → Wager Reveal → Answer Reveal
 * → Scoreboard → (next question | Game Over).
 */
export const PHASES = ["lobby", "betting", "wagerReveal", "answerReveal", "scoreboard", "gameOver"] as const;
export type Phase = (typeof PHASES)[number];

export const CATEGORIES = ["science", "sports", "entertainment", "geography", "history", "weird", "general"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  science: "Science & Nature",
  sports: "Sports",
  entertainment: "Movies & Entertainment",
  geography: "Geography",
  history: "History",
  weird: "Weird Facts",
  general: "General Knowledge",
};

export const CATEGORY_EMOJI: Record<Category, string> = {
  science: "🔬",
  sports: "🏅",
  entertainment: "🎬",
  geography: "🌍",
  history: "🏛️",
  weird: "🦄",
  general: "💡",
};

export const ROUND_OPTIONS = [5, 10, 15, 20] as const;
export const TIMER_OPTIONS = [15, 30, 45, 60] as const;

/** Chip economy. All wagers use virtual chips only — there is no real money anywhere. */
export const CHIPS = {
  starting: 1000,
  /** Added once per completed round, and available for wagering during that round. */
  roundAllowance: 250,
  /** Wagers must be a multiple of this. */
  wagerStep: 50,
  /** A wager of at least this share of a player's available chips is a "big bet". */
  bigBetFraction: 0.5,
} as const;

/**
 * How long each post-betting phase stays on screen before the server moves
 * on by itself. Together with the betting timer, this makes every in-game
 * phase timed, so a game plays from Start to the final results hands-free.
 */
export const PHASE_TIMING = {
  /** Wager reveal: a base, plus time for each player's stack to drop in (the TV staggers them). */
  wagerRevealBaseMs: 4500,
  wagerRevealPerPlayerMs: 700,
  /** Answer reveal: the drum-roll, results, balance count-up and the fun fact. */
  answerRevealMs: 10_000,
  /** Leaderboard before the next question (or the final results). */
  scoreboardMs: 10_000,
} as const;

export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 10,
  minNameLength: 1,
  maxNameLength: 14,
  avatarCount: 16,
  optionCount: 4,
  /**
   * A player who drops off for less than this long still counts as present
   * when deciding whether "everyone" has locked in, so a phone that briefly
   * sleeps doesn't get skipped. After that they no longer block the round.
   */
  presenceGraceMs: 15_000,
  /** Rooms with no connections and no activity for this long are deleted. */
  roomTtlMs: 12 * 60 * 60 * 1000,
} as const;

export const DEFAULT_CONFIG = {
  rounds: 10,
  bettingSeconds: 30,
  categories: [...CATEGORIES] as Category[],
};

/** Room codes use consonants only (no vowels → no accidental words, no I/O/0/1 confusion). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}
