/**
 * QUIET ARCHIVE — the single source of visual truth.
 *
 * Direction: photos are the interface. Calm dark surfaces, one warm accent used
 * only for action/selection/focus, typography does hierarchy, space instead of
 * borders. Dark-first on purpose: a gallery app is used in the dark, and one
 * excellent dark theme beats two mediocre ones.
 *
 * Rules for new work:
 *  - Never write a raw hex value in a screen. Add a role here instead.
 *  - Use the six spacing steps and the type presets; no half-point font sizes.
 *  - Status is never colour alone: pair a status colour with an icon AND a label
 *    (see src/ui/StatusBadge.tsx).
 *
 * The legacy keys at the bottom of `colors` / `spacing` / `radius` are kept so
 * older screens keep compiling while they are migrated. Prefer the named roles.
 */

export const palette = {
  // Warm archive
  ink0: "#0F0E0C",
  ink1: "#171512",
  ink2: "#1E1B17",
  ink3: "#26221C",
  ink4: "#2F291F",
  sand0: "#F2EDE4",
  sand1: "#B8B0A3",
  sand2: "#8E8679",
  clay0: "#E0A45C",
  clay1: "#C98B47",
  clayInk: "#1A1208",
  amberSoft: "#3A2C1B",
  amberLight: "#F2C48C",
  bark0: "#3A342B",
  bark1: "#746A5B",
  moss: "#8FD6A8",
  sun: "#F2C14E",
  ember: "#FF8A80",
} as const;

