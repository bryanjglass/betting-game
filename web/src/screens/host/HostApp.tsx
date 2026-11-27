import { useEffect, useMemo } from "react";
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABELS, CHIPS, LIMITS, ROUND_OPTIONS, TIMER_OPTIONS } from "../../../../shared/constants";
import type { ClientView, PlayerPublic, StandingRow } from "../../../../shared/views";
import { Avatar } from "../../components/Avatar";
import { ChipAmount } from "../../components/Chips";
import { optionStyle } from "../../components/options";
import { QRCode } from "../../components/QRCode";
import { TimerBar } from "../../components/Timer";
import { Button, Card, ConnectionBanner, formatChips, Logo, phaseLabel, signedChips, Spinner } from "../../components/ui";
import { displayJoinHost, joinUrl } from "../../lib/config";
import { navigate } from "../../lib/router";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";

export function HostApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const status = useGame((s) => s.status);
  const view = useGame((s) => s.view);
  const hasToken = !!storage.hostToken(code);

  useEffect(() => {
    if (!hasToken) return;
    connect(code, "host");
    document.title = `Host · The Betting Game · ${code}`;
    return () => disconnect();
  }, [code, hasToken, connect, disconnect]);

  if (!hasToken || status === "notFound") {
    return (
      <main className="bg-show flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-6 text-center">
        <Logo />
        <h1 className="font-display text-3xl">This browser isn't hosting room {code}</h1>
        <p className="max-w-md text-cream/70">
          Host controls only work in the browser that created the room. You can still open the TV display or join as a player.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => navigate(`/tv/${code}`)}>Open TV display</Button>
          <Button variant="success" onClick={() => navigate(`/play/${code}`)}>
            Join as player
          </Button>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Home
          </Button>
        </div>
      </main>
    );
  }
  if (!view)
    return (
      <main className="bg-show min-h-[100dvh]">
        <Spinner label="Connecting to your room…" />
      </main>
    );
  return <HostDashboard view={view} />;
}

function useHostActions(view: ClientView) {
  const send = useGame((s) => s.send);
  return useMemo(() => {
    const from = { phase: view.phase, round: view.round?.number ?? 0, dealId: view.round?.dealId };
    return {
      advance: () => send({ type: "advance", from }),
      start: () => send({ type: "start" }),
      pause: () => send({ type: "pause" }),
      resume: () => send({ type: "resume" }),
      skip: () => view.round && send({ type: "skipQuestion", round: view.round.number, dealId: view.round.dealId }),
      endGame: () => send({ type: "endGame" }),
      rematch: (toLobby = false) => send({ type: "rematch", toLobby }),
      kick: (playerId: string) => send({ type: "kick", playerId }),
      configure: (config: Partial<ClientView["config"]>) => send({ type: "configure", config }),
    };
  }, [view, send]);
}

function primaryAction(view: ClientView, a: ReturnType<typeof useHostActions>): { label: string; run: () => unknown; disabled?: boolean } {
  const round = view.round;
  switch (view.phase) {
    case "lobby":
      return { label: "Start Game ▶", run: a.start, disabled: !view.host?.canStart };
    case "betting":
      return { label: "Close Betting Now ▶", run: a.advance };
    case "wagerReveal":
      return { label: "Reveal the Answer Now ▶", run: a.advance };
    case "answerReveal":
      return { label: "Show Leaderboard Now ▶", run: a.advance };
    case "scoreboard":
      return { label: round!.number >= round!.total ? "Final Results Now ▶" : "Next Question Now ▶", run: a.advance };
    case "gameOver":
      return { label: "Rematch ▶", run: () => a.rematch(false) };
  }
}

