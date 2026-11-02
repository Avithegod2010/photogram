import { mmkv } from "../store/settingsStore";

// v0.52 Hindi localization, pass 1. The dictionary is intentionally partial:
// any key that is missing falls back to English, so a half-translated UI never
// shows a raw key. Extend by adding entries here — nothing else needs to change.
export type Locale = "en" | "hi";
const LOCALE_KEY = "locale";

type Entry = { en: string; hi: string };
const DICT: Record<string, Entry> = {
  "tabs.gallery": { en: "Gallery", hi: "गैलरी" },
  "tabs.collections": { en: "Collections", hi: "कलेक्शन" },
  "tabs.settings": { en: "Settings", hi: "सेटिंग्स" },
  "gallery.title": { en: "Photogram", hi: "फोटोग्राम" },
  "gallery.heartbeat.all": { en: "All backed up", hi: "सब बैकअप हो गया" },
  "gallery.heartbeat.partial": { en: "in Telegram", hi: "टेलीग्राम में" },
  "gallery.empty.title": { en: "No photos yet", hi: "अभी कोई फोटो नहीं" },
  "gallery.empty.body": {
    en: "Scan your device library to build your local index and start backing up.",
    hi: "अपना फोटो लाइब्रेरी स्कैन करें और बैकअप शुरू करें।",
  },
  "settings.section.backup": { en: "Backup", hi: "बैकअप" },
  "settings.section.auto": { en: "Auto-backup", hi: "ऑटो-बैकअप" },
  "settings.section.display": { en: "Display", hi: "डिस्प्ले" },
  "settings.section.storage": { en: "Storage", hi: "स्टोरेज" },
  "settings.section.language": { en: "Language", hi: "भाषा" },
  "settings.wifiOnly": { en: "Upload on Wi-Fi only", hi: "सिर्फ Wi-Fi पर अपलोड" },
  "settings.chargeOnly": { en: "Upload only while charging", hi: "सिर्फ चार्जिंग में अपलोड" },
  "settings.showDate": { en: "Show date in every photo", hi: "हर फोटो पर तारीख दिखाएँ" },
  "settings.storyMusic": { en: "Story background music", hi: "स्टोरी बैकग्राउंड म्यूज़िक" },
  "settings.autoBackup": { en: "Back up new photos automatically", hi: "नए फोटो अपने आप बैकअप" },
  "settings.notifMaster": { en: "Notifications", hi: "नोटिफिकेशन" },
  "common.cancel": { en: "Cancel", hi: "रद्द करें" },
  "common.delete": { en: "Delete", hi: "हटाएँ" },
  "common.back": { en: "Back", hi: "वापस" },
  "common.dismiss": { en: "Dismiss", hi: "खारिज" },
  "common.start": { en: "Start", hi: "शुरू" },
};

export function getLocale(): Locale {
  const v = mmkv.getString(LOCALE_KEY);
  return v === "hi" ? "hi" : "en";
}

export function setLocale(locale: Locale): void {
  mmkv.set(LOCALE_KEY, locale);
}

// Pure translator — probe-testable without MMKV.
export function translate(dict: Record<string, Entry>, key: string, locale: Locale): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en ?? key;
}

export function t(key: string): string {
  return translate(DICT, key, getLocale());
}

export const I18N_DICT = DICT;
