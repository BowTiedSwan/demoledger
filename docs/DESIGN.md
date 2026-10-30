# Design

The visual language is Midday-inspired (D-25): calm warm neutrals, rounded corners, no shadows and an 8px grid. Hierarchy comes from size and colour, not weight. The single source of truth is the token block in `apps/web/src/styles/globals.css`; this page summarises it. Midday is AGPL-3.0, so **no Midday code, name, logo or assets** are used. Only the visual language was reimplemented.

## Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` | `#0d0d0d` | page |
| `--foreground` | `#121212` | `#fafafa` | text |
| `--card` | `#f7f6f3` | `#121212` | cards, user question bubble |
| `--muted` / `--secondary` | `#efeeea` | `#1c1c1c` | chips, subtle fills |
| `--muted-foreground` | `#5c5c5c` (6.8:1) | `#a3a3a3` (7.9:1) | secondary text |
| `--accent` | `#e7e5e0` | `#262626` | hover, selection |
| `--primary` | `#121212` | `#fafafa` | primary buttons |
| `--border` | `#e2e0da` | `#242424` | dividers |
| `--input` | `#8a8882` | `#6b6b6b` | form control edges (3:1) |
| `--destructive` | `#b3001b` (7.5:1) | `#ff7a8a` | errors, always with text or an icon |
| `--warning` | `#7a4a00` (7:1) | `#f0b45a` | answer-check warnings |
| `--success` | `#146c2e` (6.4:1) | `#6fd08c` | success states |
| `--row-alt` | `#faf9f7` | `#101010` | zebra rows |
| `--chart-1` … `--chart-4` | `#121212` `#8a8882` `#b3001b` `#146c2e` | `#fafafa` `#7a7a7a` `#ff7a8a` `#6fd08c` | chart series; also told apart by legend text |
| `--chart-grid` / `--chart-axis` | `#e2e0da` / `#5c5c5c` | `#242424` / `#a3a3a3` | chart grid and axis |

## Shape, type and motion

| Token | Value |
|---|---|
| `--radius` | `0.5rem`, on a scale of 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 px |
| Shadows | none (`--shadow-*: none`) |
| Spacing | 8px grid (`--spacing-unit`) |
| Sans | Hedvig Letters Sans (`@fontsource/hedvig-letters-sans`, bundled, regular weight), falling back to `system-ui` |
| Mono | `ui-monospace, monospace`, 13px for IDs, amounts and code |
| Type scale | display 40 · heading 28 · body 16 · mono 13, all one weight |
| Motion | `ease` |
| Themes | light by default; dark via the theme toggle (class on `<html>`) |

## Chat layout
- **User question:** a rounded bubble (`--card`).
- **Assistant answer:** plain text with no container.
- **Tool and reasoning steps:** borderless inline rows, such as "Searching transactions".
- **Sources:** chips linking to `/transactions?id=…`.
- **Warnings and errors:** soft callouts.
- **Visual answers:** `data-visual` renders as a chart, table or stat from the fixed catalog (ADR 0009).
- **Navigation:** ⌘K / Ctrl+K opens the command menu; there is no header ⌘ button.
