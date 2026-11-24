import { LayoutGroup, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_EMOJI, CATEGORY_LABELS, CHIPS, LIMITS } from "../../../../shared/constants";
import type { ClientView, StandingRow } from "../../../../shared/views";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { Avatar } from "../../components/Avatar";
import { ChipAmount, PokerChip } from "../../components/Chips";
import { optionStyle } from "../../components/options";
import { QRCode } from "../../components/QRCode";
import { TimerRing } from "../../components/Timer";
import { TvStage } from "../../components/TvStage";
import { formatChips, Logo, signedChips, Spinner } from "../../components/ui";
import { displayJoinHost, joinUrl } from "../../lib/config";
import { burstConfetti } from "../../lib/effects";
import { setSoundEnabled, sfx } from "../../lib/sound";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";
import { AnswerRevealScene, WagerRevealScene } from "./BigBetReveal";

export function TvApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const view = useGame((s) => s.view);
  const status = useGame((s) => s.status);
  const [sound, setSound] = useState(storage.sound());

  useEffect(() => {
    connect(code, "tv");
    document.title = `The Betting Game · ${code}`;
    return () => disconnect();
  }, [code, connect, disconnect]);

  useEffect(() => setSoundEnabled(sound), [sound]);
  useSoundCues(view);

  return (
    <TvStage>
      <div className="bg-show absolute inset-0" data-testid="tv-app" data-phase={view?.phase ?? "loading"}>
        {status === "notFound" ? (
          <div className="flex h-full flex-col items-center justify-center gap-8">
            <Logo size="lg" />
            <p className="font-display text-5xl">Room {code} doesn't exist (or has closed).</p>
          </div>
        ) : !view ? (
          <div className="flex h-full scale-150 items-center justify-center">
            <Spinner label="Connecting to the game…" />
          </div>
        ) : (
          <TvScreen view={view} />
        )}
        {view && status !== "open" && status !== "notFound" && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-pop-orange px-8 py-3 font-display text-3xl text-ink" data-testid="reconnecting">
            Reconnecting…
          </div>
        )}
        <button
          onClick={() => {
            storage.setSound(!sound);
            setSound(!sound);
          }}
          className="absolute left-[330px] top-8 z-20 rounded-full bg-black/30 px-4 py-2 font-display text-xl text-cream/50 hover:text-cream"
          aria-label={sound ? "Mute sound" : "Enable sound"}
        >
          {sound ? "🔊 Sound on" : "🔇 Sound off"}
        </button>
      </div>
    </TvStage>
  );
}

function useSoundCues(view: ClientView | null) {
  const prev = useRef<{ phase?: string; players?: number; locked?: number }>({});
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    if (p.phase && p.phase !== view.phase) {
      if (view.phase === "gameOver") {
        sfx.fanfare();
        burstConfetti("big");
      } else if (view.phase !== "answerReveal") sfx.whoosh();
    }
    const locked = view.round?.lockedIds.length ?? 0;
    if (view.phase === "betting" && p.locked !== undefined && locked > p.locked) sfx.chips(2);
    if (view.phase === "lobby" && p.players !== undefined && view.players.length > p.players) sfx.join();
    prev.current = { phase: view.phase, players: view.players.length, locked };
  }, [view]);
}

function TvHeader({ view }: { view: ClientView }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-12 py-6">
      <Logo size="sm" />
      <div className="flex items-center gap-5 font-display text-3xl">
        {view.round && (
          <span className="rounded-full bg-white/10 px-6 py-2" data-testid="tv-round">
            Round {view.round.number} <span className="text-cream/50">of {view.round.total}</span>
          </span>
        )}
        <span className="rounded-full bg-white/10 px-6 py-2 tracking-[0.2em]">
          <span className="tracking-normal text-cream/50">Room </span>
          <span className="text-gold">{view.roomCode}</span>
        </span>
      </div>
      {view.paused && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-pop-orange px-10 py-3 font-display text-4xl text-ink shadow-pop" data-testid="tv-paused">
          ❚❚ Paused
        </div>
      )}
    </div>
  );
}

