/**
 * Poker-chip visuals: a top-down chip, a side-on animated chip stack whose
 * height tracks an amount, and an inline chip amount. Presentation only —
 * every number shown comes from the server.
 */
import { motion, useReducedMotion } from "framer-motion";
import { memo } from "react";
import { CHIPS } from "../../../shared/constants";

export const CHIP_COLORS = {
  red: { face: "#E63946", edge: "#A4161A" },
  blue: { face: "#3A86FF", edge: "#1D5FCC" },
  green: { face: "#2DC653", edge: "#1A8A39" },
  black: { face: "#26213D", edge: "#0B0720" },
  purple: { face: "#9B5DE5", edge: "#6A2FB8" },
  gold: { face: "#FFB703", edge: "#C98A00" },
} as const;
export type ChipColor = keyof typeof CHIP_COLORS;

const STACK_COLORS: ChipColor[] = ["red", "blue", "green", "black", "purple", "gold"];

export const PokerChip = memo(function PokerChip({
  color = "red",
  size = 48,
  label,
  className = "",
}: {
  color?: ChipColor;
  size?: number;
  label?: string;
  className?: string;
}) {
  const c = CHIP_COLORS[color];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <circle cx="50" cy="50" r="47" fill={c.face} stroke="#0B0720" strokeWidth="4" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="44" y="4" width="12" height="17" rx="2" fill="#FFF7E6" transform={`rotate(${i * 45} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="30" fill="none" stroke="#FFF7E6" strokeWidth="2.5" strokeDasharray="5 4" opacity="0.8" />
      <circle cx="50" cy="50" r="24" fill={c.edge} />
      {label ? (
        <text x="50" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill="#FFF7E6" fontFamily="Fredoka, sans-serif">
          {label}
        </text>
      ) : (
        <circle cx="50" cy="50" r="9" fill="#FFF7E6" opacity="0.85" />
      )}
    </svg>
  );
});

/** Number of chips drawn for an amount: one per 50, capped so stacks stay on screen. */
export function chipCountFor(amount: number, max = 30): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.min(max, Math.round(amount / CHIPS.wagerStep)));
}

/** A single chip seen from the side. */
function SideChip({ color, width }: { color: ChipColor; width: number }) {
  const c = CHIP_COLORS[color];
  return (
    <div
      className="rounded-[50%/40%] border-2 border-ink-900"
      style={{
        width,
        height: Math.max(8, width * 0.2),
        background: `repeating-linear-gradient(90deg, ${c.face} 0 ${width / 8}px, #FFF7E6 ${width / 8}px ${width / 8 + 5}px), ${c.face}`,
        boxShadow: `inset 0 -3px 0 ${c.edge}`,
      }}
    />
  );
}

/**
 * Side-on chip stack(s). Chips drop in one by one (staggered); columns of
 * `perColumn` chips sit side by side. `tone` tints the whole stack for win/lose.
 */
export function ChipStack({
  amount,
  chipWidth = 56,
  perColumn = 10,
  maxChips = 30,
  delay = 0,
  tone = "normal",
  testId,
}: {
  amount: number;
  chipWidth?: number;
  perColumn?: number;
  maxChips?: number;
  delay?: number;
  tone?: "normal" | "win" | "lose";
  testId?: string;
}) {
  const reduce = useReducedMotion();
  const count = chipCountFor(amount, maxChips);
  const columns = Math.ceil(count / perColumn);
  const chipH = Math.max(8, chipWidth * 0.2);
  const step = chipH * 0.62;
  return (
    <div
      className={`flex items-end justify-center gap-1 transition-[filter,opacity] duration-700 ${tone === "lose" ? "opacity-40 grayscale" : ""} ${tone === "win" ? "drop-shadow-[0_0_18px_rgba(61,220,132,0.9)]" : ""}`}
      style={{ minHeight: perColumn * step + chipH }}
      data-testid={testId}
      data-chips={count}
      aria-hidden
    >
      {Array.from({ length: columns }, (_, col) => {
        const inCol = Math.min(perColumn, count - col * perColumn);
        return (
          <div key={col} className="relative" style={{ width: chipWidth, height: perColumn * step + chipH }}>
            {Array.from({ length: inCol }, (_, i) => {
              const n = col * perColumn + i;
              return (
                <motion.div
                  key={n}
                  className="absolute left-0"
                  style={{ bottom: i * step, zIndex: i }}
                  initial={reduce ? false : { y: -260, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: delay + n * 0.035, type: "spring", stiffness: 520, damping: 26 }}
                >
                  <SideChip color={STACK_COLORS[Math.floor(n / 5) % STACK_COLORS.length]!} width={chipWidth} />
                </motion.div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** "🪙 1,250" style inline amount with a mini chip. */
export function ChipAmount({ value, className = "", size = 22 }: { value: number | string; className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${className}`}>
      <PokerChip color="gold" size={size} />
      {typeof value === "number" ? value.toLocaleString("en-US") : value}
    </span>
  );
}
