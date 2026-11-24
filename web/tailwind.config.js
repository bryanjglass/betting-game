import { fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [here("./index.html"), here("./src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        // Shared with Fib Factory / Who Said That? so the games feel like one family.
        ink: { DEFAULT: "#120C2B", 900: "#0B0720", 800: "#1A1240", 700: "#251A57", 600: "#33256F", 500: "#4A3A94" },
        cream: { DEFAULT: "#FFF7E6", 200: "#FFEFCC" },
        pop: {
          yellow: "#FFD23F",
          pink: "#FF4F8B",
          cyan: "#2DE1FC",
          green: "#3DDC84",
          red: "#FF5A5F",
          orange: "#FF9F1C",
          purple: "#9B6BFF",
        },
        // Betting Game specifics: card-table felt, gold, and poker-chip colours.
        felt: { DEFAULT: "#0E6B4E", dark: "#084431", light: "#16936B" },
        gold: { DEFAULT: "#FFC83D", deep: "#E09B00", light: "#FFE08A" },
        chip: { red: "#E63946", blue: "#3A86FF", green: "#2DC653", black: "#26213D", purple: "#9B5DE5", gold: "#FFB703" },
        opt: { a: "#FF4F6D", b: "#2F8CFF", c: "#FFB627", d: "#22C17A" },
      },
      fontFamily: {
        display: ['"Fredoka"', "ui-rounded", "system-ui", "sans-serif"],
        body: ['"Nunito"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        pop: "0 6px 0 0 rgba(0,0,0,0.35)",
        "pop-sm": "0 3px 0 0 rgba(0,0,0,0.35)",
        glow: "0 0 40px 6px rgba(255,200,61,0.55)",
        "glow-green": "0 0 34px 8px rgba(61,220,132,0.7)",
        "glow-red": "0 0 34px 8px rgba(255,90,95,0.7)",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "15%,55%": { transform: "translateX(-10px) rotate(-2deg)" },
          "35%,75%": { transform: "translateX(10px) rotate(2deg)" },
        },
        marquee: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        spinSlow: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        floaty: "floaty 3s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        shake: "shake 0.6s ease-in-out 2",
        marquee: "marquee 0.9s steps(2) infinite",
        "spin-slow": "spinSlow 12s linear infinite",
      },
    },
  },
  plugins: [],
};
