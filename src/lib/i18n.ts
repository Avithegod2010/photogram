import { mmkv } from "../store/settingsStore";

// Localization pass 2 — the shared UI vocabulary (tabs, gallery chrome,
// collections, states, backup status) lives here. Any key that is missing falls
// back to English, so a half-translated UI never shows a raw key.
//
// Rules: no i18n library, no runtime downloads. Add an entry here and use t()
// (or tf() when a count/name is interpolated). Screens added in this UI pass
// must not contain hardcoded English labels.
export type Locale = "en" | "hi";
const LOCALE_KEY = "locale";

type Entry = { en: string; hi: string };
const DICT: Record<string, Entry> = {
  // ---- Navigation ----
  "tabs.gallery": { en: "Gallery", hi: "गैलरी" },
  "tabs.collections": { en: "Collections", hi: "कलेक्शन" },
  "tabs.settings": { en: "Settings", hi: "सेटिंग्स" },

  // ---- Common ----
  "common.ok": { en: "OK", hi: "ठीक है" },
  "common.cancel": { en: "Cancel", hi: "रद्द करें" },
  "common.close": { en: "Close", hi: "बंद करें" },
  "common.back": { en: "Back", hi: "वापस" },
  "common.delete": { en: "Delete", hi: "हटाएँ" },
  "common.remove": { en: "Remove", hi: "हटाएँ" },
  "common.dismiss": { en: "Dismiss", hi: "खारिज करें" },
  "common.start": { en: "Start", hi: "शुरू करें" },
  "common.retry": { en: "Try again", hi: "फिर कोशिश करें" },
  "common.save": { en: "Save", hi: "सहेजें" },
  "common.done": { en: "Done", hi: "हो गया" },
  "common.search": { en: "Search", hi: "खोजें" },
  "common.clear": { en: "Clear", hi: "साफ़ करें" },
  "common.selectAll": { en: "Select all", hi: "सभी चुनें" },
  "common.loading": { en: "Loading…", hi: "लोड हो रहा है…" },
  "common.share": { en: "Share", hi: "साझा करें" },
  "common.more": { en: "More", hi: "और" },
  "common.apply": { en: "Apply", hi: "लागू करें" },
  "common.offline": { en: "You're offline", hi: "आप ऑफ़लाइन हैं" },
  "common.selected": { en: "Selected", hi: "चुना गया" },
  "common.notSelected": { en: "Not selected", hi: "नहीं चुना" },

  // ---- Backup status vocabulary (icon + label + colour together) ----
  "status.local": { en: "Local only", hi: "सिर्फ़ फ़ोन पर" },
  "status.queued": { en: "Queued", hi: "कतार में" },
  "status.uploading": { en: "Uploading", hi: "अपलोड हो रहा है" },
  "status.synced": { en: "Backed up", hi: "बैकअप हो गया" },
  "status.failed": { en: "Failed", hi: "विफल" },

  // ---- Gallery ----
  "gallery.title": { en: "Photogram", hi: "फोटोग्राम" },
  "gallery.heartbeat.all": { en: "All backed up", hi: "सब बैकअप हो गया" },
  "gallery.heartbeat.partial": { en: "in Telegram", hi: "टेलीग्राम में" },
  "gallery.empty.title": { en: "No photos yet", hi: "अभी कोई फोटो नहीं" },
  "gallery.empty.body": {
    en: "Scan your device library to build your local index and start backing up.",
    hi: "अपनी फ़ोन लाइब्रेरी स्कैन करें और बैकअप शुरू करें।",
  },
  "gallery.searchPlaceholder": {
    en: "Search a word, a month, a year…",
    hi: "शब्द, महीना या साल खोजें…",
  },
  "gallery.searchEmpty.title": { en: "No matches", hi: "कुछ नहीं मिला" },
  "gallery.searchEmpty.body": {
    en: "Try a different word, a month, or a year.",
    hi: "कोई दूसरा शब्द, महीना या साल आज़माएँ।",
  },
  "gallery.saveSearch": { en: "Save this search", hi: "यह खोज सहेजें" },
  "gallery.searchSavedTitle": { en: "Search saved", hi: "खोज सहेजी गई" },
  "gallery.searchSavedBody": {
    en: "Find it in Collections → Smart albums. It updates automatically.",
    hi: "कलेक्शन → स्मार्ट एल्बम में मिलेगी। यह अपने आप अपडेट होती है।",
  },
  "gallery.scan": { en: "Scan device library", hi: "फ़ोन लाइब्रेरी स्कैन करें" },
  "gallery.rescan": { en: "Rescan device library", hi: "फ़ोन लाइब्रेरी फिर स्कैन करें" },
  "gallery.random": { en: "Open a random photo", hi: "कोई भी तस्वीर खोलें" },
  "gallery.zoom": { en: "Timeline zoom", hi: "टाइमलाइन ज़ूम" },
  "gallery.zoom.days": { en: "Days", hi: "दिन" },
  "gallery.zoom.months": { en: "Months", hi: "महीने" },
  "gallery.zoom.years": { en: "Years", hi: "साल" },
  "gallery.selected": { en: "{count} selected", hi: "{count} चुने गए" },
  "gallery.backupPill": { en: "Back up {count}", hi: "{count} बैकअप करें" },
  "gallery.loading": { en: "Loading photos", hi: "तस्वीरें लोड हो रही हैं" },
  "gallery.loadError.title": { en: "The gallery didn't load", hi: "गैलरी लोड नहीं हुई" },
  "gallery.loadError.body": {
    en: "Your photos are still on this phone. Try loading the timeline again.",
    hi: "आपकी तस्वीरें अभी भी इस फ़ोन पर हैं। टाइमलाइन फिर लोड करें।",
  },
  "gallery.scanning": { en: "Scanning {done} of {total}…", hi: "{total} में से {done} स्कैन हो रहे हैं…" },
  "gallery.firstRun.title": { en: "Get your backup started", hi: "अपना बैकअप शुरू करें" },
  "gallery.firstRun.backupNow": { en: "Back up now", hi: "अभी बैकअप करें" },
  "gallery.migration.title": { en: "Restore your backup", hi: "अपना बैकअप वापस लाएँ" },
  "gallery.migration.body": {
    en: "We found your Photogram backup in Telegram on this phone — rebuild your library from it.",
    hi: "इस फ़ोन पर टेलीग्राम में आपका फोटोग्राम बैकअप मिला — उससे अपनी लाइब्रेरी बनाएँ।",
  },
  "gallery.migration.restore": { en: "Restore", hi: "वापस लाएँ" },
  "gallery.partialAccess": {
    en: "Only selected photos are visible — allow all photos in app settings.",
    hi: "सिर्फ़ चुनी हुई तस्वीरें दिख रही हैं — ऐप सेटिंग्स में सभी तस्वीरें इजाज़त दें।",
  },
  "gallery.people": { en: "People", hi: "लोग" },
  "gallery.selectHint": {
    en: "Tap to open, long-press to select",
    hi: "खोलने के लिए टैप करें, चुनने के लिए दबाए रखें",
  },
  "gallery.tileLabel": { en: "Photo from {date}", hi: "{date} की तस्वीर" },
  "gallery.tileStatus": { en: "{date}, {status}", hi: "{date}, {status}" },
  "gallery.top": { en: "Top", hi: "ऊपर" },
  "gallery.itemsCount": { en: "{count} items", hi: "{count} आइटम" },
  "gallery.itemsCount.one": { en: "{count} item", hi: "{count} आइटम" },
  "gallery.tag": { en: "Tag", hi: "टैग" },
  "gallery.tagTitle": { en: "Tag {count} items", hi: "{count} आइटम पर टैग" },
  "gallery.tagHint": {
    en: "Comma-separated. Existing tags on each photo are kept.",
    hi: "कॉमा से अलग करें। हर तस्वीर के पुराने टैग बने रहेंगे।",
  },
  "gallery.tagPlaceholder": { en: "india, family, 2024", hi: "भारत, परिवार, 2024" },
  "gallery.removeFavorite": { en: "Remove from favorites", hi: "पसंदीदा से हटाएँ" },
  "gallery.scrubber": { en: "Timeline scrubber", hi: "टाइमलाइन स्क्रबर" },
  "gallery.scrubberHint": {
    en: "Swipe up or down to change the month",
    hi: "महीना बदलने के लिए ऊपर या नीचे स्वाइप करें",
  },
  "gallery.newerMonth": { en: "Newer month", hi: "नया महीना" },
  "gallery.olderMonth": { en: "Older month", hi: "पुराना महीना" },
  "gallery.scanFailed": { en: "Scan couldn't finish", hi: "स्कैन पूरा नहीं हो सका" },
  "gallery.partialAccessTitle": { en: "Partial photo access", hi: "आंशिक फ़ोटो इजाज़त" },
  "gallery.partialAccessBody": {
    en: "Android is only showing Photogram the items you picked manually, so some photos may be missing. To allow everything: long-press the Photogram icon → App info → Permissions → Photos and videos → Allow all.",
    hi: "Android फोटोग्राम को सिर्फ़ चुनी हुई तस्वीरें दिखा रहा है, इसलिए कुछ तस्वीरें छूट सकती हैं। सब दिखाने के लिए: फोटोग्राम आइकन दबाए रखें → ऐप जानकारी → अनुमतियाँ → फ़ोटो और वीडियो → सभी की अनुमति दें।",
  },
  "gallery.backupTitle": { en: "Back up to Telegram", hi: "टेलीग्राम में बैकअप करें" },
  "gallery.backupQueue": {
    en: "Queue {count} items for upload to Saved Messages?",
    hi: "{count} आइटम को Saved Messages में अपलोड के लिए कतार में डालें?",
  },
  "gallery.backupAction": { en: "Back up", hi: "बैकअप करें" },
  "gallery.queuedNote": {
    en: "{count} items queued for backup",
    hi: "{count} आइटम बैकअप कतार में",
  },
  "gallery.archiveTitle": { en: "Archive items", hi: "आइटम आर्काइव करें" },
  "gallery.hideTitle": { en: "Hide items", hi: "आइटम छिपाएँ" },
  "gallery.moveOut": {
    en: "Move {count} items out of the main timeline? Find them later in {where}.",
    hi: "{count} आइटम मुख्य टाइमलाइन से हटाएँ? बाद में {where} में मिलेंगे।",
  },
  "gallery.archiveAction": { en: "Archive", hi: "आर्काइव" },
  "gallery.hideAction": { en: "Hide", hi: "छिपाएँ" },
  "gallery.favoriteTitle": { en: "Add to Favorites", hi: "पसंदीदा में जोड़ें" },
  "gallery.favoriteBody": {
    en: "Mark {count} items as favorite? Already-favorited items are untouched.",
    hi: "{count} आइटम पसंदीदा बनाएँ? पहले से पसंदीदा आइटम नहीं बदलेंगे।",
  },
  "gallery.favoriteAction": { en: "Favorite", hi: "पसंदीदा" },
  "gallery.trashTitle": { en: "Move to Trash", hi: "ट्रैश में भेजें" },
  "gallery.trashBody": {
    en: "Move {count} items to Trash? They are deleted forever after 30 days.",
    hi: "{count} आइटम ट्रैश में भेजें? 30 दिन बाद वे हमेशा के लिए मिट जाएँगे।",
  },
  "gallery.trashAction": { en: "Move to Trash", hi: "ट्रैश में भेजें" },
  "date.today": { en: "Today", hi: "आज" },
  "date.yesterday": { en: "Yesterday", hi: "कल" },
  "time.justNow": { en: "just now", hi: "अभी" },
  "time.minAgo": { en: "{count} min ago", hi: "{count} मिनट पहले" },
  "time.hAgo": { en: "{count}h ago", hi: "{count} घंटे पहले" },
  "time.yesterday": { en: "yesterday", hi: "कल" },
  "time.dAgo": { en: "{count}d ago", hi: "{count} दिन पहले" },
  "gallery.lastBackup": { en: "last backup {time}", hi: "पिछला बैकअप {time}" },
  "memories.title": { en: "Memories", hi: "यादें" },
  "memories.yearsAgo": { en: "{count} years ago", hi: "{count} साल पहले" },
  "memories.oneYearAgo": { en: "1 year ago", hi: "1 साल पहले" },
  "albums.title": { en: "Albums", hi: "एल्बम" },
  "albums.note": {
    en: "Auto-grouped from your library — updated on every scan.",
    hi: "आपकी लाइब्रेरी से अपने आप बने — हर स्कैन पर अपडेट।",
  },
  "albums.empty.title": { en: "Nothing scanned yet", hi: "अभी कुछ स्कैन नहीं हुआ" },
  "albums.empty.body": {
    en: "Scan your device library from Gallery, then your camera, screenshots and app folders appear here.",
    hi: "गैलरी से अपनी फ़ोन लाइब्रेरी स्कैन करें — फिर कैमरा, स्क्रीनशॉट और ऐप फ़ोल्डर यहाँ दिखेंगे।",
  },
  "albums.empty.action": { en: "Back to Gallery", hi: "गैलरी पर वापस" },
  "albums.pinned": { en: "Pinned", hi: "पिन किया" },
  "albums.pin": { en: "Pin album", hi: "एल्बम पिन करें" },
  "albums.unpin": { en: "Unpin album", hi: "एल्बम अनपिन करें" },
  "albums.lock": { en: "Lock album", hi: "एल्बम लॉक करें" },
  "albums.unlock": { en: "Remove album lock", hi: "एल्बम का लॉक हटाएँ" },
  "albums.lockUnavailable": { en: "Biometrics are not set up on this phone", hi: "इस फ़ोन पर बायोमेट्रिक्स सेट नहीं हैं" },
  "albums.count": { en: "{count} items", hi: "{count} आइटम" },
  "albums.count.one": { en: "{count} item", hi: "{count} आइटम" },
  "album.play": { en: "Play", hi: "चलाएँ" },
  "album.ask": { en: "Ask for photos", hi: "तस्वीरें माँगें" },
  "album.share": { en: "Share album", hi: "एल्बम साझा करें" },
  "album.cover": { en: "Choose cover", hi: "कवर चुनें" },
  "album.actions": { en: "Album actions", hi: "एल्बम विकल्प" },
  "album.timeline": { en: "Show in my timeline", hi: "मेरी टाइमलाइन में दिखाएँ" },
  "album.groupBy": { en: "Group photos", hi: "तस्वीरें समूह में" },
  "album.timelineNote": {
    en: "Off = these photos live only in this album",
    hi: "बंद = ये तस्वीरें सिर्फ़ इस एल्बम में रहेंगी",
  },
  "album.empty": { en: "No items in this album yet", hi: "इस एल्बम में अभी कुछ नहीं" },
  "album.emptyBody": {
    en: "Photos appear here after the next scan or when the family posts to the shared chat.",
    hi: "अगले स्कैन के बाद या परिवार के चैट में तस्वीर भेजने पर वे यहाँ दिखेंगी।",
  },
  "album.recent": { en: "Recent activity", hi: "हाल की गतिविधि" },
  "album.all": { en: "All", hi: "सभी" },
  "album.bySender": { en: "By sender", hi: "भेजने वाले से" },
  "album.byMonth": { en: "By month", hi: "महीने से" },
  "album.you": { en: "You", hi: "आप" },
  "album.someone": { en: "Someone", hi: "कोई" },
  "album.lockedTitle": { en: "This album is locked", hi: "यह एल्बम लॉक है" },
  "album.lockedBody": {
    en: "Unlock with your fingerprint or face to open it.",
    hi: "खोलने के लिए फ़िंगरप्रिंट या चेहरे से अनलॉक करें।",
  },
  "album.unlock": { en: "Unlock album", hi: "एल्बम अनलॉक करें" },
  "album.coverTitle": { en: "Pick an album cover", hi: "एल्बम का कवर चुनें" },
  "album.coverHint": {
    en: "Shown on the Albums screen. Auto gives back the newest photo.",
    hi: "एल्बम स्क्रीन पर दिखेगा। ऑटो नई तस्वीर चुन लेता है।",
  },
  "album.auto": { en: "Auto", hi: "ऑटो" },
  "album.requestTitle": { en: "Ask the family for photos", hi: "परिवार से तस्वीरें माँगें" },
  "album.requestHint": {
    en: "A short request goes into this album's chat. Photos posted as replies are saved into the album automatically.",
    hi: "छोटा-सा अनुरोध इस एल्बम के चैट में जाएगा। जवाब में भेजी तस्वीरें अपने आप एल्बम में सहेजी जाएँगी।",
  },
  "album.requestPlaceholder": {
    en: "e.g. Diwali, Goa trip, grandma's birthday",
    hi: "जैसे दिवाली, गोवा यात्रा, दादी का जन्मदिन",
  },
  "album.sendRequest": { en: "Send request", hi: "अनुरोध भेजें" },
  "album.shareTitle": { en: "Share to a chat", hi: "चैट में साझा करें" },
  "album.shareHint": {
    en: "Copies each local photo/video to the picked chat — Telegram storage only. Uses the normal upload queue.",
    hi: "हर स्थानीय फ़ोटो/वीडियो चुनी हुई चैट में कॉपी होगी — सिर्फ़ टेलीग्राम स्टोरेज। सामान्य अपलोड कतार इस्तेमाल होगी।",
  },
  "album.noGroups": { en: "No groups found — create one in Telegram first.", hi: "कोई ग्रुप नहीं मिला — पहले टेलीग्राम में बनाएँ।" },
  "album.send": { en: "Send", hi: "भेजें" },
  "album.queued": { en: "Queued", hi: "कतार में" },
  "people.title": { en: "People", hi: "लोग" },
  "people.subtitle": { en: "Grouped on this phone — long-press a person to merge", hi: "इस फ़ोन पर समूह — मिलाने के लिए किसी व्यक्ति को दबाए रखें" },
  "people.merging": { en: "Tap the target person…", hi: "लक्ष्य व्यक्ति पर टैप करें…" },
  "people.mergingHint": { en: "Their faces move into the person you tapped first.", hi: "उनके चेहरे उस व्यक्ति में जाएँगे जिसे पहले चुना था।" },
  "people.photosWith": { en: "{count} photos with this person", hi: "इस व्यक्ति के साथ {count} तस्वीरें" },
  "people.photosWith.one": { en: "{count} photo with this person", hi: "इस व्यक्ति के साथ {count} तस्वीर" },
  "people.unnamed": { en: "Unnamed", hi: "बिना नाम" },
  "people.faces": { en: "{count} faces", hi: "{count} चेहरे" },
  "people.faces.one": { en: "{count} face", hi: "{count} चेहरा" },
  "people.tapToSee": { en: "Tap to see photos", hi: "तस्वीरें देखने के लिए टैप करें" },
  "people.empty.title": { en: "No people yet", hi: "अभी कोई नहीं" },
  "people.empty.body": {
    en: "Turn on face detection, download a model and run Detect & embed in setup. Then group faces here.",
    hi: "फ़ेस डिटेक्शन चालू करें, मॉडल डाउनलोड करें और सेटअप में डिटेक्ट और एम्बेड चलाएँ। फिर यहाँ चेहरे समूह बनाएँ।",
  },
  "people.empty.action": { en: "Open setup", hi: "सेटअप खोलें" },
  "people.group": { en: "Group faces", hi: "चेहरे समूह बनाएँ" },
  "people.grouping": { en: "Grouping…", hi: "समूह बन रहे हैं…" },
  "people.review": { en: "Review", hi: "समीक्षा" },
  "people.play": { en: "Play", hi: "चलाएँ" },
  "people.rename": { en: "Name", hi: "नाम" },
  "people.select": { en: "Select", hi: "चुनें" },
  "people.cancel": { en: "Cancel", hi: "रद्द करें" },
  "people.split": { en: "Split off", hi: "अलग करें" },
  "people.splitCount": { en: "Split off ({count})", hi: "अलग करें ({count})" },
  "people.sensitivity": { en: "Attach new faces at:", hi: "नए चेहरे इस सख्ती से जोड़ें:" },
  "people.selectHint": {
    en: "{count} selected — tap photos to pick, then split them out of this person.",
    hi: "{count} चुने गए — तस्वीरें चुनें, फिर उन्हें इस व्यक्ति से अलग करें।",
  },
  "people.hint": { en: "Long-press a photo to mark “Not this person”. Tap Select to split several out.", hi: "“यह व्यक्ति नहीं” के लिए तस्वीर दबाए रखें। कई अलग करने के लिए चुनें दबाएँ।" },
  "people.noPhotos": { en: "No photos found for this person.", hi: "इस व्यक्ति की कोई तस्वीर नहीं मिली।" },
  "people.candidates": { en: "Possible more of {name} — tap to attach", hi: "{name} की और संभावित तस्वीरें — जोड़ने के लिए टैप करें" },
  "people.renameTitle": { en: "Name this person", hi: "इस व्यक्ति का नाम रखें" },
  "people.renameHint": { en: "Stored on this phone only.", hi: "सिर्फ़ इस फ़ोन पर सहेजा जाएगा।" },
  "people.renamePlaceholder": { en: "Mom, Dad, Emma…", hi: "माँ, पापा, एमा…" },
  "people.mergeTitle": { en: "Merge people", hi: "लोगों को मिलाएँ" },
  "people.splitTitle": { en: "Split off", hi: "अलग करें" },
  "people.notThisTitle": { en: "Not this person?", hi: "यह व्यक्ति नहीं?" },
  "people.loading": { en: "Loading people", hi: "लोग लोड हो रहे हैं" },

  // ---- Collections ----
  "collections.title": { en: "Collections", hi: "कलेक्शन" },
  "collections.searchPlaceholder": { en: "Find a collection", hi: "कलेक्शन खोजें" },
  "collections.noResults": { en: "No collections match “{query}”", hi: "“{query}” से कोई कलेक्शन नहीं मिला" },
  "collections.group.library": { en: "Library", hi: "लाइब्रेरी" },
  "collections.group.organize": { en: "Organize", hi: "व्यवस्थित करें" },
  "collections.group.privacy": { en: "Privacy", hi: "निजता" },
  "collections.group.advanced": { en: "Advanced", hi: "उन्नत" },
  "collections.smartAlbums": { en: "Smart albums", hi: "स्मार्ट एल्बम" },
  "collections.smartAlbumsSub": {
    en: "Saved searches that update themselves",
    hi: "सहेजी गई खोजें, जो खुद अपडेट होती हैं",
  },
  "collections.smartAlbumsEmpty": {
    en: "Nothing pinned yet. Search in the gallery and tap the bookmark to save it here.",
    hi: "अभी कुछ सहेजा नहीं है। गैलरी में खोजें और बुकमार्क दबाकर यहाँ सहेजें।",
  },
  "collections.buildSmartAlbum": { en: "Build a smart album", hi: "स्मार्ट एल्बम बनाएँ" },
  "collections.buildSmartAlbumSub": {
    en: "Stack filters: favorites, tags, dates, words",
    hi: "फ़िल्टर जोड़ें: पसंदीदा, टैग, तारीखें, शब्द",
  },
  "collections.documents": { en: "Documents", hi: "दस्तावेज़" },
  "collections.documentsSub": {
    en: "Receipts and papers found by on-device text recognition",
    hi: "फ़ोन पर टेक्स्ट पहचान से मिले रसीदें और कागज़",
  },
  "collections.albums": { en: "Albums", hi: "एल्बम" },
  "collections.albumsSub": {
    en: "Camera, Screenshots, WhatsApp, Downloads and more",
    hi: "कैमरा, स्क्रीनशॉट, व्हाट्सऐप, डाउनलोड और बाकी",
  },
  "collections.shared": { en: "Shared albums", hi: "साझा एल्बम" },
  "collections.sharedSub": {
    en: "Family photos from a private Telegram group",
    hi: "निजी टेलीग्राम ग्रुप से परिवार की तस्वीरें",
  },
  "collections.favorites": { en: "Favorites", hi: "पसंदीदा" },
  "collections.favoritesSub": { en: "Every photo you marked with a heart", hi: "आपकी हर पसंदीदा तस्वीर" },
  "collections.wrapped": { en: "{year} Wrapped", hi: "{year} की झलक" },
  "collections.wrappedSub": {
    en: "Your year in photos — totals, top days, favorites",
    hi: "साल भर की तस्वीरें — कुल, खास दिन, पसंदीदा",
  },
  "collections.journal": { en: "Journal", hi: "डायरी" },
  "collections.journalSub": {
    en: "Every note you wrote, as a diary across the years",
    hi: "आपके सारे नोट, सालों की डायरी में",
  },
  "collections.highlights": { en: "Highlights", hi: "झलकियाँ" },
  "collections.highlightsSub": {
    en: "The sharpest shots of each month, auto-curated",
    hi: "हर महीने की सबसे शार्प तस्वीरें",
  },
  "collections.duplicates": { en: "Find duplicates", hi: "डुप्लिकेट खोजें" },
  "collections.duplicatesSub": {
    en: "Near-identical photos — bursts, forwards and re-saves",
    hi: "एक जैसी तस्वीरें — बर्स्ट, फ़ॉरवर्ड और दोबारा सेव",
  },
  "collections.scenes": { en: "Scene albums", hi: "दृश्य एल्बम" },
  "collections.scenesSub": {
    en: "Beach, food, pets — auto-built from photo tags",
    hi: "समंदर, खाना, पालतू — टैग से अपने आप बने",
  },
  "collections.people": { en: "People & Pets", hi: "लोग और पालतू" },
  "collections.peopleSub": {
    en: "Face grouping — pick a model to start (on-device)",
    hi: "चेहरों के समूह — शुरू करने के लिए मॉडल चुनें (फ़ोन पर)",
  },
  "collections.archive": { en: "Archive", hi: "आर्काइव" },
  "collections.archiveSub": {
    en: "Decluttered media — hidden from the main timeline",
    hi: "हटाई गई मीडिया — मुख्य टाइमलाइन से छिपी",
  },
  "collections.trash": { en: "Trash", hi: "ट्रैश" },
  "collections.trashSub": { en: "Deleted items · 30-day countdown", hi: "हटाई गई चीज़ें · 30 दिन की उलटी गिनती" },
  "collections.map": { en: "Map", hi: "नक्शा" },
  "collections.mapSub": { en: "Photos placed on the world by GPS data", hi: "GPS से नक्शे पर रखी तस्वीरें" },
  "collections.hidden": { en: "Hidden", hi: "छिपी तस्वीरें" },
  "collections.hiddenSub": { en: "Locked behind your fingerprint or face", hi: "फ़िंगरप्रिंट या चेहरे से लॉक" },
  "collections.safety": { en: "Safety check", hi: "सुरक्षा जाँच" },
  "collections.safetySub": { en: "What exists only on this phone?", hi: "क्या सिर्फ़ इस फ़ोन पर है?" },

  // ---- Settings section headings ----
  "settings.section.uploads": { en: "Uploads", hi: "अपलोड" },
  "settings.section.health": { en: "Backup health", hi: "बैकअप स्वास्थ्य" },
  "settings.section.preferences": { en: "Backup preferences", hi: "बैकअप सेटिंग्स" },
  "settings.section.auto": { en: "Auto-backup", hi: "ऑटो-बैकअप" },
  "settings.section.notifications": { en: "Notifications", hi: "नोटिफिकेशन" },
  "settings.section.library": { en: "Library", hi: "लाइब्रेरी" },
  "settings.section.storage": { en: "Storage", hi: "स्टोरेज" },
  "settings.section.device": { en: "Device", hi: "डिवाइस" },
  "settings.section.search": { en: "Search", hi: "खोज" },
  "settings.section.privacy": { en: "Privacy", hi: "निजता" },
  "settings.section.diagnostics": { en: "Diagnostics", hi: "जाँच" },
  "settings.section.shared": { en: "Shared albums", hi: "साझा एल्बम" },
  "settings.section.account": { en: "Account", hi: "खाता" },
  "settings.section.migration": { en: "Migration", hi: "माइग्रेशन" },
  "settings.section.danger": { en: "Danger zone", hi: "सावधानी क्षेत्र" },
  "settings.section.language": { en: "Language", hi: "भाषा" },
  "settings.section.backup": { en: "Backup", hi: "बैकअप" },
  "settings.section.display": { en: "Display", hi: "डिस्प्ले" },
  "settings.wifiOnly": { en: "Upload on Wi-Fi only", hi: "सिर्फ Wi-Fi पर अपलोड" },
  "settings.chargeOnly": { en: "Upload only while charging", hi: "सिर्फ चार्जिंग में अपलोड" },
  "settings.showDate": { en: "Show date in every photo", hi: "हर फोटो पर तारीख दिखाएँ" },
  "settings.storyMusic": { en: "Story background music", hi: "स्टोरी बैकग्राउंड म्यूज़िक" },
  "settings.autoBackup": { en: "Back up new photos automatically", hi: "नए फोटो अपने आप बैकअप" },
  "settings.notifMaster": { en: "Notifications", hi: "नोटिफिकेशन" },
  "settings.pause": { en: "Pause uploads", hi: "अपलोड रोकें" },
  "settings.resume": { en: "Resume uploads", hi: "अपलोड फिर शुरू करें" },
  "settings.backupNow": { en: "Back up now", hi: "अभी बैकअप करें" },
  "settings.noActiveUpload": { en: "No active upload", hi: "कोई अपलोड नहीं चल रहा" },
  "settings.uploadedToday": { en: "Backed up today", hi: "आज बैकअप हुआ" },

  // ---- Viewer ----
  "viewer.share": { en: "Share", hi: "साझा करें" },
  "viewer.play": { en: "Play", hi: "चलाएँ" },
  "viewer.favorite": { en: "Favorite", hi: "पसंदीदा" },
  "viewer.favorited": { en: "Favorited", hi: "पसंदीदा" },
  "viewer.note": { en: "Note", hi: "नोट" },
  "viewer.more": { en: "More actions", hi: "और विकल्प" },
  "viewer.similar": { en: "Similar", hi: "मिलती-जुलती" },
  "viewer.save": { en: "Save to device", hi: "फ़ोन पर सहेजें" },
  "viewer.backup": { en: "Back up", hi: "बैकअप करें" },
  "viewer.send": { en: "Send to album", hi: "एल्बम में भेजें" },
  "viewer.edit": { en: "Edit", hi: "संपादित करें" },
  "viewer.archive": { en: "Archive", hi: "आर्काइव" },
  "viewer.hide": { en: "Hide", hi: "छिपाएँ" },
  "viewer.delete": { en: "Delete", hi: "हटाएँ" },
  "viewer.details": { en: "Details", hi: "जानकारी" },
  "viewer.detailsHint": { en: "Details and metadata", hi: "जानकारी और मेटाडेटा" },
  "viewer.empty": { en: "This item is no longer available.", hi: "यह आइटम अब उपलब्ध नहीं है।" },
  "viewer.tileHint": { en: "Swipe for the next photo", hi: "अगली तस्वीर के लिए स्वाइप करें" },
  "viewer.toggleChrome": { en: "Show or hide controls", hi: "कंट्रोल दिखाएँ या छिपाएँ" },
  "viewer.position": { en: "{current} of {total}", hi: "{total} में से {current}" },

  // ---- States ----
  "state.loading": { en: "Loading…", hi: "लोड हो रहा है…" },
  "state.empty": { en: "Nothing here yet", hi: "अभी यहाँ कुछ नहीं" },
  "state.error": { en: "Something went wrong", hi: "कुछ गड़बड़ हो गई" },
  "state.offline": { en: "You're offline", hi: "आप ऑफ़लाइन हैं" },
  "state.offlineBackup": {
    en: "Backups are paused until the connection returns. Your photos stay on this phone.",
    hi: "कनेक्शन आने तक बैकअप रुका है। आपकी तस्वीरें इस फ़ोन पर सुरक्षित हैं।",
  },
  "state.offlineBody": {
    en: "This screen works from what is on your phone. Backups resume when the connection returns.",
    hi: "यह स्क्रीन फ़ोन की चीज़ों से काम करती है। कनेक्शन आने पर बैकअप फिर शुरू होगा।",
  },
  "state.permission": { en: "Permission needed", hi: "इजाज़त चाहिए" },
  "state.partial": { en: "Some items could not load", hi: "कुछ चीज़ें लोड नहीं हुईं" },

  // ---- Login ----
  "login.title": { en: "Photogram", hi: "फोटोग्राम" },
  "login.tagline": {
    en: "Your photos, backed up to your own Telegram.",
    hi: "आपकी तस्वीरें, आपके ही टेलीग्राम में सुरक्षित।",
  },
  "login.continueQr": { en: "Continue with QR", hi: "QR से आगे बढ़ें" },
  "login.usePhone": { en: "Use phone number instead", hi: "फ़ोन नंबर से लॉग इन करें" },
  "login.openTelegram": { en: "Open Telegram", hi: "टेलीग्राम खोलें" },
  "login.retry": { en: "Try again", hi: "फिर कोशिश करें" },
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

/** Translate with {placeholders}, e.g. tf("gallery.selected", { count: 3 }). */
export function tf(key: string, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name])
  );
}

/**
 * Count-aware translation. Uses "<key>.one" when count === 1 and "<key>"
 * otherwise, with {count} interpolated. Avoids "1 items" / "1 faces".
 */
export function tCount(
  baseKey: string,
  count: number,
  extra: Record<string, string | number> = {}
): string {
  return tf(count === 1 ? `${baseKey}.one` : baseKey, {
    count: count.toLocaleString(),
    ...extra,
  });
}

export const I18N_DICT = DICT;
