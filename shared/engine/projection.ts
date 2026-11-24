/**
 * Per-role client projections — the security boundary of the game.
 *
 * Rules enforced here (and asserted by tests/integration/room.test.ts):
 *  - The correct answer, fun fact and source are never included before the
 *    answer reveal, for any role (the host may also be playing).
 *  - Other players' answers and wagers are never included during betting —
 *    only who has locked in.
 *  - During the wager reveal, wagers are public but answer choices are not.
 *  - A player's own draft bet is sent only to that player.
 *  - Reconnect tokens and the host token are never included in any projection.
 */
import { CHIPS } from "../constants";
import type {
  AnswerRevealView,
  ClientView,
  FinalView,
  MyPrivateView,
  PlayerPublic,
  PlayerResultView,
  Role,
  RoundSummaryView,
  RoundView,
  WagerView,
} from "../views";
import { startBlockers } from "./engine";
import { availableChips, buildStandings, finalAwards, gameStats, isAllIn, isBigBet, rankByChips, roundHighlights } from "./scoring";
import type { GameState, PlayerRoundResult, Question, ServerPlayer } from "./state";

export interface ProjectionContext {
  now: number;
  hostConnected: boolean;
  tvConnections: number;
  questions: readonly Question[];
}

export interface Viewer {
  role: Role;
  playerId?: string | null;
}

const REVEALED_PHASES = new Set(["answerReveal", "scoreboard"]);
const WAGERS_PUBLIC_PHASES = new Set(["wagerReveal", "answerReveal", "scoreboard"]);

function byJoinOrder(state: GameState): ServerPlayer[] {
  return [...state.players].sort((a, b) => a.joinOrder - b.joinOrder);
}

function toResultView(playerId: string, r: PlayerRoundResult): PlayerResultView {
  return { playerId, ...r };
}

function projectRound(state: GameState): RoundView | null {
  const round = state.round;
  if (!round || state.phase === "lobby" || state.phase === "gameOver") return null;
  const roster = byJoinOrder(state);

  let wagers: WagerView[] | null = null;
  if (WAGERS_PUBLIC_PHASES.has(state.phase) && round.finalBets) {
    wagers = roster.map((p) => {
      const b = round.finalBets![p.id] ?? { choice: null, wager: 0, available: availableChips(p.chips) };
      // Deliberately omits `choice` — answers stay hidden until the answer reveal.
      return {
        playerId: p.id,
        wager: b.wager,
        available: b.available,
        abstained: b.choice === null,
        allIn: isAllIn(b.wager, b.available),
        bigBet: isBigBet(b.wager, b.available),
      };
    });
  }

  let reveal: AnswerRevealView | null = null;
  if (REVEALED_PHASES.has(state.phase) && round.results) {
    const results = roster.filter((p) => round.results![p.id]).map((p) => toResultView(p.id, round.results![p.id]!));
    reveal = {
      correctIndex: round.correctIndex,
      fact: round.fact,
      source: round.source,
      results,
      pickers: round.options.map((_, i) => results.filter((r) => r.choice === i).map((r) => r.playerId)),
    };
  }

  return {
    number: round.number,
    total: state.config.rounds,
    dealId: round.dealId,
    question: { id: round.questionId, category: round.category, text: round.text, options: [...round.options] },
    lockedIds: roster.filter((p) => round.locked.includes(p.id)).map((p) => p.id),
    wagers,
    reveal,
  };
}

function projectScoreboard(state: GameState): RoundSummaryView | null {
  const round = state.round;
  if (state.phase !== "scoreboard" || !round?.results) return null;
  const roster = byJoinOrder(state);
  return {
    number: round.number,
    standings: buildStandings(roster, round.ranksBefore, round.results),
    highlights: roundHighlights(round.results, round.ranksBefore, rankByChips(roster), roster.length),
  };
}

function projectFinal(state: GameState): FinalView | null {
  if (state.phase !== "gameOver") return null;
  const roster = byJoinOrder(state);
  const standings = buildStandings(roster, null, null);
  const ranks = rankByChips(roster);
  const ids = roster.map((p) => p.id);
  return {
    standings,
    winnerIds: standings.filter((s) => s.rank === 1).map((s) => s.playerId),
    awards: finalAwards(ids, state.history, ranks),
    stats: gameStats(ids, state.history),
    roundsPlayed: state.history.length,
  };
}

function projectMe(state: GameState, playerId: string): MyPrivateView | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;
  const round = state.round;
  const inRound = !!round && state.phase !== "lobby" && state.phase !== "gameOver";
  const bet = inRound ? round.bets[me.id] : undefined;
  const result = inRound && REVEALED_PHASES.has(state.phase) ? round.results?.[me.id] : undefined;
  return {
    id: me.id,
    name: me.name,
    avatar: me.avatar,
    chips: me.chips,
    available: state.phase === "betting" || state.phase === "wagerReveal" ? availableChips(me.chips) : me.chips + CHIPS.roundAllowance,
    bet: bet ? { choice: bet.choice, wager: bet.wager } : null,
    locked: inRound ? round.locked.includes(me.id) : false,
    result: result ? toResultView(me.id, result) : null,
  };
}

export function projectView(state: GameState, viewer: Viewer, ctx: ProjectionContext): ClientView {
  const roster = byJoinOrder(state);
  const ranks = rankByChips(roster);
  const players: PlayerPublic[] = roster.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    connected: p.connected,
    chips: p.chips,
    rank: ranks.get(p.id) ?? 1,
  }));

  const timer = state.timer
    ? {
        deadline: state.timer.deadline,
        remainingMs: state.timer.deadline === null ? (state.timer.pausedRemainingMs ?? 0) : Math.max(0, state.timer.deadline - ctx.now),
        durationMs: state.timer.durationMs,
        paused: state.timer.deadline === null,
      }
    : null;

  const blockers = viewer.role === "host" && state.phase === "lobby" ? startBlockers(state, ctx.questions) : [];

  return {
    role: viewer.role,
    roomCode: state.code,
    version: state.version,
    serverNow: ctx.now,
    gameNumber: state.gameNumber,
    phase: state.phase,
    paused: state.paused,
    config: { ...state.config, categories: [...state.config.categories] },
    players,
    hostConnected: ctx.hostConnected,
    round: projectRound(state),
    timer,
    scoreboard: projectScoreboard(state),
    final: projectFinal(state),
    me: viewer.role === "player" && viewer.playerId ? projectMe(state, viewer.playerId) : null,
    host:
      viewer.role === "host"
        ? { canStart: state.phase === "lobby" && blockers.length === 0, startBlockers: blockers, tvConnections: ctx.tvConnections }
        : null,
  };
}
