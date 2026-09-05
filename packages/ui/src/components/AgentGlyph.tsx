import type { AgentAccent } from "@stratosapp/core";

const ACCENT_CLASSES: Record<AgentAccent, string> = {
  violet:
    "bg-[color:color-mix(in_oklab,#7c6ed6_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#7c6ed6)]",
  emerald:
    "bg-[color:color-mix(in_oklab,#4b9e72_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#4b9e72)]",
  blue: "bg-[color:color-mix(in_oklab,#6084d1_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#6084d1)]",
  pink: "bg-[color:color-mix(in_oklab,#c26a95_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#c26a95)]",
  orange:
    "bg-[color:color-mix(in_oklab,#c1804a_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#c1804a)]",
  amber:
    "bg-[color:color-mix(in_oklab,#be9b3c_16%,transparent)] text-[color:color-mix(in_oklab,var(--text-primary)_76%,#be9b3c)]",
};

const ACCENT_SWATCH_CLASSES: Record<AgentAccent, string> = {
  violet: "bg-[#7c6ed6]",
  emerald: "bg-[#4b9e72]",
  blue: "bg-[#6084d1]",
  pink: "bg-[#c26a95]",
  orange: "bg-[#c1804a]",
  amber: "bg-[#be9b3c]",
};

/**
 * Turns a stored emoji or long agent name into a compact, readable monogram.
 * Existing one- or two-character lettermarks are kept as authored.
 */
function capGlyph(value: string): string {
  return Array.from(value.toLocaleUpperCase()).slice(0, 2).join("");
}

export function isAgentGlyph(value: string): boolean {
  return /^[\p{L}\p{N}]{1,2}$/u.test(value.trim());
}

export function getAgentGlyph(name: string, icon?: string): string {
  const stored = icon?.trim() ?? "";
  if (isAgentGlyph(stored)) return capGlyph(stored);

  const words = name
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length > 1) {
    return capGlyph(
      words
        .slice(0, 2)
        .map((word) => Array.from(word)[0])
        .join(""),
    );
  }

  return capGlyph(
    Array.from(words[0] ?? "AG")
      .slice(0, 2)
      .join(""),
  );
}

export function getAgentAccentClasses(accent: AgentAccent): string {
  return ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.blue;
}

export function getAgentAccentSwatchClass(accent: AgentAccent): string {
  return ACCENT_SWATCH_CLASSES[accent] ?? ACCENT_SWATCH_CLASSES.blue;
}

export function AgentGlyph({
  name,
  icon,
  accent,
  size = "small",
}: {
  name: string;
  icon?: string;
  accent: AgentAccent;
  size?: "small" | "large";
}): React.ReactElement {
  const sizeClass =
    size === "large"
      ? "h-10 w-10 rounded-[10px] text-[15px]"
      : "h-[19px] w-[19px] rounded-[5px] text-[10px]";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-semibold tracking-[0.02em] ${sizeClass} ${getAgentAccentClasses(accent)}`}
    >
      {getAgentGlyph(name, icon)}
    </span>
  );
}
