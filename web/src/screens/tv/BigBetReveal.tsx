/**
 * The Big Bet Reveal — the TV's signature moment.
 *
 *  1. Wager reveal: each player's avatar and wager, revealed smallest to
 *     largest so the biggest bet lands last. Wagers drop in as chip stacks;
 *     big bets and all-ins get extra drama. Answers stay hidden.
 *  2. Answer reveal: a drum-roll, then the correct answer lights up, every
 *     player's pick appears, winning stacks double while losing stacks fade,
 *     and balances count to their new values.
 *
 * Animations are presentation only: all numbers come from the server, the
 * final values are in the DOM immediately (data-* attributes), and nothing
 * waits on an animation to finish. Reduced-motion users get the end state.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { CATEGORY_EMOJI, CATEGORY_LABELS } from "../../../../shared/constants";
import type { ClientView, PlayerPublic, PlayerResultView, WagerView } from "../../../../shared/views";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { Avatar } from "../../components/Avatar";
import { ChipStack, PokerChip } from "../../components/Chips";
import { optionStyle } from "../../components/options";
import { formatChips, signedChips } from "../../components/ui";
import { burstConfetti } from "../../lib/effects";
import { sfx } from "../../lib/sound";

const STAGGER = 0.7; // seconds between player cards in the wager reveal
const DRUMROLL = 1.4; // seconds of suspense before the correct answer lights up

/** Max width for a wrapping row so 6–10 cards split evenly into two rows (e.g. 3+3, 5+5). */
function rowWidth(count: number, cardWidth: number, gap: number): number {
  const perRow = count > 5 ? Math.ceil(count / 2) : count;
  return perRow * cardWidth + (perRow - 1) * gap + 1;
}

/** Order for the reveal: sitting out first, then smallest wager to biggest. */
function revealOrder(wagers: WagerView[]): WagerView[] {
  return [...wagers].sort((a, b) => Number(!a.abstained) - Number(!b.abstained) || a.wager - b.wager);
}

function Ribbon({ kind }: { kind: "allIn" | "big" }) {
  return kind === "allIn" ? (
    <span className="absolute -top-9 left-1/2 z-20 -translate-x-1/2 -rotate-3 whitespace-nowrap rounded-xl border-4 border-ink-900 bg-chip-red px-5 py-0.5 font-display text-2xl font-bold uppercase tracking-wider text-white shadow-pop motion-safe:animate-marquee">
      🔥 All In! 🔥
    </span>
  ) : (
    <span className="absolute -top-9 left-1/2 z-20 -translate-x-1/2 rotate-2 whitespace-nowrap rounded-xl border-4 border-ink-900 bg-gold px-4 py-0.5 font-display text-2xl font-bold uppercase tracking-wider text-ink shadow-pop">
      💰 Big Bet!
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1. Wager reveal
// ---------------------------------------------------------------------------

export function WagerRevealScene({ view }: { view: ClientView }) {
  const reduce = useReducedMotion();
  const round = view.round!;
  const ordered = revealOrder(round.wagers!);
  const twoRows = ordered.length > 5;
  const players = new Map(view.players.map((p) => [p.id, p]));

  useEffect(() => {
    if (reduce) return;
    const timers = ordered.map((w, i) =>
      window.setTimeout(() => (w.wager > 0 ? sfx.chips(Math.ceil(w.wager / 200)) : undefined), (0.5 + i * STAGGER) * 1000),
    );
    return () => timers.forEach(clearTimeout);
  }, [round.dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`flex h-full flex-col items-center px-16 ${twoRows ? "pt-24" : "pt-32"}`} data-testid="tv-wager-reveal">
      <motion.h1
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 14 }}
        className={`text-foil font-display font-bold uppercase tracking-wide drop-shadow-[0_6px_0_rgba(0,0,0,0.5)] ${twoRows ? "text-7xl" : "text-8xl"}`}
      >
        The Big Bet Reveal
      </motion.h1>
      <p className="mt-2 max-w-[1500px] truncate text-center font-display text-3xl text-cream/70">
        {CATEGORY_EMOJI[round.question.category]} {round.question.text}
      </p>
      <div
        className={`flex flex-wrap justify-center ${twoRows ? "mt-10 gap-x-6 gap-y-10" : "mt-12 gap-8"}`}
        style={{ maxWidth: rowWidth(ordered.length, 320, twoRows ? 24 : 32) }}
      >
        {ordered.map((w, i) => (
          <WagerCard key={w.playerId} wager={w} player={players.get(w.playerId)} index={i} compact={twoRows} />
        ))}
      </div>
      <p className={`absolute font-display text-3xl text-cream/60 ${twoRows ? "bottom-4" : "bottom-10"}`}>Answers are still secret… who's right? 🤔</p>
    </div>
  );
}

