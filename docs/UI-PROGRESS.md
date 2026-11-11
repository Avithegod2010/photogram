# UI overhaul progress — Quiet Archive

Status: **migration complete**, verification green (probe + static + tsc); device screenshots
blocked (no adb/emulator on this machine).

A screen counts as **done** only when it uses the shared
`Screen`/`AppBar`/`Section`/`ListRow`/`Button`/states kit, has no raw hex or one-off font size,
and has accessible controls.

## Core 8 (highest bar)

| Screen | Status | Notes |
| --- | --- | --- |
| Gallery | done | edge-to-edge grid, floating auto-hiding chrome, skeleton, empty/error, heartbeat, queue feedback, selection bar, scan + first-run |
| Collections | done | 4 groups + one icon per group, searchable, smart albums/docs as sections, no dots |
| Settings | done | grouped sections, 13/600 headers, toggles, 2-column stats, health/trust surfaces, danger at bottom |
| Viewer | done | black canvas, auto-hiding chrome, 4 primary actions + sheet, info/notes/tags sheets, cloud-only video state |
| Album | done | AppBar, count, topics/grouping chips, activity strip, cover/request/share sheets |
| Albums | done | 2-column covers, lock/pin actions, loading/empty/error |
| Login | done | visual-only restyle; auth calls untouched |
| People | done | list/person view, selection + split bar, candidates, rename sheet, merge flow |

## Foundation / shell

| Item | Status |
| --- | --- |
| `src/theme.ts` token system | done |
| `src/ui/` kit + index (22 files) | done |
| RootTabs (correct icons, 48dp, no spins) | done |
| Global DialogHost + confirm/alert helpers | done |
| Memories carousel | done |
| Navigation background/transitions | done |
| Static guard (raw hex, fontSize, Alert warning) | done |

## Remaining screens

All 38 screens are migrated:

| Screen | Status |
| --- | --- |
| PeopleSetup | done |
| Favorites, Archive, Hidden, Trash | done |
| DocAlbum, Scenes, Highlights, Journal | done |
| ThenNow, Map, CollectionsPlaceholder, GalleryPlaceholder | done |
| Similar, DuplicateMerge, FaceCorrections, Diagnostics | done |
| Storage, FreeUpSpace, SavedSearch, AlbumRules | done |
| ErrorBoundary (component) | done (plain RN fallback, no Reanimated dependency) |
| JunkSweeper, Export, Migrate, SafetyCheck, SharedAlbums | done |
| Story, Slideshow, Wrapped, Edit | done |

## Verification gates

- [x] `tsc --noEmit` clean
- [x] `npm run probe` ALL GREEN (322 probe checks + 69 static checks + tsc)
- [x] Static guard: no raw hex / fontSize under `src/screens`, `src/components`, `src/ui`
- [x] No in-app `Alert.alert` left in `src/screens` (only the protected uploader's OS-level pause alert)
- [x] No raw `<Modal>` in screens (only `src/ui/Dialog.tsx` and `src/ui/Sheet.tsx`)
- [x] Accessibility sweep (roles, labels, 48dp, font scale growth, reduced motion)
- [x] `break-ui` worst-case pass (static reasoning + fixes; no renderer available)
- [ ] Device/emulator screenshots — **blocked: no adb/emulator on this machine**

## Known follow-ups

- Device verification at font scale 1.0 and 2.0, portrait/landscape.
- Hindi pass 3: secondary screens' explanatory copy is still English (shared labels are translated).
- TalkBack walk of the three required flows on hardware.
