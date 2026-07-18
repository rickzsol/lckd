# Design Brief: Token Page + Launch Wizard Polish

## Scope
1. `/token/lckd` (OfficialTokenClient) and `/token/[id]` (TokenDetailClient): too narrow on large screens (1180px / 1152px shells inside huge gutters), large dead regions in pending states (empty 400px chart box, hollow swap card).
2. `/launch` wizard: form floats on raw bg, double progress indicator (circle stepper + bar), tiny 90px upload square next to empty space, loose vertical rhythm.

## Direction
Pro-minimal per Vault Green v1.0. No new effects, no new colors. Fix proportion, rhythm, and empty states.

- Shell: widen both token pages to `max-w-[1360px]` with `lg:px-10`; scale header padding, stat cells, and chart heights with the width so content grows instead of gutters.
- Sidebar column: 380px on lg, 420px on xl so the chart does not swallow the swap/lock cards.
- Empty states get the mascot (allowed slot) plus one calm line; no dead 400px voids with a lone tilde.
- Wizard: content lives in a `rounded-modal` surface card; one progress indicator (the circle stepper, refined); upload becomes a full-width dropzone row; preview becomes a structured row with replace/remove.

## Non-goals
No IA changes, no new sections, no copy rewrites beyond empty states, no motion additions.
