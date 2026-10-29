# Nox frontend design system

The frontend follows the visual language of the supplied Linear references
without copying Linear branding or proprietary assets. It is intentionally
quiet, dense, and operational: hierarchy comes from alignment, type, and
small shifts in surface tone rather than cards, gradients, or decoration.

## Tokens

- **Canvas:** `#0c0d0e`; navigation uses `#101112`; content surfaces use
  `#131516` and raised panels use `#181a1c`.
- **Borders:** `#202326` for separators and `#282b2e` for interactive or
  container boundaries. Borders are one pixel and low contrast.
- **Text:** `#e7e8e9` primary, `#92979d` secondary, and `#656b71` tertiary.
- **Semantic color:** green is reserved for allowed/success/connected, red for
  denied/error, and amber for approval states that need attention. Semantic
  colors are paired with text, not used as decoration.

## Typography and layout

- The interface uses a compact system sans stack for reliable local rendering.
- Page titles are 22px and medium weight. Body and table text is 12–13px.
- Technical identifiers use a small monospace face.
- The shell uses a 224px navigation rail, a 52px top bar, and a centered
  content measure with 44px desktop gutters.
- Common controls are 31px high. Rows are 58px high to support dense scanning
  while preserving a comfortable pointer target.

## Components and states

- **Navigation:** fixed, quiet, and separated from content by one divider.
  The active item uses a slightly lighter surface and a short edge indicator.
- **Tables:** headers are uppercase and dim; rows use separators, not cards.
  Hover and keyboard focus use a small surface lift.
- **Badges:** compact tinted labels are used only for decision, outcome, and
  approval states.
- **Dialogs/panels:** detail views enter from the right as a full-height,
  bordered panel with a dark backdrop. They preserve the page context.
- **Forms:** inputs are borderless within a toolbar; select controls and
  buttons gain borders only where their affordance needs definition.
- **Loading:** low-contrast row skeletons communicate structure without
  introducing a spinner as the primary content.
- **Empty/error:** a concise icon, explanation, and next-step configuration
  preserve the operational context. Empty data is never replaced with fake
  metrics or sample events.
- **Focus:** all interactive controls use a visible two-pixel blue-gray
  outline. Rows are keyboard focusable and open the same detail panel as a
  pointer click.
- **Responsive:** the rail becomes an off-canvas menu below 800px. Tables
  remain readable through horizontal scrolling rather than collapsing
  security-relevant columns.

## Data boundary

The audit page reads `NOX_AUDIT_FILE` through the Next.js server route
`/api/audit`. The adapter accepts only the existing `AuditEvent` fields:
timestamp, tool, decision, outcome, approval, and reason. It never reads or
returns tool arguments, results, tokens, credentials, or upstream commands.
The route is read-only and has no gateway control privileges.

This local-file adapter is a development foundation, not a production
authentication or authorization layer. Before exposing the frontend beyond a
trusted local environment, the next integration should add an authenticated
control-plane API with explicit operator authorization, pagination, and
retention semantics. The MCP Streamable HTTP endpoint must not be used as a
dashboard API.
