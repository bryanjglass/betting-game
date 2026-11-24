/**
 * Pure chip maths: wager validation, settling bets, rankings, highlights and
 * end-of-game awards. No I/O, no randomness, no React, no Cloudflare — so it
 * is trivially unit-testable and shared by server and client.
 */
import { CHIPS } from "../constants";
import type { Award, Highlight, PlayerStatsView, StandingRow } from "../views";
import type { PlayerRoundResult, RoundHistoryEntry } from "./state";

/** Chips a player may wager this round: their balance plus the round allowance. */
export function availableChips(balance: number): number {
  return Math.max(0, balance) + CHIPS.roundAllowance;
}

/** Returns an error message, or null if the wager is valid for this balance. */
export function validateWager(wager: number, balance: number): string | null {
  if (!Number.isInteger(wager) || wager < 0) return "Wagers must be a whole number of chips";
  if (wager % CHIPS.wagerStep !== 0) return `Wagers must be a multiple of ${CHIPS.wagerStep} chips`;
  const max = availableChips(balance);
  if (wager > max) return `You can wager at most ${max.toLocaleString("en-US")} chips`;
  return null;
}

/** Round a wager down to the nearest valid step, clamped to [0, available]. */
export function snapWager(wager: number, available: number): number {
  const clamped = Math.min(Math.max(0, wager), available);
  return Math.floor(clamped / CHIPS.wagerStep) * CHIPS.wagerStep;
}

/** Quick-select amounts (25%, 50%, All In), rounded down to a valid step. */
export function quickWager(available: number, fraction: number): number {
  if (fraction >= 1) return available;
  return snapWager(available * fraction, available);
}

export function isAllIn(wager: number, available: number): boolean {
  return wager > 0 && wager === available;
}

export function isBigBet(wager: number, available: number): boolean {
  return wager > 0 && wager >= available * CHIPS.bigBetFraction;
}

/**
 * Settle one player's bet for a completed round.
 *  - No answer → abstain: no win or loss, allowance still credited.
 *  - Correct → +wager; incorrect → −wager; zero wager → no change.
 *  - The allowance is credited exactly once and balances never go negative.
 */
export function settleBet(
  balance: number,
  bet: { choice: number | null; wager: number } | null,
  correctIndex: number,
): PlayerRoundResult {
  const available = availableChips(balance);
  const allowance = CHIPS.roundAllowance;
  const choice = bet?.choice ?? null;
  if (choice === null) {
    return {
      choice: null,
      wager: 0,
      available,
      correct: null,
      outcome: "abstained",
      wagerDelta: 0,
      allowance,
      before: balance,
      after: Math.max(0, balance + allowance),
      allIn: false,
      bigBet: false,
    };
  }
  // Defensive: the engine only stores validated wagers, but never let a bad
  // value push a balance below zero.
  const wager = snapWager(bet!.wager, available);
  const correct = choice === correctIndex;
  const wagerDelta = correct || wager === 0 ? wager : -wager;
  return {
    choice,
    wager,
    available,
    correct,
    outcome: correct ? "won" : "lost",
    wagerDelta,
    allowance,
    before: balance,
    after: Math.max(0, balance + allowance + wagerDelta),
    allIn: isAllIn(wager, available),
    bigBet: isBigBet(wager, available),
  };
}

/** Competition ranking ("1, 1, 3"): tied balances share a rank. */
export function rankByChips<T extends { id: string; chips: number }>(players: readonly T[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const p of players) ranks.set(p.id, 1 + players.filter((o) => o.chips > p.chips).length);
  return ranks;
}

export interface RosterEntry {
  id: string;
  name: string;
  avatar: number;
  chips: number;
  joinOrder: number;
}

/** Standings sorted by rank, then join order. */
export function buildStandings(
  roster: readonly RosterEntry[],
  ranksBefore: Record<string, number> | null,
  roundResults: Record<string, PlayerRoundResult> | null,
): StandingRow[] {
  const ranks = rankByChips(roster);
  return [...roster]
    .sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)! || a.joinOrder - b.joinOrder)
    .map((p) => {
      const r = roundResults?.[p.id];
      return {
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        chips: p.chips,
        rank: ranks.get(p.id)!,
        previousRank: ranksBefore?.[p.id] ?? null,
        roundDelta: r ? r.after - r.before : 0,
      };
    });
}

const maxBy = (entries: [string, number][]): { ids: string[]; value: number } => {
  let value = -Infinity;
  let ids: string[] = [];
  for (const [id, v] of entries) {
    if (v > value) {
      value = v;
      ids = [id];
    } else if (v === value) ids.push(id);
  }
  return { ids, value };
};

const chips = (n: number) => n.toLocaleString("en-US");

