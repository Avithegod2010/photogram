import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale, type Locale } from "./i18n";

/**
 * The active UI language, as reactive state.
 *
 * Screens that call t() during render already update whenever they re-render.
 * This hook is for the places where that is not true: labels baked into
 * navigator options (the bottom tab bar) and anything else rendered once per
 * mount. Reading it subscribes the component, so a language switch in Settings
 * updates it immediately instead of after a restart.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
