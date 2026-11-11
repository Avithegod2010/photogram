# Photogram UI System — "Quiet Archive"

One token source: `src/theme.ts`. One component kit: `src/ui/`. Every screen composes both.
Design rule: **photos are the interface; chrome recedes**.

Dark-first on purpose. The app is used in the dark, next to a camera roll, and one excellent
dark theme beats two mediocre ones. A light theme is deliberately out of scope for this pass.

---

## 1. Palette — Warm archive

Grounded in paper, ink and clay rather than the default blue. The accent is warm so it reads as
"selected / act here" without competing with photo colour.

| Token | Value | Usage |
| --- | --- | --- |
| `colors.background` | `#0F0E0C` | App canvas, tab scenes |
| `colors.surface` | `#171512` | Tab bar, floating selection bar |
| `colors.surfaceContainer` | `#1E1B17` | Cards, sheets, rows |
| `colors.surfaceHighest` | `#26221C` | Inputs, thumbnails, pressed rows |
| `colors.surfaceHover` | `#2F291F` | Ripple / pressed row tint |
| `colors.overlay` | `rgba(15,14,12,0.92)` | Floating gallery header over photos |
| `colors.scrim` | `rgba(0,0,0,0.66)` | Dialog / sheet backdrop |
| `colors.onSurface` | `#F2EDE4` | Primary text (16.7:1 on background) |
| `colors.onSurfaceVariant` | `#B8B0A3` | Secondary text (9.0:1 on background) |
| `colors.onSurfaceFaint` | `#8E8679` | Hints, captions (5.3:1 — still body-safe) |
| `colors.outline` | `#3A342B` | Decorative dividers only |
| `colors.outlineStrong` | `#746A5B` | Interactive boundary (3.26:1 on container) |
| `colors.accent` | `#E0A45C` | Action, selection, focus, links — nothing else |
| `colors.accentPressed` | `#C98B47` | Accent pressed state |
| `colors.onAccent` | `#1A1208` | Text/icons on accent (8.5:1) |
| `colors.accentSoft` | `rgba(224,164,92,0.14)` | Selected chips, icon-button tint |
| `colors.onAccentSoft` | `#F2C48C` | Text on the soft accent |
| `colors.success` | `#8FD6A8` | Backed up / healthy |
| `colors.warning` | `#F2C14E` | Queued / attention |
| `colors.error` | `#FF8A80` | Failure / destructive |
| `colors.errorSoft` | `rgba(255,138,128,0.13)` | Error fills |
| `colors.viewer` | `#000000` | Full-screen media canvas |
| `colors.onViewer` | `#FFFFFF` | Viewer chrome |
| `colors.mediaScrim` | `rgba(0,0,0,0.55)` | Badges over photos |

Legacy keys (`primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`,
`secondaryContainer`, `onSecondaryContainer`, `errorContainer`, `onErrorContainer`,
`outlineVariant`) remain as aliases so old code keeps compiling; new code uses the role names.

**Contrast policy:** body text ≥ 4.5:1; large text and meaningful UI boundaries ≥ 3:1.
`outline` is decorative and never the only way to identify a control — inputs have labels and
filled surfaces. Verified pairings are noted above.

---

## 2. Type scale

System sans only (no font dependency). Eight sizes, four weights, no half-points.

| Preset | Size / line height / weight | Usage |
| --- | --- | --- |
| `display` | 32 / 38 / 700 | Year, Wrapped hero numbers |
| `title1` | 24 / 30 / 700 | Tab-root screen titles, album title |
| `title2` | 20 / 26 / 600 | Dialog titles, section heroes |
| `title3` | 17 / 24 / 600 | Sheet titles, card headings |
| `bodyLarge` | 17 / 24 / 400 | Reader-style body, big labels |
| `body` | 15 / 21 / 400 | Default body, row titles |
| `bodyStrong` | 15 / 21 / 600 | Emphasised body |
| `callout` | 13 / 18 / 500 | Section headers, chips |
| `footnote` | 13 / 18 / 400 | Row subtitles, help text |
| `caption` | 12 / 16 / 500 | Metadata, badges |
| `captionRegular` | 12 / 16 / 400 | Dense help text |
| `caption2` | 11 / 16 / 500 | Tab labels, tile dates |
| `overline` | 11 / 16 / 600 | Reserved; not used for section headers |