function HostDashboard({ view }: { view: ClientView }) {
  const actions = useHostActions(view);
  const primary = primaryAction(view, actions);
  const inGame = view.phase !== "lobby" && view.phase !== "gameOver";
  const canSkip = view.phase === "betting" || view.phase === "wagerReveal";

  // Keyboard shortcuts: Space / → = primary action, P = pause/resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, button")) return;
      if ((e.key === " " || e.key === "ArrowRight") && !primary.disabled) {
        e.preventDefault();
        void primary.run();
      } else if (e.key.toLowerCase() === "p" && inGame) {
        void (view.paused ? actions.resume() : actions.pause());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, inGame, view.paused, actions]);

  const openTv = () => window.open(`#/tv/${view.roomCode}`, `btg-tv-${view.roomCode}`);

  return (
    <main className="bg-show min-h-[100dvh] p-4 lg:p-6" data-testid="host-app" data-phase={view.phase} data-round={view.round?.number ?? 0}>
      <ConnectionBanner />
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Logo size="sm" />
        <div className="flex items-center gap-2 rounded-2xl bg-ink-800 px-4 py-2">
          <span className="text-sm uppercase tracking-widest text-cream/60">Room</span>
          <span className="font-display text-3xl font-bold tracking-[0.2em] text-gold" data-testid="room-code">
            {view.roomCode}
          </span>
        </div>
        <span className="rounded-full bg-ink-700 px-3 py-1 font-display text-lg" data-testid="host-phase">
          {phaseLabel(view.phase)}
          {view.round && ` · Round ${view.round.number} of ${view.round.total}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-sm ${view.host?.tvConnections ? "text-pop-green" : "text-cream/50"}`} data-testid="tv-status">
            {view.host?.tvConnections ? "● TV connected" : "○ TV not open"}
          </span>
          <Button variant="secondary" onClick={openTv} data-testid="open-tv">
            📺 Open TV Display
          </Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <Card className="flex flex-col gap-4">
          {inGame && (
            <>
              <div className="flex items-center gap-4">
                <TimerBar timer={view.timer} className="flex-1" />
                {view.paused ? (
                  <Button variant="success" onClick={actions.resume} data-testid="resume">
                    ▶ Resume
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={actions.pause} data-testid="pause">
                    ❚❚ Pause
                  </Button>
                )}
              </div>
              <p className="rounded-2xl bg-ink-900/50 px-4 py-2 text-sm text-cream/70" data-testid="host-autopilot">
                {view.paused
                  ? "❚❚ Paused — the clock is frozen until you resume."
                  : "⚙️ The game runs itself from here — every step moves on when its timer runs out. Use the buttons only to pause or skip ahead."}
              </p>
            </>
          )}
          <PhasePanel view={view} actions={actions} />
          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <Button size="xl" onClick={() => primary.run()} disabled={primary.disabled} data-testid="host-primary">
              {primary.label}
            </Button>
            {view.phase === "gameOver" && (
              <Button size="lg" variant="secondary" onClick={() => actions.rematch(true)} data-testid="back-to-lobby">
                Change Settings / New Players
              </Button>
            )}
            {canSkip && (
              <Button variant="secondary" onClick={() => actions.skip()} data-testid="skip-question">
                ⤼ Skip Question
              </Button>
            )}
            {inGame && (
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => window.confirm("End the game now and show final results?") && actions.endGame()}
                data-testid="end-game"
              >
                End Game
              </Button>
            )}
          </div>
          <p className="text-sm text-cream/40">
            Tip: press Space or → for the big button, P to pause. {canSkip && "Skipping replaces the question — no chips change hands."}
          </p>
        </Card>

        <aside className="flex flex-col gap-5">
          {view.phase === "lobby" && (
            <Card className="flex flex-col items-center gap-3 text-center">
              <QRCode value={joinUrl(view.roomCode)} size={200} />
              <p className="text-cream/70">
                Join at <span className="font-semibold text-cream">{displayJoinHost()}</span>
              </p>
              <a className="break-all text-xs text-cream/40 underline" href={joinUrl(view.roomCode)} target="_blank" rel="noreferrer">
                {joinUrl(view.roomCode)}
              </a>
            </Card>
          )}
          <PlayersPanel view={view} onKick={actions.kick} />
        </aside>
      </div>
    </main>
  );
}

