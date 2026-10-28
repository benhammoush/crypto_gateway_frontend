# Checkout design system

This module owns shared tokens, base styles and reusable components for the
checkout UI.

- `tokens.css` owns repeated visual values for this dark checkout.
- `base.css` owns global defaults, existing font loading and focus treatment.
- `styles.css` loads tokens, defaults and component CSS before `src/style.css`.
- `components/Notice.*` owns reusable notice presentation. Import `Notice` through
  `index.ts`; the caller supplies content, tone and any announcement role.

Payment state, verification, wallet interaction and the progress sequence remain
in `App.tsx`. A success-colored notice never decides whether a payment settled.
The checkout card, amount form, buttons and page layout remain product-owned;
there is no general-purpose control library or second theme to justify wrappers
or a provider. Isolated colors such as the active progress-step fill and badge
border stay with their product treatment; shared colors use the token file.

Keep component CSS colocated and shared defaults before feature overrides.
Preserve visual values during structural changes. Run `npm run check` and the
existing three-engine browser suite for affected checkout states and narrow/wide
layouts. Component tests cover native attributes and caller-owned semantics;
browser tests cover rendered token values. This is not payment-live or full
accessibility certification.
