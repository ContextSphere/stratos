# Classic and Refined

Classic preserves the appearance and controls from before the redesign
(`49201dc`). Refined provides the new presentation. The desktop defaults to
Classic when no preference is saved; the UI library's unwrapped default is
Refined. Desktop callers should always provide `DesignProvider`.

## Where changes belong

- Palette values live in `packages/desktop/src/renderer/styles/design-tokens.css`.
  Selectors scope each design independently of light/dark color mode.
- State, provider/model definitions, and operations should be shared wherever
  their behavior is the same. A bug fix should reach both presentations.
- Keep separate markup when the controls differ, such as Classic's segmented
  permission buttons and Refined's menu. Tailwind classes remain appropriate
  for local layout; moving every class into CSS is unnecessary.
- A Refined component must not contain fallback Classic styling. Choose the
  presentation at its public component boundary or in a shared component's
  explicit layout branch.

## Reviewing changes

Check both designs through the public components. Exercise drafts, attachments,
model/provider switching, and mid-turn actions when changing shared behavior.
Verify the affected screens with Chrome DevTools in both designs. Palette
changes also need a light/dark check. Classic must retain its original colors,
spacing, labels, and controls unless a separate change explicitly authorizes
altering them.