function PlayersPanel({ view, onKick }: { view: ClientView; onKick: (id: string) => void }) {
  const showChips = view.phase !== "lobby";
  const sorted = showChips ? [...view.players].sort((a, b) => a.rank - b.rank) : view.players;
  return (
    <Card>
      <h2 className="mb-3 flex items-baseline justify-between font-display text-xl">
        Players{" "}
        <span className="text-base text-cream/60" data-testid="player-count">
          {view.players.length} / {LIMITS.maxPlayers}
        </span>
      </h2>
      {view.players.length === 0 && <p className="text-cream/50">Nobody yet — scan the QR code to join!</p>}
      <ul className="flex flex-col gap-2" data-testid="host-players">
        {sorted.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-ink-900/60 px-3 py-2">
            <div className="relative">
              <Avatar index={p.avatar} size={40} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ink-900 ${p.connected ? "bg-pop-green" : "bg-cream/30"}`}
                title={p.connected ? "Connected" : "Disconnected"}
              />
            </div>
            <span className="flex-1 truncate font-semibold">{p.name}</span>
            <PlayerStatus p={p} view={view} />
            {showChips && <ChipAmount value={p.chips} size={18} className="font-display text-gold" />}
            {view.phase === "lobby" && (
              <button
                className="rounded-lg px-2 text-cream/40 hover:bg-pop-red hover:text-white"
                onClick={() => window.confirm(`Remove ${p.name} from the room?`) && onKick(p.id)}
                aria-label={`Remove ${p.name}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlayerStatus({ p, view }: { p: PlayerPublic; view: ClientView }) {
  const round = view.round;
  if (!round || view.phase !== "betting") return null;
  return round.lockedIds.includes(p.id) ? (
    <span title="Bet locked">🔒</span>
  ) : (
    <span className="text-cream/30" title="Thinking">
      🤔
    </span>
  );
}

function QuestionBlock({ view }: { view: ClientView }) {
  const round = view.round!;
  const correct = round.reveal?.correctIndex ?? null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm uppercase tracking-widest text-cream/50">
        {CATEGORY_EMOJI[round.question.category]} {CATEGORY_LABELS[round.question.category]}
      </p>
      <p className="font-display text-3xl font-semibold text-balance" data-testid="host-question">
        {round.question.text}
      </p>
      <ol className="grid gap-2 md:grid-cols-2">
        {round.question.options.map((o, i) => {
          const s = optionStyle(i);
          const isCorrect = correct === i;
          return (
            <li
              key={i}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${correct === null ? "bg-ink-900/60" : isCorrect ? "bg-pop-green/25 ring-2 ring-pop-green" : "bg-ink-900/40 opacity-50"}`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} font-display font-bold text-ink`}>{s.letter}</span>
              <span className="flex-1">{o}</span>
              {isCorrect && <span aria-label="Correct answer">✅</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PhasePanel({ view, actions }: { view: ClientView; actions: ReturnType<typeof useHostActions> }) {
  const round = view.round;
  const name = (id: string) => view.players.find((p) => p.id === id);
  switch (view.phase) {
    case "lobby":
      return <LobbySettings view={view} configure={actions.configure} />;
    case "betting":
      return (
        <div className="flex flex-col gap-4">
          <QuestionBlock view={view} />
          <p className="text-lg">
            <strong data-testid="host-locked-count">{round!.lockedIds.length}</strong> of {view.players.length} bets locked
            <span className="ml-2 text-sm text-cream/50">(answers and wagers stay secret — even from you)</span>
          </p>
        </div>
      );
    case "wagerReveal":
      return (
        <div className="flex flex-col gap-4">
          <QuestionBlock view={view} />
          <h3 className="font-display text-xl">The bets are in</h3>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="host-wagers">
            {round!.wagers!.map((w) => {
              const p = name(w.playerId);
              return (
                <li key={w.playerId} className="flex items-center gap-2 rounded-xl bg-ink-900/60 px-3 py-2" data-testid="host-wager" data-name={p?.name} data-wager={w.wager}>
                  <Avatar index={p?.avatar ?? 0} size={30} />
                  <span className="flex-1">{p?.name}</span>
                  {w.abstained ? <span className="text-cream/50">sat out</span> : <ChipAmount value={w.wager} size={18} className="font-display text-gold" />}
                  {w.allIn && <span className="rounded bg-chip-red px-1.5 text-xs font-bold">ALL IN</span>}
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "answerReveal":
      return (
        <div className="flex flex-col gap-4">
          <QuestionBlock view={view} />
          {round!.reveal!.fact && <p className="text-cream/70">💡 {round!.reveal!.fact}</p>}
          <p className="text-xs text-cream/40">Source: {round!.reveal!.source}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {round!.reveal!.results.map((r) => {
              const p = name(r.playerId);
              return (
                <li key={r.playerId} className="flex items-center gap-2 rounded-xl bg-ink-900/60 px-3 py-2" data-testid="host-result" data-name={p?.name} data-after={r.after}>
                  <Avatar index={p?.avatar ?? 0} size={30} />
                  <span className="flex-1">{p?.name}</span>
                  <span className={r.outcome === "won" ? "text-pop-green" : r.outcome === "lost" ? "text-pop-red" : "text-cream/50"}>
                    {r.outcome === "abstained" ? "sat out" : signedChips(r.wagerDelta)}
                  </span>
                  <span className="font-display tabular-nums text-gold">{formatChips(r.after)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "scoreboard":
      return <Standings rows={view.scoreboard?.standings ?? []} />;
    case "gameOver":
      return (
        <div className="flex flex-col gap-3">
          <p className="font-display text-2xl">
            👑 {view.final!.winnerIds.map((id) => name(id)?.name).join(" & ")} win{view.final!.winnerIds.length === 1 ? "s" : ""}!
          </p>
          <Standings rows={view.final?.standings ?? []} />
        </div>
      );
  }
}

function Standings({ rows }: { rows: StandingRow[] }) {
  return (
    <ol className="flex flex-col gap-1.5" data-testid="host-standings">
      {rows.map((r) => (
        <li key={r.playerId} className="flex items-center gap-3 rounded-xl bg-ink-900/60 px-3 py-2" data-testid="standing-row" data-name={r.name} data-chips={r.chips} data-rank={r.rank}>
          <span className="w-8 font-display text-xl text-cream/60">#{r.rank}</span>
          <Avatar index={r.avatar} size={32} />
          <span className="flex-1 font-semibold">{r.name}</span>
          {r.roundDelta !== 0 && <span className={r.roundDelta > 0 ? "text-pop-green" : "text-pop-red"}>{signedChips(r.roundDelta)}</span>}
          <span className="w-24 text-right font-display text-xl tabular-nums text-gold">{formatChips(r.chips)}</span>
        </li>
      ))}
    </ol>
  );
}

function LobbySettings({ view, configure }: { view: ClientView; configure: (c: Partial<ClientView["config"]>) => unknown }) {
  const c = view.config;
  const toggleCategory = (cat: (typeof CATEGORIES)[number]) => {
    const next = c.categories.includes(cat) ? c.categories.filter((x) => x !== cat) : [...c.categories, cat];
    if (next.length) configure({ categories: next });
  };
  return (
    <div className="flex flex-col gap-5" data-testid="lobby-settings">
      <h2 className="font-display text-2xl">Game Settings</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 font-semibold">Questions</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Rounds">
            {ROUND_OPTIONS.map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={c.rounds === n}
                onClick={() => configure({ rounds: n })}
                className={`rounded-2xl px-4 py-2 font-display text-xl ${c.rounds === n ? "bg-gold text-ink" : "bg-ink-700 hover:bg-ink-600"}`}
                data-testid={`rounds-${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-semibold">Betting timer</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Betting timer">
            {TIMER_OPTIONS.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={c.bettingSeconds === s}
                onClick={() => configure({ bettingSeconds: s })}
                className={`rounded-2xl px-4 py-2 font-display text-xl ${c.bettingSeconds === s ? "bg-gold text-ink" : "bg-ink-700 hover:bg-ink-600"}`}
                data-testid={`timer-${s}`}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <p className="mb-2 font-semibold">Question categories</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((cat) => {
            const on = c.categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                aria-pressed={on}
                className={`rounded-2xl border-2 px-4 py-2 text-left transition ${on ? "border-gold bg-gold/15" : "border-white/10 bg-ink-900/40 opacity-60"}`}
                data-testid={`category-${cat}`}
              >
                <span className="font-display text-lg">
                  {on ? "✓ " : ""}
                  {CATEGORY_EMOJI[cat]} {CATEGORY_LABELS[cat]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="rounded-2xl bg-felt/40 p-3 text-sm text-cream/80">
        Everyone starts with {formatChips(CHIPS.starting)} chips and gets {CHIPS.roundAllowance} more every round. Bets go in steps of{" "}
        {CHIPS.wagerStep}. Virtual chips only — no real money.
      </p>
      <p className="text-center text-sm text-cream/70" data-testid="hands-free-hint">
        Once you press Start, the whole game plays itself on timers — you can join from your phone and play too. You can pause or skip ahead at any time.
      </p>
      {view.host && view.host.startBlockers.length > 0 && (
        <p className="rounded-2xl bg-ink-900/60 p-3 text-cream/70" data-testid="start-blockers">
          {view.host.startBlockers.join(" · ")}
        </p>
      )}
    </div>
  );
}
