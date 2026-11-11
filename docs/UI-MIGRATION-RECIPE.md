# UI migration recipe (read before editing a screen)

The design system is `src/theme.ts`; the kit is `src/ui/`. Every screen must compose the kit. Do not invent local buttons, cards, headers, sheets, dialogs or empty states.

## Non-negotiables

- **Logic is frozen.** Keep every hook, query, callback, route param, navigation call (route names never change), permission, TDLib call, upload and DB write exactly as it is. This is a visual migration.
- **Never edit** `src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/db/schema.ts`, `src/db/index.ts`, `app.config.ts`, `src/lib/uploader.ts`, or anything in `../photogram-bot`.
- **No new dependencies.** Do not touch `package.json`.
- **No raw hex** in the screen. Use `theme.colors.*`. No one-off `fontSize`; use `<AppText variant="…">` or `theme.typography.*`.
- **No `Alert.alert`** for decisions. Use `confirmDialog({ title, message, confirmLabel, destructive? })` for destructive/multi-choice and `alertDialog({ title, message })` for information. OS-level confirmations stay native.
- **No `<Modal>`** — use `<Sheet visible onClose title subtitle footer scroll>` for bottom sheets and `<Dialog>` via the helpers for confirmations.
- **No `<Text>` from react-native** in the screen. Use `AppText`.
- **48dp touch targets.** `Button`, `IconButton`, `ListRow`, `ToggleRow`, `Chip` already comply. `IconButton`/`Button` with `size="sm"` add hitSlop.
- **Accessibility:** every pressable gets `accessibilityRole` + `accessibilityLabel` (icon-only MUST have a label), plus `accessibilityState` (`disabled`, `selected`, `checked`, `busy`) where relevant. Images that are decoration get `accessible={false}`. Lists announce meaningful labels (date + status), not "image".
- **States:** every data screen renders loading (Skeleton, never blank), empty (`EmptyState` with why + one action), error (`ErrorState` with retry), and partial/offline copy where relevant. Keep existing behaviour when there is no error path; add a `loadError` state with retry rather than swallowing into `[]`.
- **i18n:** shared labels (Cancel, Save, Retry, Back, Search, Delete, Loading, statuses) come from `t()` / `tf()` in `src/lib/i18n.ts`. Do not add new keys unless needed; if you do, add both `en` and `hi`.
- **Reduced motion:** do not add decorative animations. Press feedback comes from `PressableScale`/`Button` and respects reduced motion. No spins/bounces.
- **No nested card soup.** Group rows in `Section` (tonal card, no border). Space separates groups.
- **Danger at the bottom**, isolated in a `Section danger` or a distinct area.
- **Preserve file exports and default props.**

## Kit (import from `../ui`)

```tsx
import {
  Screen, AppBar, AppText, Section, ListRow, ToggleRow,
  Button, IconButton, Chip, Segmented, Input,
  Sheet, Dialog, EmptyState, ErrorState, Skeleton, GallerySkeleton,
  ProgressBar, Stat, Badge, StatusBadge, MediaTile,
  confirmDialog, alertDialog,
} from "../ui";
```

- `<Screen scroll padded edges={["top"]}>` — safe area, background, status bar. Use `scroll` for utility screens; for grid screens use `<Screen>` then a `FlashList`.
- `<AppBar title subtitle large onBack actions={...} bottom={...} />` — one header pattern. `large` for screen titles; compact for sub-screens if space is tight. Back label from `t("common.back")`.
- `<Section title icon subtitle footer action card danger>` — a group. Rows inside are `ListRow` without dividers.
- `<ListRow title subtitle icon leading trailing accessory="chevron" onPress onLongPress disabled danger selected />`.
- `<ToggleRow title subtitle value onValueChange disabled />` — whole row is the switch for TalkBack.
- `<Button label onPress variant="primary|secondary|ghost|danger|quiet" size="sm|md|lg" icon loading disabled fullWidth />`.
- `<IconButton icon label onPress variant="plain|tonal|accent|onMedia|danger" size={40|48} />` — `label` is required.
- `<Chip label selected onPress />`, `<Segmented options value onChange />`.
- `<Input label hint error icon trailing multiline />`.
- `<Sheet visible onClose title subtitle footer scroll>…</Sheet>`.
- `<EmptyState icon title body actionLabel onAction />`, `<ErrorState title body retryLabel onRetry />`.
- `<Skeleton width height radius label />` for loading rows; `<GallerySkeleton />` for photo grids.
- `<Stat value label icon tone />`, `<Badge label tone icon />`, `<StatusBadge status="local|queued|uploading|synced|failed" />`.
- `<MediaTile uri aspectRatio onPress onLongPress accessibilityLabel selected selectionMode favorite dateBadge status video />`.
- `<ProgressBar progress={0..1} label valueText live />`.

## Patterns

```tsx
// Loading → error → empty → content
{loadError ? <ErrorState … onRetry={load} /> : loading ? <Skeleton … /> : rows.length === 0 ? (
  <EmptyState icon="…" title="…" body="…" actionLabel="…" onAction={…} />
) : (
  <FlashList … />
)}
```

```tsx
// Destructive decision
const ok = await confirmDialog({
  title: t("gallery.trashTitle"),
  message: "…",
  confirmLabel: t("common.delete"),
  destructive: true,
});
if (!ok) return;
```

```tsx
// Grid row
<View style={{ flex: 1, margin: 1 }}>
  <MediaTile
    uri={row.thumb_uri}
    aspectRatio={1}
    status={row.state === "synced" ? null : row.state}
    onPress={…}
    accessibilityLabel={`${date}, ${statusLabel}`}
  />
</View>
```

## Styles

Use `StyleSheet.create` only for layout (flex, padding/gap via `theme.spacing`, radius via `theme.radius`, colors via `theme.colors`). `AppText` carries all type. Keep styles at the bottom.

## Verification

You cannot run the Android app. Do not claim visual verification. Keep the file compiling; the main agent runs `tsc` and `npm run probe` after the batch.