function TvScreen({ view }: { view: ClientView }) {
  // Screens animate in on mount; nothing waits for an exit animation, so the
  // DOM always reflects the latest server state (even in a background tab).
  const key = `${view.gameNumber}-${view.phase}-${view.round?.dealId ?? ""}`;
  return (
    <>
      <TvHeader view={view} />
      <motion.div key={key} className="absolute inset-0" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        {view.phase === "lobby" && <TvLobby view={view} />}
        {view.phase === "betting" && <TvBetting view={view} />}
        {view.phase === "wagerReveal" && <WagerRevealScene view={view} />}
        {view.phase === "answerReveal" && <AnswerRevealScene view={view} />}
        {view.phase === "scoreboard" && <TvScoreboard view={view} />}
        {view.phase === "gameOver" && <TvFinal view={view} />}
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------

function TvLobby({ view }: { view: ClientView }) {
  const slots = Array.from({ length: LIMITS.maxPlayers }, (_, i) => view.players[i]);
  const c = view.config;
  return (
    <div className="flex h-full items-center gap-16 px-20 pt-16">
      <div className="flex w-[600px] flex-col items-center gap-6">
        <QRCode value={joinUrl(view.roomCode)} size={400} className="shadow-2xl ring-8 ring-gold/70" />
        <div className="text-center font-display">
          <p className="text-4xl text-cream/80">Scan, or go to</p>
          <p className="mt-1 text-4xl font-semibold text-cream">{displayJoinHost()}</p>
          <p className="mt-3 text-4xl text-cream/80">and enter code</p>
          <p className="mt-1 text-[8.5rem] font-bold leading-none tracking-[0.15em] text-gold" data-testid="tv-room-code">
            {view.roomCode}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="font-display text-6xl">
          Take a seat at the table <span className="text-cream/50">({view.players.length}/{LIMITS.maxPlayers})</span>
        </h1>
        <div className="bg-felt grid grid-cols-2 gap-4 rounded-[2.5rem] border-8 border-[#5b3a1a] p-6 shadow-2xl" data-testid="tv-lobby-players">
          {slots.map((p, i) =>
            p ? (
              <motion.div
                key={p.id}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="flex items-center gap-4 rounded-3xl bg-ink-900/60 px-4 py-2"
              >
                <Avatar index={p.avatar} size={72} />
                <span className="flex-1 truncate font-display text-4xl">{p.name}</span>
                <ChipAmount value={p.chips} size={30} className="font-display text-3xl text-gold" />
              </motion.div>
            ) : (
              <div key={`empty-${i}`} className="flex h-[88px] items-center justify-center rounded-3xl border-4 border-dashed border-white/15 font-display text-3xl text-cream/25">
                empty seat
              </div>
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-3 font-display text-2xl">
          <span className="rounded-full bg-white/10 px-5 py-2">❓ {c.rounds} questions</span>
          <span className="rounded-full bg-white/10 px-5 py-2">⏱ {c.bettingSeconds}s to bet</span>
          <span className="rounded-full bg-white/10 px-5 py-2">
            {c.categories.length === 7 ? "🎲 All categories" : c.categories.map((x) => CATEGORY_EMOJI[x]).join(" ")}
          </span>
        </div>
        <p className="font-display text-3xl text-cream/80">
          Start with <span className="text-gold">{formatChips(CHIPS.starting)}</span> chips · +{CHIPS.roundAllowance} every round · Right answers win your bet, wrong
          answers lose it!
        </p>
      </div>
    </div>
  );
}

function TvBetting({ view }: { view: ClientView }) {
  const round = view.round!;
  const locked = new Set(round.lockedIds);
  return (
    <div className="flex h-full flex-col px-16 pt-28">
      <div className="flex items-start gap-10">
        <div className="relative flex-1 rounded-[2.5rem] border-8 border-gold/70 bg-cream px-12 py-10 text-ink shadow-pop">
          <span className="absolute -top-7 left-10 rounded-full bg-ink px-6 py-2 font-display text-2xl text-gold">
            {CATEGORY_EMOJI[round.question.category]} {CATEGORY_LABELS[round.question.category]}
          </span>
          <p className="font-display text-6xl font-semibold leading-tight text-balance" data-testid="tv-question-text">
            {round.question.text}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <TimerRing timer={view.timer} size={250} testId="tv-timer" />
          <p className="font-display text-2xl uppercase tracking-widest text-cream/60">to bet</p>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6">
        {round.question.options.map((opt, i) => {
          const s = optionStyle(i);
          return (
            <motion.div
              key={i}
              initial={{ x: i % 2 ? 80 : -80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.12, type: "spring", stiffness: 200, damping: 20 }}
              className="flex items-center gap-6 rounded-3xl border-4 border-white/10 bg-ink-800/90 p-4"
              data-testid="tv-option"
            >
              <span className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${s.bg} font-display text-5xl font-bold text-ink shadow-pop-sm`}>{s.letter}</span>
              <span className="font-display text-5xl leading-tight">{opt}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-auto mb-10 flex items-end justify-between gap-6">
        <div className="flex flex-wrap gap-4">
          {view.players.map((p) => {
            const isLocked = locked.has(p.id);
            return (
              <div key={p.id} className={`relative flex w-[130px] flex-col items-center rounded-3xl px-2 pb-2 pt-3 transition ${isLocked ? "bg-gold/20" : "bg-white/5"}`}>
                <div className={`${isLocked ? "" : "opacity-50 grayscale-[60%]"} transition`}>
                  <Avatar index={p.avatar} size={78} />
                </div>
                {isLocked && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-2 top-1 text-3xl" aria-label="Bet locked">
                    🔒
                  </motion.span>
                )}
                <span className="w-full truncate text-center font-display text-2xl">{p.name}</span>
                <span className="font-display text-xl text-gold tabular-nums">{formatChips(p.chips)}</span>
              </div>
            );
          })}
        </div>
        <div className="text-right font-display">
          <p className="text-7xl text-gold" data-testid="tv-locked-count">
            {round.lockedIds.length}
            <span className="text-cream/50">/{view.players.length}</span>
          </p>
          <p className="text-3xl text-cream/70">bets locked in</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TvScoreboard({ view }: { view: ClientView }) {
  const sb = view.scoreboard!;
  const rows = sb.standings;
  const prevOrder = [...rows].sort((a, b) => (a.previousRank ?? a.rank) - (b.previousRank ?? b.rank));
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), 1100);
    return () => clearTimeout(t);
  }, []);
  const ordered = settled ? rows : prevOrder;
  const top = Math.max(1, ...rows.map((r) => r.chips));
  const players = new Map(view.players.map((p) => [p.id, p]));
  return (
    <div className="flex h-full gap-10 px-16 pt-28">
      <div className="flex flex-1 flex-col">
        <h1 className="font-display text-6xl">
          Leaderboard <span className="text-cream/50">· after round {sb.number}</span>
        </h1>
        <LayoutGroup>
          <ol className="mt-6 flex flex-col gap-2.5">
            {ordered.map((r) => (
              <LeaderRow key={r.playerId} row={r} top={top} compact={rows.length > 7} />
            ))}
          </ol>
        </LayoutGroup>
      </div>
      <aside className="flex w-[520px] flex-col gap-5 pt-24">
        {sb.highlights.map((h, i) => (
          <motion.div
            key={h.kind}
            initial={{ x: 120, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 1.2 + i * 0.25 }}
            className="rounded-3xl border-4 border-gold/40 bg-ink-800/90 p-5"
            data-testid="tv-highlight"
          >
            <p className="font-display text-4xl">
              {h.emoji} {h.title}
            </p>
            <p className="mt-1 font-display text-3xl text-gold">{h.playerIds.map((id) => players.get(id)?.name).join(" & ")}</p>
            <p className="text-2xl text-cream/70">{h.description}</p>
          </motion.div>
        ))}
      </aside>
    </div>
  );
}

function LeaderRow({ row, top, compact }: { row: StandingRow; top: number; compact: boolean }) {
  const moved = row.previousRank === null ? 0 : row.previousRank - row.rank;
  const before = row.chips - row.roundDelta;
  return (
    <motion.li
      layout
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className={`relative flex items-center gap-5 overflow-hidden rounded-3xl px-5 ${compact ? "h-[68px]" : "h-[96px]"} ${moved >= 2 ? "bg-gold/20 ring-4 ring-gold" : "bg-ink-800/90"}`}
      data-testid="tv-standing-row"
      data-name={row.name}
      data-chips={row.chips}
      data-rank={row.rank}
    >
      <motion.div
        className="absolute inset-y-0 left-0 bg-felt/70"
        initial={{ width: `${(before / top) * 100}%` }}
        animate={{ width: `${(row.chips / top) * 100}%` }}
        transition={{ delay: 0.3, duration: 1 }}
      />
      <span className={`relative w-20 font-display ${compact ? "text-4xl" : "text-5xl"} ${row.rank === 1 ? "text-gold" : "text-cream/70"}`}>#{row.rank}</span>
      <Avatar index={row.avatar} size={compact ? 54 : 76} className="relative" />
      <span className={`relative flex-1 truncate font-display ${compact ? "text-4xl" : "text-5xl"}`}>{row.name}</span>
      {moved !== 0 && (
        <span className={`relative font-display text-3xl ${moved > 0 ? "text-pop-green" : "text-pop-red"}`}>
          {moved > 0 ? `▲${moved}` : `▼${-moved}`}
          {moved >= 2 && " 🚀"}
        </span>
      )}
      <span className={`relative w-36 text-right font-display text-3xl tabular-nums ${row.roundDelta >= 0 ? "text-pop-green" : "text-pop-red"}`}>{signedChips(row.roundDelta)}</span>
      <span className={`relative flex w-64 items-center justify-end gap-2 font-display text-gold ${compact ? "text-4xl" : "text-5xl"}`}>
        <PokerChip color="gold" size={compact ? 32 : 42} />
        <AnimatedNumber value={row.chips} from={before} delay={0.3} />
      </span>
    </motion.li>
  );
}

function TvFinal({ view }: { view: ClientView }) {
  const f = view.final!;
  const players = new Map(view.players.map((p) => [p.id, p]));
  const winners = f.winnerIds.map((id) => players.get(id)).filter(Boolean);
  const stats = new Map(f.stats.map((s) => [s.playerId, s]));
  const crowded = f.standings.length > 7;
  return (
    <div className="flex h-full gap-12 px-16 pt-28">
      <div className="flex w-[720px] flex-col items-center justify-center gap-4 text-center">
        <motion.p initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", delay: 0.2 }} className="text-[9rem] leading-none">
          👑
        </motion.p>
        <div className="flex -space-x-6">
          {winners.map((w) => (
            <motion.div key={w!.id} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.4 }}>
              <Avatar index={w!.avatar} size={winners.length > 1 ? 190 : 260} className="drop-shadow-2xl motion-safe:animate-floaty" />
            </motion.div>
          ))}
        </div>
        <p className="font-display text-4xl uppercase tracking-[0.3em] text-cream/70">{winners.length > 1 ? "Co-Champions" : "Champion"}</p>
        <h1 className="text-foil font-display text-8xl font-bold" data-testid="tv-winners">
          {winners.map((w) => w!.name).join(" & ")}
        </h1>
        <p className="font-display text-5xl text-gold">
          <ChipAmount value={f.standings[0]?.chips ?? 0} size={44} />
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-4">
        <h2 className="font-display text-5xl">Final standings</h2>
        <ol className={`flex flex-col ${crowded ? "gap-1.5" : "gap-2"}`}>
          {f.standings.map((r, i) => {
            const s = stats.get(r.playerId);
            return (
              <motion.li
                key={r.playerId}
                initial={{ x: 80, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className={`flex items-center gap-4 rounded-3xl px-5 ${crowded ? "h-[50px]" : "h-[76px]"} ${r.rank === 1 ? "bg-gold/25 ring-4 ring-gold" : "bg-ink-800/90"}`}
                data-testid="tv-standing-row"
                data-name={r.name}
                data-chips={r.chips}
                data-rank={r.rank}
              >
                <span className="w-16 font-display text-4xl text-cream/70">#{r.rank}</span>
                <Avatar index={r.avatar} size={crowded ? 40 : 60} />
                <span className={`flex-1 truncate font-display ${crowded ? "text-3xl" : "text-4xl"}`}>{r.name}</span>
                {s && (
                  <span className="text-2xl text-cream/60">
                    ✅ {s.correct} · 💰 best +{formatChips(s.biggestWin)}
                  </span>
                )}
                <span className="w-48 text-right font-display text-4xl tabular-nums text-gold">{formatChips(r.chips)}</span>
              </motion.li>
            );
          })}
        </ol>
        {f.awards.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-3">
            {f.awards.slice(0, crowded ? 3 : 6).map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 1 + i * 0.15 }}
                className="rounded-3xl bg-ink-800/90 p-4"
                data-testid="tv-award"
              >
                <p className="font-display text-3xl">
                  {a.emoji} {a.title}
                </p>
                <p className="truncate font-display text-2xl text-gold">{a.playerIds.map((id) => players.get(id)?.name).join(" & ")}</p>
                <p className="text-xl text-cream/60">{a.description}</p>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
