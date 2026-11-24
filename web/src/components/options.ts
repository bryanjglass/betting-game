/** Game-show colours for the four answer slots (A–D). */
export const OPTION_STYLES = [
  { letter: "A", bg: "bg-opt-a", text: "text-opt-a", border: "border-opt-a", hex: "#FF4F6D" },
  { letter: "B", bg: "bg-opt-b", text: "text-opt-b", border: "border-opt-b", hex: "#2F8CFF" },
  { letter: "C", bg: "bg-opt-c", text: "text-opt-c", border: "border-opt-c", hex: "#FFB627" },
  { letter: "D", bg: "bg-opt-d", text: "text-opt-d", border: "border-opt-d", hex: "#22C17A" },
] as const;

export function optionStyle(index: number) {
  return OPTION_STYLES[index] ?? OPTION_STYLES[0];
}
