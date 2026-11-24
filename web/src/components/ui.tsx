import { AnimatePresence, motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useGame } from "../store/gameStore";
import { PokerChip } from "./Chips";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gold text-ink hover:brightness-105",
  success: "bg-pop-green text-ink hover:brightness-105",
  secondary: "bg-ink-600 text-cream hover:bg-ink-500",
  danger: "bg-pop-red text-white hover:brightness-105",
  ghost: "bg-transparent text-cream/80 hover:bg-white/10 shadow-none",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = {
    sm: "px-3 py-1.5 text-sm rounded-xl",
    md: "px-5 py-2.5 text-base rounded-2xl",
    lg: "px-6 py-3.5 text-lg rounded-2xl",
    xl: "px-8 py-5 text-2xl rounded-3xl",
  };
  return (
    <button
      className={`select-none font-display font-semibold shadow-pop-sm transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border-2 border-white/10 bg-ink-800/80 p-5 ${className}`}>{children}</div>;
}

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) {
  const px = { sm: 22, md: 34, lg: 58, xl: 104 }[size];
  return (
    <div className="inline-flex select-none items-center gap-[0.35em] font-display font-bold leading-none" style={{ fontSize: px }} aria-label="The Betting Game">
      <PokerChip color="red" size={px * 1.45} className="-rotate-12 drop-shadow-lg motion-safe:animate-[spinSlow_14s_linear_infinite]" />
      <span className="flex flex-col">
        <span className="text-[0.42em] uppercase tracking-[0.35em] text-cream/80">The</span>
        <span className="text-foil -mt-[0.05em] uppercase tracking-wide drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">Betting Game</span>
      </span>
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-left font-semibold shadow-pop-sm ${
              t.kind === "error" ? "bg-pop-red text-white" : t.kind === "success" ? "bg-pop-green text-ink" : "bg-ink-600 text-cream"
            }`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ConnectionBanner() {
  const status = useGame((s) => s.status);
  const hasView = useGame((s) => !!s.view);
  if (status === "open" || (!hasView && status === "connecting")) return null;
  if (status === "notFound" || status === "kicked") return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3" role="status" data-testid="reconnecting">
      <div className="flex items-center gap-2 rounded-full bg-pop-orange px-4 py-2 font-display font-semibold text-ink shadow-pop-sm">
        <span className="inline-block h-3 w-3 animate-ping rounded-full bg-ink" /> Reconnecting…
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 p-10 text-cream/70" role="status">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-gold" />
      <span className="font-display text-lg">{label}</span>
    </div>
  );
}

export function phaseLabel(phase: string): string {
  return (
    {
      lobby: "Lobby",
      betting: "Place Your Bets",
      wagerReveal: "The Big Bet Reveal",
      answerReveal: "Answer Reveal",
      scoreboard: "Leaderboard",
      gameOver: "Final Results",
    } as Record<string, string>
  )[phase] ?? phase;
}

export function formatChips(n: number) {
  return n.toLocaleString("en-US");
}

export function signedChips(n: number) {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : "−"}${formatChips(Math.abs(n))}`;
}