export const theme = {
  colors: {
    // ---- Core surfaces (tonal, dark-first) ----
    background: palette.ink0,
    surface: palette.ink1, // tab bar, floating chrome
    surfaceContainer: palette.ink2, // cards, sheets, rows
    surfaceHighest: palette.ink3, // inputs, pressed, thumbnails
    surfaceHover: palette.ink4,
    surfaceInverse: palette.sand0,
    scrim: "rgba(0, 0, 0, 0.66)",
    overlay: "rgba(15, 14, 12, 0.92)", // floating bars over content
    transparent: "transparent",

    // ---- Text ----
    onSurface: palette.sand0, // 16.7:1 on background
    onSurfaceVariant: palette.sand1, // 9.0:1 on background, 8.1:1 on container
    onSurfaceFaint: palette.sand2, // 5.3:1 on background, 4.8:1 on container (min body)
    onSurfaceInverse: palette.ink0,

    // ---- Lines: decorative vs interactive ----
    outline: palette.bark0, // dividers only; never the sole control boundary
    outlineVariant: "rgba(58, 52, 43, 0.6)",
    outlineStrong: palette.bark1, // 3.26:1 on surfaceContainer — focusable boundaries

    // ---- Accent: action, selection, focus, links. Nothing else. ----
    accent: palette.clay0, // 7.9:1 on container
    accentPressed: palette.clay1,
    onAccent: palette.clayInk, // 8.5:1 on accent
    accentSoft: "rgba(224, 164, 92, 0.14)",
    onAccentSoft: palette.amberLight,
    accentContainer: palette.amberSoft,
    onAccentContainer: palette.amberLight,

    // ---- Semantic ----
    success: palette.moss,
    warning: palette.sun,
    error: palette.ember,
    info: palette.sand1,
    onError: "#2A0A08",
    errorSoft: "rgba(255, 138, 128, 0.13)",
    errorContainer: "#3A1815",
    onErrorContainer: "#FFDAD5",
    successSoft: "rgba(143, 214, 168, 0.13)",
    warningSoft: "rgba(242, 193, 78, 0.13)",
    infoSoft: "rgba(184, 176, 163, 0.12)",

    // ---- Media / viewer ----
    viewer: "#000000",
    onViewer: "#FFFFFF",
    onViewerMuted: "rgba(255, 255, 255, 0.72)",
    mediaScrim: "rgba(0, 0, 0, 0.55)",
    mediaScrimStrong: "rgba(0, 0, 0, 0.78)",
    white: "#FFFFFF",
    black: "#000000",

    // ---- Legacy aliases (keep older screens compiling) ----
    primary: palette.clay0,
    onPrimary: palette.clayInk,
    primaryContainer: palette.amberSoft,
    onPrimaryContainer: palette.amberLight,
    secondaryContainer: "#33291D",
    onSecondaryContainer: "#E8D6BE",
  },

  /** 4 / 8 / 12 / 16 / 24 / 32 — nothing else in new UI. */
  spacing: {
    xs: 4,
    sm: 8,
    compact: 12,
    md: 16,
    lg: 24,
    xl: 32,
  },

  /** 4 / 12 / 20 / 999. Legacy lg/xl map onto the same physical steps. */
  radius: {
    thumb: 4,
    control: 12,
    card: 20,
    sheet: 20,
    pill: 999,
    // legacy names
    md: 12,
    lg: 20,
    xl: 20,
    full: 999,
  },

  /** Exactly eight sizes, five line heights, four weights. */
  type: {
    size: {
      caption2: 11,
      caption: 12,
      footnote: 13,
      body: 15,
      bodyLarge: 17,
      title2: 20,
      title1: 24,
      display: 32,
    },
    leading: {
      caption2: 16,
      caption: 16,
      footnote: 18,
      body: 21,
      bodyLarge: 24,
      title2: 26,
      title1: 30,
      display: 38,
    },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    },
  },

  /** Text presets — pass to <AppText variant="…" />. */
  typography: {
    display: { fontSize: 32, lineHeight: 38, fontWeight: "700" },
    title1: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
    title2: { fontSize: 20, lineHeight: 26, fontWeight: "600" },
    title3: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
    bodyLarge: { fontSize: 17, lineHeight: 24, fontWeight: "400" },
    body: { fontSize: 15, lineHeight: 21, fontWeight: "400" },
    bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
    callout: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
    footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
    calloutRegular: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
    captionRegular: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
    caption2: { fontSize: 11, lineHeight: 16, fontWeight: "500" },
    caption2Regular: { fontSize: 11, lineHeight: 16, fontWeight: "400" },
    overline: { fontSize: 11, lineHeight: 16, fontWeight: "600", letterSpacing: 0.3 },
  },

  /** Tonal surfaces first; shadows only for floating chrome and sheets. */
  elevation: {
    none: {},
    floating: {
      shadowColor: "#000000",
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    sheet: {
      shadowColor: "#000000",
      shadowOpacity: 0.45,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -6 },
      elevation: 18,
    },
  },

  /**
   * 120ms feedback / 180ms state / 240ms navigation.
   * Easing control points are converted with Easing.bezier() in src/ui/motion.ts.
   */
  motion: {
    duration: { fast: 120, base: 180, slow: 240 },
    easing: {
      standard: [0.2, 0, 0, 1],
      enter: [0.23, 1, 0.32, 1],
      exit: [0.4, 0, 1, 1],
    },
  },

  /** Fixed layout numbers that the accessibility gate depends on. */
  layout: {
    touch: 48,
    icon: 24,
    iconSmall: 18,
    appBar: 56,
    row: 60,
    tabBar: 56,
    sheetHandle: 36,
    hairline: 1,
  },

  /** Status palette. Colour is never the only signal — see StatusBadge. */
  status: {
    local: { color: palette.sand2, soft: "rgba(142, 134, 121, 0.14)" },
    queued: { color: palette.sun, soft: "rgba(242, 193, 78, 0.13)" },
    uploading: { color: palette.clay0, soft: "rgba(224, 164, 92, 0.14)" },
    synced: { color: palette.moss, soft: "rgba(143, 214, 168, 0.13)" },
    failed: { color: palette.ember, soft: "rgba(255, 138, 128, 0.13)" },
  },
} as const;

export type Theme = typeof theme;
export type TypeVariant = keyof typeof theme.typography;
export type StatusTone = keyof typeof theme.status;
