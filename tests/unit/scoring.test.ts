import { describe, expect, it } from "vitest";
import { CHIPS } from "../../shared/constants";
import {
  availableChips,
  buildStandings,
  finalAwards,
  gameStats,
  isAllIn,
  isBigBet,
  quickWager,
  rankByChips,
  roundHighlights,
  settleBet,
  snapWager,
  validateWager,
} from "../../shared/engine/scoring";
import type { RoundHistoryEntry } from "../../shared/engine/state";

describe("wager validation", () => {
  it("allows 0 up to balance + the 250 round allowance", () => {
    expect(availableChips(1000)).toBe(1250);
    expect(validateWager(0, 1000)).toBeNull();
    expect(validateWager(1250, 1000)).toBeNull();
    expect(validateWager(1300, 1000)).toMatch(/at most 1,250/);
  });

  it("requires multiples of 50 and whole, non-negative numbers", () => {
    expect(validateWager(50, 1000)).toBeNull();
    expect(validateWager(75, 1000)).toMatch(/multiple of 50/);
    expect(validateWager(-50, 1000)).toMatch(/whole number/);
    expect(validateWager(50.5, 1000)).toMatch(/whole number/);
    expect(validateWager(Number.NaN, 1000)).not.toBeNull();
  });

  it("lets a broke player wager the next round's allowance", () => {
    expect(availableChips(0)).toBe(CHIPS.roundAllowance);
    expect(validateWager(250, 0)).toBeNull();
    expect(validateWager(300, 0)).not.toBeNull();
  });

  it("computes quick-select amounts rounded down to a valid step", () => {
    expect(quickWager(1250, 0.25)).toBe(300); // 312.5 → 300
    expect(quickWager(1250, 0.5)).toBe(600); // 625 → 600
    expect(quickWager(1250, 1)).toBe(1250);
    expect(quickWager(250, 0.25)).toBe(50); // 62.5 → 50
    expect(snapWager(99999, 400)).toBe(400);
    expect(snapWager(-10, 400)).toBe(0);
  });

  it("flags all-in and big bets", () => {
    expect(isAllIn(1250, 1250)).toBe(true);
    expect(isAllIn(0, 0)).toBe(false);
    expect(isBigBet(650, 1250)).toBe(true);
    expect(isBigBet(600, 1250)).toBe(false);
    expect(isBigBet(0, 1250)).toBe(false);
  });
});

describe("settling bets", () => {
  it("matches the worked example from the rules (1,000 balance, 500 wager)", () => {
    expect(settleBet(1000, { choice: 2, wager: 500 }, 2).after).toBe(1750);
    expect(settleBet(1000, { choice: 1, wager: 500 }, 2).after).toBe(750);
    expect(settleBet(1000, { choice: 2, wager: 0 }, 2).after).toBe(1250);
    expect(settleBet(1000, null, 2).after).toBe(1250);
  });

  it("reports outcome, deltas and allowance", () => {
    const won = settleBet(1000, { choice: 0, wager: 300 }, 0);
    expect(won).toMatchObject({ outcome: "won", correct: true, wagerDelta: 300, allowance: 250, before: 1000, after: 1550 });
    const lost = settleBet(1000, { choice: 3, wager: 300 }, 0);
    expect(lost).toMatchObject({ outcome: "lost", correct: false, wagerDelta: -300, after: 950 });
  });

  it("zero wagers produce no wager gain or loss", () => {
    expect(settleBet(800, { choice: 0, wager: 0 }, 0)).toMatchObject({ wagerDelta: 0, after: 1050, outcome: "won" });
    expect(settleBet(800, { choice: 1, wager: 0 }, 0)).toMatchObject({ wagerDelta: 0, after: 1050, outcome: "lost" });
  });

  it("abstaining (no answer) still earns the allowance and ignores any wager", () => {
    expect(settleBet(500, { choice: null, wager: 400 }, 1)).toMatchObject({ outcome: "abstained", wager: 0, wagerDelta: 0, after: 750, correct: null });
  });

  it("all-in wins double up; all-in losses go to exactly zero, never negative", () => {
    const win = settleBet(1000, { choice: 1, wager: 1250 }, 1);
    expect(win).toMatchObject({ allIn: true, after: 2500 });
    const loss = settleBet(1000, { choice: 0, wager: 1250 }, 1);
    expect(loss).toMatchObject({ allIn: true, after: 0 });
    // Defensive clamp: an over-limit wager can never push a balance below zero.
    expect(settleBet(100, { choice: 0, wager: 99_999 }, 1).after).toBe(0);
  });

  it("broke players bet the allowance and can recover", () => {
    expect(settleBet(0, { choice: 2, wager: 250 }, 2)).toMatchObject({ allIn: true, after: 500 });
    expect(settleBet(0, { choice: 1, wager: 250 }, 2)).toMatchObject({ after: 0 });
    expect(settleBet(0, null, 2).after).toBe(250);
  });
});