/** Fun call-outs for the scoreboard after one round. */
export function roundHighlights(
  results: Record<string, PlayerRoundResult>,
  ranksBefore: Record<string, number> | null,
  ranksAfter: Map<string, number>,
  playerCount: number,
): Highlight[] {
  const out: Highlight[] = [];
  const entries = Object.entries(results);
  const push = (h: Highlight) => {
    // A "highlight" shared by everybody isn't one.
    if (h.playerIds.length > 0 && (playerCount < 2 || h.playerIds.length < playerCount)) out.push(h);
  };

  const heroes = entries.filter(([, r]) => r.allIn && r.outcome === "won").map(([id]) => id);
  if (heroes.length) {
    push({ kind: "allInHero", emoji: "🔥", title: "All-In Hero", description: "Bet everything — and doubled up!", playerIds: heroes });
  }
  const busted = entries.filter(([, r]) => r.allIn && r.outcome === "lost").map(([id]) => id);
  if (busted.length) {
    push({ kind: "busted", emoji: "💥", title: "Busted!", description: "Went all in… and lost it all.", playerIds: busted });
  }
  const roller = maxBy(entries.map(([id, r]) => [id, r.wager]));
  if (roller.value > 0 && !heroes.length && !busted.length) {
    push({ kind: "highRoller", emoji: "🎰", title: "High Roller", description: `Biggest bet: ${chips(roller.value)} chips`, playerIds: roller.ids });
  }
  const winner = maxBy(entries.map(([id, r]) => [id, r.wagerDelta]));
  if (winner.value > 0 && !winner.ids.every((id) => heroes.includes(id))) {
    push({ kind: "bigWinner", emoji: "💰", title: "Big Winner", description: `Won ${chips(winner.value)} chips`, playerIds: winner.ids });
  }
  const loser = maxBy(entries.map(([id, r]) => [id, -r.wagerDelta]));
  if (loser.value > 0 && !loser.ids.every((id) => busted.includes(id))) {
    push({ kind: "ouch", emoji: "😬", title: "Ouch!", description: `Lost ${chips(loser.value)} chips`, playerIds: loser.ids });
  }
  if (ranksBefore) {
    const climb = maxBy(entries.map(([id]) => [id, (ranksBefore[id] ?? 0) - (ranksAfter.get(id) ?? 0)]));
    if (climb.value >= 2) {
      push({ kind: "climber", emoji: "🚀", title: "Rocket", description: `Climbed ${climb.value} places`, playerIds: climb.ids });
    }
  }
  return out;
}

/** Per-player statistics for the whole game, derived purely from round history. */
export function gameStats(playerIds: readonly string[], history: readonly RoundHistoryEntry[]): PlayerStatsView[] {
  return playerIds.map((playerId) => {
    const s: PlayerStatsView = {
      playerId,
      correct: 0,
      wrong: 0,
      abstained: 0,
      totalWagered: 0,
      biggestWin: 0,
      biggestLoss: 0,
      allInWins: 0,
      allInLosses: 0,
      peakChips: CHIPS.starting,
    };
    for (const h of history) {
      const r = h.results[playerId];
      if (!r) continue;
      if (r.outcome === "won") s.correct += 1;
      else if (r.outcome === "lost") s.wrong += 1;
      else s.abstained += 1;
      s.totalWagered += r.wager;
      s.biggestWin = Math.max(s.biggestWin, r.wagerDelta);
      s.biggestLoss = Math.max(s.biggestLoss, -r.wagerDelta);
      if (r.allIn && r.outcome === "won") s.allInWins += 1;
      if (r.allIn && r.outcome === "lost") s.allInLosses += 1;
      s.peakChips = Math.max(s.peakChips, r.after);
    }
    return s;
  });
}

/** End-of-game awards. Winners are announced separately. */
export function finalAwards(
  playerIds: readonly string[],
  history: readonly RoundHistoryEntry[],
  finalRanks: Map<string, number>,
): Award[] {
  if (history.length === 0) return [];
  const stats = gameStats(playerIds, history);
  const awards: Award[] = [];
  const add = (a: Award) => {
    if (a.playerIds.length && (playerIds.length < 2 || a.playerIds.length < playerIds.length)) awards.push(a);
  };
  const best = (f: (s: PlayerStatsView) => number) => maxBy(stats.map((s) => [s.playerId, f(s)]));

  const sharp = best((s) => s.correct);
  if (sharp.value > 0) {
    add({ id: "sharpshooter", emoji: "🎯", title: "Sharpshooter", description: `${sharp.value} correct answer${sharp.value === 1 ? "" : "s"}`, playerIds: sharp.ids });
  }
  const roller = best((s) => s.totalWagered);
  if (roller.value > 0) {
    add({ id: "high-roller", emoji: "🎰", title: "High Roller", description: `${chips(roller.value)} chips wagered in total`, playerIds: roller.ids });
  }
  const dare = best((s) => s.allInWins);
  if (dare.value > 0) {
    add({ id: "daredevil", emoji: "🔥", title: "Daredevil", description: `Won ${dare.value} all-in bet${dare.value === 1 ? "" : "s"}`, playerIds: dare.ids });
  }
  const jackpot = best((s) => s.biggestWin);
  if (jackpot.value > 0) {
    add({ id: "jackpot", emoji: "💰", title: "Jackpot", description: `Biggest single win: ${chips(jackpot.value)} chips`, playerIds: jackpot.ids });
  }
  // Comeback: biggest gap between the worst rank held after any round and the final rank.
  const worst = new Map<string, number>();
  const balances = new Map<string, number>(playerIds.map((id) => [id, CHIPS.starting]));
  for (const h of history) {
    for (const id of playerIds) if (h.results[id]) balances.set(id, h.results[id]!.after);
    const ranks = rankByChips(playerIds.map((id) => ({ id, chips: balances.get(id)! })));
    for (const [id, r] of ranks) worst.set(id, Math.max(worst.get(id) ?? 1, r));
  }
  const comeback = maxBy(playerIds.map((id) => [id, (worst.get(id) ?? 1) - (finalRanks.get(id) ?? 1)]));
  if (comeback.value >= 2) {
    add({ id: "comeback", emoji: "🚀", title: "Comeback Kid", description: `Climbed ${comeback.value} places from their low point`, playerIds: comeback.ids });
  }
  const careful = best((s) => s.abstained + 0);
  if (careful.value > 0) {
    add({ id: "cautious", emoji: "🐢", title: "Cautious Turtle", description: `Sat out ${careful.value} question${careful.value === 1 ? "" : "s"}`, playerIds: careful.ids });
  }
  return awards;
}
