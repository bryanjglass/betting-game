import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_EMOJI, CATEGORY_LABELS, CHIPS, LIMITS } from "../../../../shared/constants";
import { quickWager, snapWager } from "../../../../shared/engine/scoring";
import type { ClientView, MyPrivateView } from "../../../../shared/views";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { Avatar, AVATARS } from "../../components/Avatar";
import { ChipAmount, ChipStack, PokerChip } from "../../components/Chips";
import { optionStyle } from "../../components/options";
import { TimerBar } from "../../components/Timer";
import { Button, ConnectionBanner, formatChips, Logo, signedChips, Spinner } from "../../components/ui";
import { burstConfetti } from "../../lib/effects";
import { navigate } from "../../lib/router";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";

export function PlayerApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const view = useGame((s) => s.view);
  const status = useGame((s) => s.status);
  const seatInvalid = useGame((s) => s.seatInvalid);

  useEffect(() => {
    connect(code, "player");
    document.title = `The Betting Game · ${code}`;
    return () => disconnect();
  }, [code, connect, disconnect]);

  let body: React.ReactNode;
  if (status === "notFound") {
    body = (
      <Centered>
        <p className="text-5xl">🤷</p>
        <h1 className="font-display text-3xl">Room {code} wasn't found</h1>
        <p className="text-cream/70">Double-check the code on the TV.</p>
        <Button onClick={() => navigate("/")}>Try another code</Button>
      </Centered>
    );
  } else if (status === "kicked") {
    body = (
      <Centered>
        <h1 className="font-display text-3xl">The host removed you from this room</h1>
        <Button onClick={() => connect(code, "player")}>Join again</Button>
      </Centered>
    );
  } else if (!view) {
    body = <Spinner label={`Connecting to room ${code}…`} />;
  } else if (!view.me) {
    body =
      view.phase === "lobby" ? (
        <JoinForm view={view} seatInvalid={seatInvalid} />
      ) : (
        <Centered>
          <Logo size="sm" />
          <h1 className="font-display text-3xl">This game has already started</h1>
          <p className="text-cream/70">
            {seatInvalid ? "We couldn't find your seat in this game." : "New players can join when the host starts a rematch from the lobby."} If
            you were playing, open this page on the same phone and browser you joined with.
          </p>
        </Centered>
      );
  } else {
    body = <PlayerGame view={view} me={view.me} />;
  }

  return (
    <main className="bg-show min-h-[100dvh] w-full overflow-x-hidden" data-testid="player-app" data-phase={view?.phase ?? "loading"}>
      <ConnectionBanner />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-4 pb-24 pt-4">{body}</div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">{children}</div>;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

function JoinForm({ view, seatInvalid }: { view: ClientView; seatInvalid: boolean }) {
  const send = useGame((s) => s.send);
  const taken = new Set(view.players.map((p) => p.avatar));
  const saved = storage.profile();
  const [name, setName] = useState(saved?.name ?? "");
  const [avatar, setAvatar] = useState<number>(() => {
    if (saved && !taken.has(saved.avatar)) return saved.avatar;
    return AVATARS.findIndex((_, i) => !taken.has(i));
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const full = view.players.length >= LIMITS.maxPlayers;

  // If someone grabs our avatar first, move to a free one.
  useEffect(() => {
    if (taken.has(avatar)) setAvatar(AVATARS.findIndex((_, i) => !taken.has(i)));
  }, [view.players]); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Please enter your name");
    setBusy(true);
    setError(null);
    const res = await send({ type: "join", name: trimmed, avatar }, { quiet: true });
    setBusy(false);
    if (!res.ok) setError(res.message ?? "Couldn't join");
    else storage.setProfile({ name: trimmed, avatar });
  }

  return (
    <form onSubmit={join} className="flex flex-col gap-5" data-testid="join-form">
      <div className="flex items-center justify-between">
        <Logo size="sm" />
        <span className="rounded-full bg-ink-700 px-3 py-1 font-display tracking-widest">{view.roomCode}</span>
      </div>
      {seatInvalid && <p className="rounded-2xl bg-pop-orange/20 p-3 text-sm">Your previous seat wasn't found — join again below.</p>}
      <label className="flex flex-col gap-2">
        <span className="font-display text-xl">Your name</span>
        <input
          value={name}
          onChange={(e) => setName([...e.target.value].slice(0, LIMITS.maxNameLength).join(""))}
          placeholder="e.g. Grandma"
          autoComplete="nickname"
          enterKeyHint="done"
          className="w-full rounded-2xl border-2 border-white/15 bg-ink-900 px-4 py-3 font-display text-2xl outline-none focus:border-gold"
          data-testid="name-input"
        />
      </label>
      <fieldset>
        <legend className="mb-2 font-display text-xl">Pick your player</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a, i) => {
            const isTaken = taken.has(i);
            return (
              <button
                type="button"
                key={a.name}
                role="radio"
                aria-checked={avatar === i}
                aria-label={`${a.name}${isTaken ? " (taken)" : ""}`}
                disabled={isTaken}
                onClick={() => setAvatar(i)}
                className={`flex aspect-square items-center justify-center rounded-2xl border-4 transition ${
                  avatar === i ? "border-gold bg-gold/15" : "border-transparent bg-ink-800"
                } ${isTaken ? "opacity-25" : "active:scale-95"}`}
                data-testid={`avatar-${i}`}
              >
                <Avatar index={i} size="80%" />
              </button>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p className="rounded-2xl bg-pop-red/20 p-3 font-semibold text-pop-red" role="alert" data-testid="join-error">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" variant="success" disabled={busy || full || avatar < 0} data-testid="join-submit">
        {full ? "Room is full" : busy ? "Joining…" : "Join Game"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// In-game
// ---------------------------------------------------------------------------

function PlayerHeader({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const pub = view.players.find((p) => p.id === me.id);
  return (
    <header className="mb-3 flex items-center gap-3">
      <Avatar index={me.avatar} size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xl leading-tight" data-testid="me-name">
          {me.name}
        </p>
        {view.round && (
          <p className="text-sm text-cream/60">
            Round {view.round.number} of {view.round.total}
          </p>
        )}
      </div>
      {view.phase !== "lobby" && (
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 font-display text-2xl text-gold">
            <PokerChip color="gold" size={22} />
            <span className="tabular-nums" data-testid="me-chips">
              {formatChips(me.chips)}
            </span>
          </p>
          {pub && (
            <p className="text-xs text-cream/60">
              #{pub.rank} of {view.players.length}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

function PlayerGame({ view, me }: { view: ClientView; me: MyPrivateView }) {
  return (
    <>
      <PlayerHeader view={view} me={me} />
      {view.phase === "betting" && <TimerBar timer={view.timer} className="mb-3" />}
      {view.paused && <p className="mb-3 rounded-2xl bg-pop-orange/20 px-3 py-2 text-center font-semibold">⏸ The host paused the game</p>}
      <motion.div
        key={`${view.gameNumber}-${view.phase}-${view.round?.dealId ?? ""}`}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-1 flex-col"
      >
        {view.phase === "lobby" && <LobbyWait view={view} me={me} />}
        {view.phase === "betting" && (me.locked ? <LockedCard view={view} me={me} /> : <BetPanel key={view.round!.dealId} view={view} me={me} />)}
        {view.phase === "wagerReveal" && <WagerRevealPhone view={view} me={me} />}
        {view.phase === "answerReveal" && <AnswerRevealPhone view={view} me={me} />}
        {view.phase === "scoreboard" && <ScorePhone view={view} me={me} />}
        {view.phase === "gameOver" && <FinalPhone view={view} me={me} />}
      </motion.div>
    </>
  );
}

function LobbyWait({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const send = useGame((s) => s.send);
  const [editing, setEditing] = useState(false);
  const taken = new Set(view.players.filter((p) => p.id !== me.id).map((p) => p.avatar));
  return (
    <div className="flex flex-1 flex-col items-center gap-6 text-center" data-testid="lobby-wait">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
        <Avatar index={me.avatar} size={150} className="motion-safe:animate-floaty" />
      </motion.div>
      <div>
        <h1 className="font-display text-3xl">You're in, {me.name}!</h1>
        <p className="mt-1 text-cream/70">
          You'll start with <ChipAmount value={CHIPS.starting} className="font-bold text-gold" /> chips. Look at the TV — the host will start soon.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)}>
        {editing ? "Done" : "Change player"}
      </Button>
      {editing && (
        <div className="grid w-full grid-cols-4 gap-2">
          {AVATARS.map((a, i) => (
            <button
              key={a.name}
              disabled={taken.has(i)}
              onClick={() => send({ type: "updateProfile", avatar: i })}
              className={`flex aspect-square items-center justify-center rounded-2xl border-4 ${me.avatar === i ? "border-gold" : "border-transparent bg-ink-800"} ${taken.has(i) ? "opacity-25" : ""}`}
              aria-label={a.name}
            >
              <Avatar index={i} size="80%" />
            </button>
          ))}
        </div>
      )}
      <div className="w-full rounded-3xl bg-ink-800/80 p-4">
        <p className="mb-3 font-display text-lg text-cream/70">
          {view.players.length} player{view.players.length === 1 ? "" : "s"} at the table
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {view.players.map((p) => (
            <span key={p.id} className="flex items-center gap-1 rounded-full bg-ink-900/70 py-1 pl-1 pr-3">
              <Avatar index={p.avatar} size={28} /> {p.name}
            </span>
          ))}
        </div>
      </div>
      <HowToPlay />
    </div>
  );
}

function HowToPlay() {
  return (
    <details className="w-full rounded-3xl bg-ink-800/60 p-4 text-left text-sm text-cream/80">
      <summary className="cursor-pointer font-display text-lg text-cream">How betting works</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Pick an answer, then bet chips on how sure you are.</li>
        <li>Every round adds {CHIPS.roundAllowance} bonus chips you can bet right away.</li>
        <li>Right: win your bet. Wrong: lose your bet. Bet 0 to play it safe.</li>
        <li>Bets go up in steps of {CHIPS.wagerStep}. Lost everything? Next round's bonus gets you back in.</li>
        <li>These are pretend chips — just for fun, never real money.</li>
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

type SyncState = "idle" | "saving" | "saved" | "error";

function BetPanel({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const send = useGame((s) => s.send);
  const round = view.round!;
  const available = me.available;
  const [choice, setChoice] = useState<number | null>(me.bet?.choice ?? null);
  const [wager, setWagerRaw] = useState<number>(me.bet?.wager ?? 0);
  const [sync, setSync] = useState<SyncState>(me.bet ? "saved" : "idle");
  const [locking, setLocking] = useState(false);
  const seq = useRef(0);
  const touched = useRef(false);

  const setWager = (n: number) => {
    touched.current = true;
    setWagerRaw(snapWager(n, available));
  };
  const pick = (i: number) => {
    touched.current = true;
    setChoice(i);
  };

  // Keep the server's copy of the draft up to date, so if time runs out the
  // last answer + wager it received is what counts.
  useEffect(() => {
    if (!touched.current) return;
    const mine = ++seq.current;
    setSync("saving");
    const t = window.setTimeout(async () => {
      const res = await send({ type: "setBet", round: round.number, dealId: round.dealId, choice, wager }, { quiet: true });
      if (seq.current === mine) setSync(res.ok ? "saved" : "error");
    }, 200);
    return () => clearTimeout(t);
  }, [choice, wager, round.number, round.dealId, send]);

  async function lock() {
    if (choice === null) return;
    setLocking(true);
    seq.current++; // ignore any in-flight draft result
    const res = await send({ type: "lockBet", round: round.number, dealId: round.dealId, choice, wager });
    setLocking(false);
    if (res.ok) setSync("saved");
  }

  const fill = available > 0 ? (wager / available) * 100 : 0;
  const ifRight = me.chips + CHIPS.roundAllowance + wager;
  const ifWrong = me.chips + CHIPS.roundAllowance - wager;
  const allIn = wager > 0 && wager === available;
  const letter = choice === null ? null : optionStyle(choice).letter;

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="bet-panel">
      <section>
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-cream/50">
          {CATEGORY_EMOJI[round.question.category]} {CATEGORY_LABELS[round.question.category]}
        </p>
        <h1 className="font-display text-2xl leading-snug text-balance" data-testid="phone-question">
          {round.question.text}
        </h1>
      </section>

      <div className="grid gap-2" role="radiogroup" aria-label="Answer">
        {round.question.options.map((opt, i) => {
          const s = optionStyle(i);
          const selected = choice === i;
          return (
            <button
              key={i}
              role="radio"
              aria-checked={selected}
              onClick={() => pick(i)}
              className={`flex items-center gap-3 rounded-2xl border-4 p-2 pr-4 text-left font-display text-lg transition active:scale-[0.98] ${
                selected ? `${s.border} bg-cream text-ink shadow-pop-sm` : "border-transparent bg-ink-800 text-cream"
              }`}
              data-testid={`option-${i}`}
              data-option-text={opt}
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.bg} text-2xl font-bold text-ink`}>{s.letter}</span>
              <span className="min-w-0 flex-1 break-words">{opt}</span>
              {selected && <span aria-hidden>✔</span>}
            </button>
          );
        })}
      </div>

      <section className="bg-felt rounded-3xl border-4 border-gold/60 p-4 shadow-pop" aria-label="Your wager">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cream/70">Your bet</p>
            <p className="font-display text-5xl font-bold leading-none text-gold drop-shadow-[0_3px_0_rgba(0,0,0,0.4)]">
              <span className="tabular-nums" data-testid="wager-amount">
                {formatChips(wager)}
              </span>
            </p>
            <p className="mt-1 text-sm text-cream/80">chips at risk{allIn && <strong className="ml-2 text-gold">· ALL IN!</strong>}</p>
          </div>
          <div className="h-[110px] overflow-hidden">
            <ChipStack amount={wager} chipWidth={44} perColumn={8} maxChips={24} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="h-11 w-11 shrink-0 rounded-full bg-ink-900/60 font-display text-2xl"
            onClick={() => setWager(wager - CHIPS.wagerStep)}
            aria-label={`Bet ${CHIPS.wagerStep} less`}
            data-testid="wager-minus"
          >
            −
          </button>
          <input
            type="range"
            min={0}
            max={available}
            step={CHIPS.wagerStep}
            value={wager}
            onChange={(e) => setWager(Number(e.target.value))}
            className="wager-slider min-w-0 flex-1"
            style={{ ["--fill" as string]: `${fill}%` }}
            aria-label="Wager"
            aria-valuetext={`${wager} chips`}
            data-testid="wager-slider"
          />
          <button
            className="h-11 w-11 shrink-0 rounded-full bg-ink-900/60 font-display text-2xl"
            onClick={() => setWager(wager + CHIPS.wagerStep)}
            aria-label={`Bet ${CHIPS.wagerStep} more`}
            data-testid="wager-plus"
          >
            +
          </button>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            { label: "0", value: 0, id: "zero" },
            { label: "25%", value: quickWager(available, 0.25), id: "25" },
            { label: "50%", value: quickWager(available, 0.5), id: "50" },
            { label: "ALL IN", value: available, id: "all" },
          ].map((q) => (
            <button
              key={q.id}
              onClick={() => setWager(q.value)}
              className={`rounded-xl py-2 font-display text-base font-semibold shadow-pop-sm active:translate-y-0.5 active:shadow-none ${
                q.id === "all" ? "bg-chip-red text-white" : wager === q.value ? "bg-gold text-ink" : "bg-ink-900/60 text-cream"
              }`}
              data-testid={`wager-quick-${q.id}`}
            >
              {q.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-center text-sm text-cream/80">
          You can bet up to <strong className="text-cream">{formatChips(available)}</strong>: {formatChips(me.chips)} + {CHIPS.roundAllowance} round bonus
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center font-display">
          <div className="rounded-2xl bg-pop-green/20 px-2 py-2">
            <p className="text-xs uppercase tracking-wider text-cream/70">If right</p>
            <p className="text-2xl text-pop-green tabular-nums" data-testid="if-right">
              {formatChips(ifRight)}
            </p>
          </div>
          <div className="rounded-2xl bg-pop-red/20 px-2 py-2">
            <p className="text-xs uppercase tracking-wider text-cream/70">If wrong</p>
            <p className="text-2xl text-pop-red tabular-nums" data-testid="if-wrong">
              {formatChips(ifWrong)}
            </p>
          </div>
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-col gap-1">
        <Button size="xl" variant="success" disabled={choice === null || locking} onClick={lock} data-testid="lock-bet">
          {choice === null ? "Pick an answer" : locking ? "Locking…" : wager === 0 ? `Lock In ${letter} · no chips` : `Lock In ${formatChips(wager)} on ${letter}`}
        </Button>
        <p className="text-center text-xs text-cream/60" data-testid="bet-sync" aria-live="polite">
          {sync === "saving" && "Saving…"}
          {sync === "saved" && "✓ Saved — if time runs out, this bet counts"}
          {sync === "error" && "Couldn't save — check your connection"}
          {sync === "idle" && "Answers and bets are secret until the reveal"}
        </p>
      </div>
    </div>
  );
}

function BetSummary({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const bet = me.bet;
  if (!bet || bet.choice === null) {
    return (
      <p className="rounded-2xl bg-ink-800/80 p-4 text-lg" data-testid="my-bet-summary">
        You sat this one out — no chips at risk. You still get the {CHIPS.roundAllowance}-chip round bonus.
      </p>
    );
  }
  const s = optionStyle(bet.choice);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-ink-800/80 p-4 text-left" data-testid="my-bet-summary">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${s.bg} font-display text-2xl font-bold text-ink`}>{s.letter}</span>
      <div className="min-w-0">
        <p className="font-display text-xl">{view.round!.question.options[bet.choice]}</p>
        <p className="text-cream/70">
          <ChipAmount value={bet.wager} className="font-bold text-gold" /> chips on the line
        </p>
      </div>
    </div>
  );
}

function LockedCard({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const waiting = view.players.length - view.round!.lockedIds.length;
  return (
    <div className="flex flex-1 flex-col items-center gap-5 text-center" data-testid="bet-locked">
      <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
        <div className="flex h-36 w-36 items-center justify-center rounded-full border-8 border-gold bg-felt text-6xl shadow-glow">🔒</div>
      </motion.div>
      <h1 className="font-display text-4xl text-gold">Bet locked!</h1>
      <BetSummary view={view} me={me} />
      <p className="text-cream/70">
        {waiting > 0 ? `Waiting for ${waiting} more player${waiting === 1 ? "" : "s"}…` : "Everyone's in!"} Keep your answer secret 🤫
      </p>
    </div>
  );
}

function WagerRevealPhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-5 text-center" data-testid="wager-reveal-phone">
      <p className="text-6xl">🎰</p>
      <h1 className="font-display text-3xl">Bets are closed!</h1>
      <p className="text-cream/70">Eyes on the TV for the Big Bet Reveal…</p>
      <BetSummary view={view} me={me} />
    </div>
  );
}

function AnswerRevealPhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const r = me.result;
  const reveal = view.round!.reveal!;
  const correct = reveal.correctIndex;
  const s = optionStyle(correct);
  const fired = useRef(false);
  useEffect(() => {
    if (!r || fired.current) return;
    fired.current = true;
    if (r.outcome === "won" && r.wager > 0) burstConfetti(r.allIn ? "big" : "small");
    if (navigator.vibrate && r.outcome === "lost" && r.allIn) navigator.vibrate?.([80, 60, 160]);
  }, [r]);
  if (!r) return null;
  const headline =
    r.outcome === "abstained" ? "Sat out" : r.outcome === "won" ? (r.allIn ? "ALL-IN WIN!" : "Correct!") : r.allIn ? "BUSTED!" : "Wrong!";
  const color = r.outcome === "won" ? "text-pop-green" : r.outcome === "lost" ? "text-pop-red" : "text-cream";
  return (
    <div className="flex flex-1 flex-col items-center gap-4 text-center" data-testid="my-result" data-outcome={r.outcome}>
      <motion.h1
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 12 }}
        className={`font-display text-6xl font-bold ${color} ${r.outcome === "lost" && r.allIn ? "motion-safe:animate-shake" : ""}`}
      >
        {headline}
      </motion.h1>
      <div className="w-full rounded-3xl bg-ink-800/80 p-4">
        <p className="text-sm uppercase tracking-widest text-cream/60">The answer was</p>
        <p className="mt-1 flex items-center justify-center gap-2 font-display text-2xl">
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${s.bg} text-ink`}>{s.letter}</span>
          {view.round!.question.options[correct]}
        </p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 font-display">
        <div className="rounded-2xl bg-ink-800/80 p-3">
          <p className="text-xs uppercase tracking-wider text-cream/60">Your bet</p>
          <p className={`text-3xl tabular-nums ${color}`} data-testid="my-wager-delta">
            {r.outcome === "abstained" ? "—" : signedChips(r.wagerDelta)}
          </p>
        </div>
        <div className="rounded-2xl bg-ink-800/80 p-3">
          <p className="text-xs uppercase tracking-wider text-cream/60">Round bonus</p>
          <p className="text-3xl text-gold tabular-nums">+{formatChips(r.allowance)}</p>
        </div>
      </div>
      <div className="w-full rounded-3xl border-4 border-gold/60 bg-felt p-4">
        <p className="text-sm uppercase tracking-widest text-cream/80">Your chips</p>
        <p className="font-display text-6xl text-gold">
          <AnimatedNumber value={r.after} />
        </p>
        <p className="text-cream/70 tabular-nums">was {formatChips(r.before)}</p>
      </div>
      {reveal.fact && <p className="text-sm text-cream/70">💡 {reveal.fact}</p>}
    </div>
  );
}

function ScorePhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const sb = view.scoreboard;
  const mine = sb?.standings.find((s) => s.playerId === me.id);
  if (!sb || !mine) return null;
  const moved = mine.previousRank === null ? 0 : mine.previousRank - mine.rank;
  return (
    <div className="flex flex-1 flex-col items-center gap-4 text-center" data-testid="score-phone">
      <p className="text-sm uppercase tracking-widest text-cream/60">After round {sb.number}</p>
      <p className="font-display text-7xl text-gold" data-testid="my-rank">
        #{mine.rank}
      </p>
      {moved !== 0 && <p className={`font-display text-xl ${moved > 0 ? "text-pop-green" : "text-pop-red"}`}>{moved > 0 ? `▲ up ${moved}` : `▼ down ${-moved}`}</p>}
      <p className="font-display text-3xl">
        <ChipAmount value={mine.chips} size={30} />
      </p>
      <p className={`font-display text-xl ${mine.roundDelta >= 0 ? "text-pop-green" : "text-pop-red"}`}>{signedChips(mine.roundDelta)} this round</p>
      <ol className="w-full space-y-1 text-left">
        {sb.standings.map((s) => (
          <li key={s.playerId} className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ${s.playerId === me.id ? "bg-gold/20" : "bg-ink-800/60"}`}>
            <span className="w-8 font-display text-cream/60">#{s.rank}</span>
            <Avatar index={s.avatar} size={26} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="font-display tabular-nums text-gold">{formatChips(s.chips)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FinalPhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const f = view.final!;
  const mine = f.standings.find((s) => s.playerId === me.id);
  const won = f.winnerIds.includes(me.id);
  const fired = useRef(false);
  useEffect(() => {
    if (won && !fired.current) {
      fired.current = true;
      burstConfetti("big");
    }
  }, [won]);
  const myAwards = f.awards.filter((a) => a.playerIds.includes(me.id));
  return (
    <div className="flex flex-1 flex-col items-center gap-4 text-center" data-testid="final-phone">
      <p className="text-7xl">{won ? "👑" : "🎲"}</p>
      <h1 className="font-display text-4xl">{won ? (f.winnerIds.length > 1 ? "You tied for the win!" : "You won!") : `You finished #${mine?.rank}`}</h1>
      <p className="font-display text-3xl text-gold" data-testid="final-chips" data-chips={mine?.chips ?? 0}>
        <ChipAmount value={mine?.chips ?? 0} size={30} />
      </p>
      {myAwards.map((a) => (
        <div key={a.id} className="w-full rounded-2xl bg-ink-800/80 p-3">
          <p className="font-display text-xl">
            {a.emoji} {a.title}
          </p>
          <p className="text-sm text-cream/70">{a.description}</p>
        </div>
      ))}
      <p className="text-cream/60">The host can start a rematch from the main screen.</p>
    </div>
  );
}