Weights: `400 regular`, `500 medium`, `600 semibold`, `700 bold`. Nothing heavier.
Section headers are **13/600 `onSurfaceVariant`**, not uppercase, not accent.

A serif display face was evaluated and rejected for this pass: it cannot be verified at 200%
font scale on a device here, and Android's serif is inconsistent across OEMs. Sans is the
conservative, native choice.

---

## 3. Spacing, radius, layout

| Token | Value | Usage |
| --- | --- | --- |
| `spacing.xs` | 4 | Icon/label gaps |
| `spacing.sm` | 8 | Tight groups, chip gaps |
| `spacing.compact` | 12 | Row padding, control gaps |
| `spacing.md` | 16 | Screen gutters, card padding |
| `spacing.lg` | 24 | Section gaps, sheet padding |
| `spacing.xl` | 32 | Empty-state breathing room |

| Radius | Value | Usage |
| --- | --- | --- |
| `radius.thumb` | 4 | Photo tiles |
| `radius.control` | 12 | Inputs, small cards, activity tiles |
| `radius.card` / `radius.sheet` | 20 | Cards, sheets, floating bars |
| `radius.pill` | 999 | Buttons, chips, icon buttons |

| Layout | Value |
| --- | --- |
| `layout.touch` | 48dp minimum |
| `layout.icon` | 24dp |
| `layout.appBar` | 56dp |
| `layout.row` | 60dp |
| `layout.tabBar` | 56dp + safe area + font-scale growth |

---

## 4. Motion

| Token | Value | Usage |
| --- | --- | --- |
| `motion.duration.fast` | 120ms | Press feedback |
| `motion.duration.base` | 180ms | State / chrome show-hide |
| `motion.duration.slow` | 240ms | Sheet entrance |
| `motion.easing.standard` | cubic-bezier(0.2, 0, 0, 1) | Interruptible state changes |
| `motion.easing.enter` | cubic-bezier(0.23, 1, 0.32, 1) | Entrances |
| `motion.easing.exit` | cubic-bezier(0.4, 0, 1, 1) | Exits |

Rules:
- Press scale 0.97 (buttons) / 0.92 (icon buttons), contents only, hit area unchanged.
- No 360° spins, no bouncing tab icons, no wiggle. The tab glyph settles at 1.05 over 120ms.
- No entrance animation on tab screens (they are used dozens of times a day).
- Sheets slide up 240ms and can be dragged down; reduced motion switches to an instant state.
- One signature moment per screen at most (Memories shelf, Wrapped hero).

---

## 5. Elevation

Tonal surfaces first. Shadows only for floating chrome and sheets.

| Token | Usage |
| --- | --- |
| `elevation.floating` | Tab bar, selection bar, floating header, "Top" chip |
| `elevation.sheet` | Bottom sheets, dialogs |

Cards are `surfaceContainer` on `background`; they do **not** have borders.

---

## 6. Status vocabulary

Never colour alone. Every status = icon + label + colour.

| Status | Colour | Icon | Label key |
| --- | --- | --- | --- |
| `local` | `#8E8679` | `phone-portrait` | `status.local` |
| `queued` | `#F2C14E` | `time` | `status.queued` |
| `uploading` | `#E0A45C` | `cloud-upload` | `status.uploading` |
| `synced` | `#8FD6A8` | `cloud-done` | `status.synced` |
| `failed` | `#FF8A80` | `alert-circle` | `status.failed` |

Use `<StatusBadge status="…" />` wherever there is room for text;
`<MediaTile status="…" />` puts the icon on a tile and speaks the label through
`accessibilityLabel`.

---

## 7. Component inventory (`src/ui/`)

