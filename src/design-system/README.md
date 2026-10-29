# Checkout design system

This module exposes the standard Ant Design components used by the demo through
`index.ts`. Ant Design 5 owns the default white/blue palette, typography, component
tokens, focus treatment and controls. `main.tsx` mounts its `ConfigProvider` and
`App` context, with CSS variables enabled and interaction motion disabled. The light
layout surface and card radius are configured through Ant tokens; headers stay
white. A small set of product CSS accents styles the title, icons and link handoff.
Status tags and receipt alerts retain Ant Design's standard semantic colors.

The demo places the business cart, a small link handoff and customer checkout in
a centered responsive grid, stacked in that order on mobile. Ant Design owns the
cards, forms, buttons and spacing. The created business form becomes inert, with a
centered status overlay. The customer panel shows faded placeholders until creation.
Both panels use the same non-interactive status-card template: a clock and waiting
message before creation, a lock and share-ready message afterward.
Steps span the layout below both roles: checkout creation, wallet approval and
on-chain verification. The underlying submission and settlement events remain
distinct, but their labels appear in the receipt rather than adding redundant steps.
Only backend settlement completes the verification step. Customer links never show business controls.
The network Select locks after creation and clearly disables unsupported Mainnet.

Ant Design Web3 supplies presentation-only `Address`; abbreviated addresses remain
copyable in full. Amounts display the exact backend quote without number coercion,
and transaction links explicitly select Solana Devnet rather than EVM defaults.
No Solana wallet adapter or Wagmi provider is installed. The existing Phantom sender,
capability storage, quote validation and duplicate-submission guards remain product code.
Connection, submission and settlement are distinct states; only backend settlement
may display payment success.

After submission, an Ant Design Modal presents transaction details over the faded
checkout. Escape, the close control and the footer button dismiss it; a dedicated
status button reopens it. Focus returns to that button. Closing or reopening the
modal never clears submission guards or restarts wallet approval. Backend-verified
success uses a success alert and icon rather than the informational submission state.
Refresh and receipt-reopen controls live beside the progress heading; the modal
retains a refresh action while payment verification is pending.

`styles.css` loads minimal global defaults from `base.css`. Product geometry,
approved title/card accents and address wrapping live in `src/style.css`. Scoped
CSS also centers the three native Steps columns and styles Ant's generated copy
button; the library retains their keyboard, feedback and interaction behavior.
Prefer library layout props for other spacing. The footer credits the component
library, not authorship of the product.

Run the quality gate and three-engine browser suite for affected states, keyboard
navigation and narrow/wide layouts. These are fixture-based checks, not a live payment
attempt or physical-device certification.
