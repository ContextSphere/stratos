import { Button } from "@stratosapp/ui";

/**
 * Live component gallery that reads CSS custom properties.
 * Automatically reflects the active theme — no props needed.
 */
export function ComponentGallery(): React.ReactElement {
  return (
    <div
      className="rounded-xl p-4 space-y-5 text-sm"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
      }}
    >
      {/* Color swatches */}
      <GallerySection label="Colors">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "bg-root", var: "--bg-root" },
            { label: "bg-main", var: "--bg-main" },
            { label: "bg-surface", var: "--bg-surface" },
            { label: "bg-overlay", var: "--bg-overlay" },
            { label: "border", var: "--border" },
            { label: "border-mid", var: "--border-mid" },
          ].map((swatch) => (
            <div key={swatch.var} className="flex flex-col items-center gap-1">
              <div
                className="w-10 h-10 rounded-lg"
                style={{
                  background: `var(${swatch.var})`,
                  border: "1px solid var(--border-mid)",
                }}
              />
              <span
                className="text-[10px] text-center leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {swatch.label}
              </span>
            </div>
          ))}
        </div>
      </GallerySection>

      {/* Typography */}
      <GallerySection label="Typography">
        <div className="space-y-1">
          <p style={{ color: "var(--text-primary)" }}>
            Primary text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            Secondary text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Muted text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-faint)" }}>
            Faint text — the quick brown fox
          </p>
          <code
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-overlay)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            monospace code sample
          </code>
        </div>
      </GallerySection>

      {/* Buttons */}
      <GallerySection label="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="secondary">Ghost</Button>
        </div>
      </GallerySection>

      {/* Inputs */}
      <GallerySection label="Input">
        <input
          type="text"
          placeholder="Type something…"
          className="w-full px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
          style={{
            background: "var(--bg-overlay)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
          readOnly
        />
      </GallerySection>

      {/* Badges */}
      <GallerySection label="Badges">
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: "Default",
              color: "var(--text-secondary)",
              bg: "var(--bg-overlay)",
            },
            { label: "Blue", color: "#60a5fa", bg: "rgba(59,130,246,0.15)" },
            { label: "Green", color: "#4ade80", bg: "rgba(34,197,94,0.15)" },
            { label: "Amber", color: "#fbbf24", bg: "rgba(251,191,36,0.15)" },
            { label: "Red", color: "#f87171", bg: "rgba(239,68,68,0.15)" },
          ].map((badge) => (
            <span
              key={badge.label}
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                background: badge.bg,
                color: badge.color,
                border: "1px solid var(--border)",
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </GallerySection>

      {/* Card surface */}
      <GallerySection label="Card surface">
        <div
          className="rounded-lg p-3 space-y-1"
          style={{
            background: "var(--bg-overlay)",
            border: "1px solid var(--border)",
          }}
        >
          <p
            className="text-xs font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Card title
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Supporting description text inside a surface card.
          </p>
        </div>
      </GallerySection>
    </div>
  );
}

function GallerySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}
