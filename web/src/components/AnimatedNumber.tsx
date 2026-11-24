import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";

/**
 * Counts up/down to `value` (optionally starting from `from`, after `delay`
 * seconds). Purely cosmetic — the final number is always the server's.
 */
export function AnimatedNumber({
  value,
  from,
  delay = 0,
  className = "",
  duration = 1.2,
}: {
  value: number;
  from?: number;
  delay?: number;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : (from ?? value));
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, delay, ease: "easeOut" });
    return () => controls.stop();
  }, [value, reduce, mv, duration, delay]);
  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}