| Component | Purpose | Key rules |
| --- | --- | --- |
| `Screen` | Safe area + background + optional scroll | `edges`, `padded`, `scroll` |
| `AppBar` | One header | 48dp back, 24/20 title, `actions`, `bottom`; actions move to their own row above fontScale 1.4 |
| `AppText` | All text | `variant` from the scale; no raw fontSize |
| `OfflineNotice` | Quiet offline line | local data still works; backups are paused |
| `Section` | Group heading + tonal card | One group icon, no row dividers |
| `ListRow` | 60dp row | `icon`, `leading`, `trailing`, `accessory`, `selected` |
| `ToggleRow` | Whole-row switch | Row is the accessible switch |
| `Button` | Actions | primary/secondary/ghost/danger/quiet, loading |
| `IconButton` | Icon-only action | `label` required; 40dp visual + hitSlop |
| `Chip` | Filters and selections | 40dp visual + hitSlop, selected state |
| `Segmented` | Mutually exclusive control | tablist semantics |
| `Input` | Filled text field | label/hint/error, focus ring |
| `Sheet` | Bottom sheet | drag-to-dismiss, reduced motion, modal focus |
| `Dialog` | Confirmation | replaced Alert.alert for in-app decisions |
| `DialogHost` | Global dialog queue | mounted once in `App.tsx` |
| `EmptyState` | Why + next action | one primary action |
| `ErrorState` | What happened + retry | role=alert |
| `Skeleton` / `GallerySkeleton` | Loading layout | pulses; reduced motion static |
| `ProgressBar` | Determinate progress | accessibilityValue + live region |
| `Stat` | Number + label | tabular figures |
| `Badge` / `StatusBadge` | Small state labels | icon + text + colour |
| `MediaTile` | One photo tile | radius 4, favourite/date/status/video overlays |

---

## 8. Screen rules

1. **One focal point.** Gallery: the grid. Viewer: the photo. Settings: the upload status.
   Utility screens: the list.
2. **Chrome is quieter than content.** No accent on headers, no borders on cards, no decorative
   dots or emoji in chrome.
3. **At most three visual weights compete.** Title, body, muted. The accent appears once per
   screen region.
4. **No card inside a card.** Use `Section` once; rows are flat.
5. **Space, not borders.** Dividers only for metadata lists that need scan lines.
6. **Danger lives at the bottom**, isolated, with a destructive confirmation.
7. **Every data screen** has loading / empty / error / offline / permission / partial states,
   even if some are a single quiet line.
8. **Edge-to-edge media** has no card around it. Gallery and Album grids sit on the background.

---

## 9. Accessibility contract

- Every Pressable: `accessibilityRole`, `accessibilityLabel` (icon-only required),
  `accessibilityState` (`disabled`, `selected`, `checked`, `busy`).
- Decorative images/icons: `accessible={false}` / `importantForAccessibility="no"`.
- 48×48dp minimum; `hitSlop` only extends, never replaces.
- Font scaling stays on. No screen may clip at 200%.
- Tab bar grows with `fontScale` instead of clipping labels.
- TalkBack flows that must work end-to-end:
  1. Scan library → back up → confirm heartbeat.
  2. Find a photo → favourite → share.
  3. Delete → trash → restore.
- Progress: `accessibilityRole="progressbar"` + `accessibilityValue` + polite live region.
- Counts use `tCount(baseKey, count)` so singular/plural and thousands separators are correct.
- At OS font scale > 1.4 `AppBar` moves actions to a second row instead of squeezing the title.
- Sheets and dialogs: native modal focus, title is the accessible header; long content scrolls.
- Reduce motion: `useReducedMotion` disables non-essential movement (sheets, press scale,
  skeleton pulse, tab scale).
- Colour is never the only signal.

---

## 10. Static guard

`scripts/probe/static-checks.cjs` fails the probe on:
- raw hex colours under `src/screens`, `src/components`, `src/ui`
- one-off `fontSize` under the same trees
- missing legacy theme tokens (kept for compatibility)
- expo-media-library import mistakes and widget-plugin regressions

It warns (does not fail) on remaining `Alert.alert` calls so they can be migrated deliberately.

---

## 11. Migration status

See `docs/UI-PROGRESS.md` for the per-screen checklist.