describe("rankings", () => {
  it("uses competition ranking for ties", () => {
    const ranks = rankByChips([
      { id: "a", chips: 1500 },
      { id: "b", chips: 2000 },
      { id: "c", chips: 1500 },
      { id: "d", chips: 0 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, a: 2, c: 2, d: 4 });
  });

  it("builds standings sorted by rank then join order, with round deltas", () => {
    const roster = [
      { id: "a", name: "A", avatar: 0, chips: 1500, joinOrder: 0 },
      { id: "b", name: "B", avatar: 1, chips: 1500, joinOrder: 1 },
      { id: "c", name: "C", avatar: 2, chips: 2000, joinOrder: 2 },
    ];
    const results = { a: settleBet(1000, { choice: 0, wager: 250 }, 0), b: settleBet(1000, { choice: 0, wager: 250 }, 0), c: settleBet(1000, { choice: 0, wager: 750 }, 0) };
    const rows = buildStandings(roster, { a: 1, b: 1, c: 1 }, results);
    expect(rows.map((r) => [r.playerId, r.rank, r.previousRank, r.roundDelta])).toEqual([
      ["c", 1, 1, 1000],
      ["a", 2, 1, 500],
      ["b", 2, 1, 500],
    ]);
  });
});

describe("highlights and awards", () => {
  const r = (balance: number, choice: number | null, wager: number, correctIndex = 0) => settleBet(balance, { choice, wager }, correctIndex);

  it("celebrates all-in wins and calls out all-in losses", () => {
    const results = { a: r(1000, 0, 1250), b: r(1000, 1, 1250), c: r(1000, 0, 0) };
    const h = roundHighlights(results, { a: 1, b: 1, c: 1 }, rankByChips([{ id: "a", chips: 2500 }, { id: "b", chips: 0 }, { id: "c", chips: 1250 }]), 3);
    expect(h.find((x) => x.kind === "allInHero")?.playerIds).toEqual(["a"]);
    expect(h.find((x) => x.kind === "busted")?.playerIds).toEqual(["b"]);
  });

  it("hides highlights shared by everybody", () => {
    const results = { a: r(1000, 0, 500), b: r(1000, 0, 500) };
    const h = roundHighlights(results, { a: 1, b: 1 }, rankByChips([{ id: "a", chips: 1750 }, { id: "b", chips: 1750 }]), 2);
    expect(h).toEqual([]);
  });

  it("derives game statistics and awards from history", () => {
    const history: RoundHistoryEntry[] = [
      { number: 1, questionId: "q1", results: { a: r(1000, 1, 1250), b: r(1000, 0, 500), c: r(1000, null, 0) } },
      { number: 2, questionId: "q2", results: { a: r(0, 0, 250), b: r(1750, 0, 2000), c: r(1250, 1, 100) } },
    ];
    const stats = gameStats(["a", "b", "c"], history);
    expect(stats.find((s) => s.playerId === "a")).toMatchObject({ correct: 1, wrong: 1, allInLosses: 1, allInWins: 1, biggestLoss: 1250, peakChips: 1000 });
    expect(stats.find((s) => s.playerId === "b")).toMatchObject({ correct: 2, totalWagered: 2500, biggestWin: 2000, allInWins: 1, peakChips: 4000 });
    expect(stats.find((s) => s.playerId === "c")).toMatchObject({ abstained: 1, wrong: 1 });
    const awards = finalAwards(["a", "b", "c"], history, rankByChips([{ id: "a", chips: 500 }, { id: "b", chips: 4000 }, { id: "c", chips: 1400 }]));
    expect(awards.find((x) => x.id === "sharpshooter")?.playerIds).toEqual(["b"]);
    expect(awards.find((x) => x.id === "cautious")?.playerIds).toEqual(["c"]);
    expect(awards.find((x) => x.id === "daredevil")?.playerIds).toEqual(["a", "b"]);
  });
});