function WagerCard({ wager, player, index, compact }: { wager: WagerView; player?: PlayerPublic; index: number; compact: boolean }) {
  const delay = 0.4 + index * STAGGER;
  const emphasis = wager.allIn ? "allIn" : wager.bigBet ? "big" : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 60, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: emphasis ? 1.06 : 1 }}
      transition={{ delay, type: "spring", stiffness: 220, damping: 16 }}
      className={`relative flex w-[320px] flex-col items-center rounded-[2rem] border-4 px-4 ${compact ? "pb-2 pt-5" : "pb-4 pt-6"} ${
        wager.allIn ? "border-chip-red bg-chip-red/20 shadow-glow-red" : wager.bigBet ? "border-gold bg-gold/15 shadow-glow" : "border-white/10 bg-ink-800/90"
      }`}
      data-testid="tv-wager"
      data-name={player?.name}
      data-wager={wager.wager}
      data-all-in={wager.allIn}
      data-big-bet={wager.bigBet}
    >
      {emphasis && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: delay + 0.5, type: "spring", stiffness: 400, damping: 10 }}>
          <Ribbon kind={emphasis} />
        </motion.div>
      )}
      <div className="flex items-center gap-3">
        <Avatar index={player?.avatar ?? 0} size={compact ? 56 : 110} />
        <p className={`max-w-[190px] truncate font-display ${compact ? "text-3xl" : "text-4xl"}`}>{player?.name}</p>
      </div>
      <div className={`bg-felt flex w-full items-end justify-center overflow-hidden rounded-2xl p-2 ${compact ? "mt-2 h-[112px]" : "mt-3 h-[230px]"}`}>
        {wager.abstained || wager.wager === 0 ? (
          <p className="self-center font-display text-3xl text-cream/70">{wager.abstained ? "Sat out" : "No chips"}</p>
        ) : (
          <ChipStack amount={wager.wager} chipWidth={compact ? 40 : 58} perColumn={compact ? 8 : 12} maxChips={compact ? 32 : 36} delay={delay + 0.2} />
        )}
      </div>
      <p className={`font-display font-bold leading-none ${wager.allIn ? "text-chip-red" : "text-gold"} ${compact ? "mt-2 text-5xl" : "mt-3 text-6xl"}`}>
        {wager.abstained ? "—" : <AnimatedNumber value={wager.wager} from={0} delay={delay + 0.2} duration={0.9} />}
      </p>
      <p className={`text-cream/60 ${compact ? "text-lg" : "mt-1 text-xl"}`}>{wager.abstained ? "no answer" : `of ${formatChips(wager.available)} available`}</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// 2. Answer reveal
// ---------------------------------------------------------------------------

export function AnswerRevealScene({ view }: { view: ClientView }) {
  const reduce = useReducedMotion();
  const round = view.round!;
  const reveal = round.reveal!;
  const players = new Map(view.players.map((p) => [p.id, p]));
  const twoRows = reveal.results.length > 5;
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (fired.current === round.dealId) return;
    fired.current = round.dealId;
    if (reduce) return;
    sfx.drumroll();
    const t1 = window.setTimeout(() => sfx.reveal(), DRUMROLL * 1000);
    const t2 = window.setTimeout(() => {
      const results = reveal.results;
      if (results.some((r) => r.allIn && r.outcome === "won")) burstConfetti("big");
      else if (results.some((r) => r.outcome === "won" && r.wager > 0)) burstConfetti("small");
      if (results.some((r) => r.outcome === "won")) sfx.win();
      else if (results.some((r) => r.outcome === "lost")) sfx.lose();
    }, (DRUMROLL + 0.9) * 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [round.dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col px-14 pt-28" data-testid="tv-answer-reveal">
      <p className="text-center font-display text-4xl leading-tight text-balance" data-testid="tv-question-text">
        {round.question.text}
      </p>
      <div className="mt-5 grid grid-cols-4 gap-5">
        {round.question.options.map((opt, i) => {
          const s = optionStyle(i);
          const isCorrect = reveal.correctIndex === i;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 1, scale: 1 }}
              animate={isCorrect ? { scale: [1, 1, 1.07], opacity: 1 } : { opacity: [1, 1, 0.35], scale: [1, 1, 0.96] }}
              transition={{ duration: DRUMROLL + 0.5, times: [0, DRUMROLL / (DRUMROLL + 0.5), 1] }}
              className={`relative flex min-h-[150px] flex-col rounded-3xl border-4 p-4 ${isCorrect ? "border-pop-green bg-cream text-ink shadow-glow-green" : "border-white/10 bg-ink-800 text-cream"}`}
              data-testid={isCorrect ? "tv-correct-option" : "tv-option"}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${s.bg} font-display text-3xl font-bold text-ink`}>{s.letter}</span>
                <span className="font-display text-3xl leading-tight">{opt}</span>
                {isCorrect && (
                  <motion.span
                    className="ml-auto text-5xl"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: DRUMROLL, type: "spring", stiffness: 300, damping: 12 }}
                  >
                    ✅
                  </motion.span>
                )}
              </div>
              <div className="mt-auto flex flex-wrap gap-1 pt-2">
                {reveal.pickers[i]!.map((pid, k) => (
                  <motion.span
                    key={pid}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: DRUMROLL + 0.3 + k * 0.08, type: "spring" }}
                  >
                    <Avatar index={players.get(pid)?.avatar ?? 0} size={44} title={players.get(pid)?.name} />
                  </motion.span>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
      <div
        className={`mx-auto mt-6 flex flex-wrap justify-center ${twoRows ? "gap-x-5 gap-y-4" : "gap-6"}`}
        style={{ maxWidth: rowWidth(reveal.results.length, 330, twoRows ? 20 : 24) }}
      >
        {reveal.results.map((r) => (
          <ResultCard key={r.playerId} result={r} player={players.get(r.playerId)} compact={twoRows} />
        ))}
      </div>
      {(reveal.fact || reveal.source) && (
        <p className="absolute inset-x-14 bottom-5 truncate text-center text-2xl text-cream/60" data-testid="tv-fact">
          {reveal.fact && <>💡 {reveal.fact} · </>}
          <span className="text-cream/40">Source: {reveal.source}</span>
        </p>
      )}
    </div>
  );
}

function ResultCard({ result: r, player, compact }: { result: PlayerResultView; player?: PlayerPublic; compact: boolean }) {
  const settle = DRUMROLL + 0.7;
  const won = r.outcome === "won";
  const lost = r.outcome === "lost";
  const busted = lost && r.allIn;
  const label =
    r.outcome === "abstained" ? "SAT OUT" : won ? (r.allIn ? "ALL-IN WIN!" : r.wager > 0 ? "WIN" : "RIGHT") : busted ? "BUSTED!" : r.wager > 0 ? "LOSE" : "WRONG";
  const pick = r.choice === null ? null : optionStyle(r.choice);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className={`relative flex w-[330px] flex-col rounded-[1.6rem] border-4 px-4 py-3 ${compact ? "h-[232px]" : "h-[330px]"} ${
        won ? "border-pop-green/80 bg-pop-green/10" : lost ? "border-pop-red/70 bg-pop-red/10" : "border-white/10 bg-ink-800/90"
      } ${busted ? "motion-safe:animate-shake" : ""}`}
      style={busted ? { animationDelay: `${settle}s` } : undefined}
      data-testid="tv-result"
      data-name={player?.name}
      data-outcome={r.outcome}
      data-delta={r.after - r.before}
      data-after={r.after}
    >
      <div className="flex items-center gap-3">
        <Avatar index={player?.avatar ?? 0} size={compact ? 56 : 76} />
        <span className="min-w-0 flex-1 truncate font-display text-3xl">{player?.name}</span>
        {pick && (
          <motion.span
            initial={{ rotateY: 90 }}
            animate={{ rotateY: 0 }}
            transition={{ delay: DRUMROLL + 0.2 }}
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${pick.bg} font-display text-3xl font-bold text-ink`}
            aria-label={`Picked ${pick.letter}`}
          >
            {pick.letter}
          </motion.span>
        )}
      </div>
      <div className="relative mt-1 flex flex-1 items-end justify-center gap-2">
        {r.wager > 0 && (
          <>
            <motion.div animate={lost ? { y: [0, 0, 24], opacity: [1, 1, 0.45], rotate: [0, 0, 8] } : {}} transition={{ duration: settle + 0.8, times: [0, settle / (settle + 0.8), 1] }}>
              <ChipStack amount={r.wager} chipWidth={compact ? 34 : 44} perColumn={compact ? 6 : 9} maxChips={compact ? 12 : 18} tone={lost ? "lose" : won ? "win" : "normal"} />
            </motion.div>
            {won && (
              <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: settle }}>
                <ChipStack amount={r.wager} chipWidth={compact ? 34 : 44} perColumn={compact ? 6 : 9} maxChips={compact ? 12 : 18} delay={settle} tone="win" />
              </motion.div>
            )}
          </>
        )}
        {busted && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <motion.span
                key={i}
                className="absolute left-1/2 top-1/2"
                initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
                animate={{ x: (i - 3.5) * 40, y: [0, -60, 160], opacity: [0, 1, 0], rotate: (i - 3.5) * 70 }}
                transition={{ delay: settle, duration: 1.3, ease: "easeOut" }}
              >
                <PokerChip color={i % 2 ? "red" : "black"} size={34} />
              </motion.span>
            ))}
          </div>
        )}
      </div>
      <motion.p
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: settle, type: "spring", stiffness: 320, damping: 12 }}
        className={`text-center font-display text-3xl font-bold ${won ? "text-pop-green" : lost ? "text-pop-red" : "text-cream/60"}`}
      >
        {label} {r.outcome !== "abstained" && r.wager > 0 && <span className="tabular-nums">{signedChips(r.wagerDelta)}</span>}
      </motion.p>
      <p className="flex items-center justify-center gap-2 font-display text-4xl text-gold">
        <PokerChip color="gold" size={30} />
        <AnimatedNumber value={r.after} from={r.before} delay={settle + 0.2} />
        <span className="text-lg text-cream/50">+{r.allowance} bonus</span>
      </p>
    </motion.div>
  );
}
