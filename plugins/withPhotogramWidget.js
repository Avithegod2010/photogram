// Config plugin: re-apply the v0.46 Android home-screen widget + quick-settings
// tile on every `expo prebuild` (CNG). `android/` is gitignored, so without this
// plugin a cloud/EAS or clean local build silently loses both native surfaces.
//
// Writes (idempotent):
//   android/app/src/main/java/<pkg>/PhotogramStatusWidget.kt
//   android/app/src/main/java/<pkg>/PhotogramTileService.kt
//   android/app/src/main/res/layout/widget_status.xml
//   android/app/src/main/res/xml/backup_widget_info.xml
//   android/app/src/main/res/drawable/widget_bg.xml
//   android/app/src/main/res/values/strings.xml  (merges tile_label/widget_empty)
// and adds the <receiver> + <service> entries to AndroidManifest.xml.
//
// The Kotlin/XML below is the same code that shipped in v0.46-v0.54; keep this
// file as the source of truth from now on (docs/NATIVE-REAPPLY.md §1).
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (prev !== contents) fs.writeFileSync(filePath, contents, "utf8");
}

// Merge two <string> entries into an existing resources file without touching
// anything prebuild generated (app_name, expo_system_ui_...).
function mergeStrings(filePath, entries) {
  let xml = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "<resources>\n</resources>\n";
  let changed = false;
  for (const [name, value] of Object.entries(entries)) {
    const re = new RegExp(`<string name="${name}"[^>]*>`);
    if (re.test(xml)) continue;
    xml = xml.replace(/<\/resources>\s*$/, `  <string name="${name}">${value}</string>\n</resources>\n`);
    changed = true;
  }
  if (changed || !fs.existsSync(filePath)) fs.writeFileSync(filePath, xml, "utf8");
}

const WIDGET_KT = `package __PACKAGE__

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File

/**
 * v0.46 Photogram backup status widget, v0.55 photo variant.
 * Shows the numbers-only state the JS side writes to files/widget_state.json
 * (aggregate counts/bytes only - same privacy rule as the family heartbeat card:
 * no file names, paths, album or contact names) plus the memory-of-the-day
 * thumbnail the JS side points at (a local app-private file, decoded here and
 * handed to RemoteViews as a bitmap - nothing leaves the device).
 */
class PhotogramStatusWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) update(context, manager, id)
    }

    companion object {
        fun update(context: Context, manager: AppWidgetManager, id: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_status).apply {
                setTextViewText(R.id.widget_title, "Photogram")
                setTextViewText(R.id.widget_body, context.getString(R.string.widget_empty))
                setViewVisibility(R.id.widget_photo, View.GONE)
            }
            try {
                val f = File(context.filesDir, "widget_state.json")
                if (f.exists()) {
                    val o = JSONObject(f.readText())
                    views.setTextViewText(R.id.widget_title, "Photogram \\u00B7 " + o.optString("line1"))
                    views.setTextViewText(R.id.widget_body, o.optString("line2"))
                    val photoPath = o.optString("photoPath", "")
                    if (photoPath.isNotEmpty()) {
                        val bitmap = BitmapFactory.decodeFile(photoPath)
                        if (bitmap != null) {
                            views.setImageViewBitmap(R.id.widget_photo, bitmap)
                            views.setViewVisibility(R.id.widget_photo, View.VISIBLE)
                        }
                    }
                }
            } catch (_: Exception) {
                // A malformed state file must never crash the launcher host.
            }
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(
                    context,
                    0,
                    Intent(context, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            )
            manager.updateAppWidget(id, views)
        }

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            for (id in manager.getAppWidgetIds(
                ComponentName(context, PhotogramStatusWidget::class.java)
            )) {
                update(context, manager, id)
            }
        }
    }
}
`;

const TILE_KT = `package __PACKAGE__

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import java.io.File

/**
 * v0.46 quick-settings tile: tap to pause/resume NEW backup queuing from the
 * shade. The marker file is the same one tilePauseActive() (JS) reads, so no
 * pause state has to cross in the other direction - the worker is never
 * touched from here (uploader.ts stays protected; active uploads finish).
 */
class PhotogramTileService : TileService() {

    private fun marker(): File = File(filesDir, "tile_pause")

    override fun onStartListening() {
        sync()
    }

    override fun onClick() {
        val f = marker()
        try {
            if (f.exists()) f.delete() else f.writeText("1")
        } catch (_: Exception) {
            // A failed toggle must not crash SystemUI.
        }
        sync()
    }

    private fun sync() {
        val tile = qsTile ?: return
        val paused = try {
            marker().exists()
        } catch (_: Exception) {
            false
        }
        tile.state = if (paused) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = if (paused) "Backup paused" else "Backing up"
        tile.updateTile()
    }
}
`;

const WIDGET_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="180dp"
  android:minHeight="120dp"
  android:updatePeriodMillis="1800000"
  android:initialLayout="@layout/widget_status"
  android:resizeMode="horizontal|vertical"
  android:widgetCategory="home_screen"/>
`;

const WIDGET_LAYOUT_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:gravity="center_vertical"
  android:padding="10dp"
  android:background="@drawable/widget_bg">
  <ImageView
    android:id="@+id/widget_photo"
    android:layout_width="match_parent"
    android:layout_height="90dp"
    android:scaleType="centerCrop"
    android:visibility="gone"
    android:contentDescription="@string/widget_empty"/>
  <TextView
    android:id="@+id/widget_title"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:textColor="#EAF0F6"
    android:textSize="13sp"
    android:textStyle="bold"
    android:text="Photogram"/>
  <TextView
    android:id="@+id/widget_body"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:textColor="#9FB3C8"
    android:textSize="12sp"
    android:text=""/>
</LinearLayout>
`;

const WIDGET_BG_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
  <corners android:radius="18dp"/>
  <solid android:color="#171E27"/>
</shape>
`;

function withWidgetFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot; // .../android
      const pkg = cfg.android?.package || "com.photogram.app";
      const javaDir = path.join(root, "app", "src", "main", "java", ...pkg.split("."));
      const resDir = path.join(root, "app", "src", "main", "res");

      writeFile(path.join(javaDir, "PhotogramStatusWidget.kt"), WIDGET_KT.replace("__PACKAGE__", pkg));
      writeFile(path.join(javaDir, "PhotogramTileService.kt"), TILE_KT.replace("__PACKAGE__", pkg));
      writeFile(path.join(resDir, "xml", "backup_widget_info.xml"), WIDGET_INFO_XML);
      writeFile(path.join(resDir, "layout", "widget_status.xml"), WIDGET_LAYOUT_XML);
      writeFile(path.join(resDir, "drawable", "widget_bg.xml"), WIDGET_BG_XML);
      mergeStrings(path.join(resDir, "values", "strings.xml"), {
        tile_label: "Pause Photogram backup",
        widget_empty: "Open Photogram to start a backup",
      });
      return cfg;
    },
  ]);
}

function withWidgetManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;

    app.receiver = app.receiver || [];
    app.service = app.service || [];

    const hasReceiver = app.receiver.some(
      (r) => r?.$?.["android:name"] === ".PhotogramStatusWidget"
    );
    if (!hasReceiver) {
      app.receiver.push({
        $: { "android:name": ".PhotogramStatusWidget", "android:exported": "false" },
        "intent-filter": [
          { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": "@xml/backup_widget_info",
            },
          },
        ],
      });
    }

    const hasService = app.service.some(
      (s) => s?.$?.["android:name"] === ".PhotogramTileService"
    );
    if (!hasService) {
      app.service.push({
        $: {
          "android:name": ".PhotogramTileService",
          "android:exported": "true",
          "android:icon": "@mipmap/ic_launcher",
          "android:label": "@string/tile_label",
          "android:permission": "android.permission.BIND_QUICK_SETTINGS_TILE",
        },
        "intent-filter": [
          { action: [{ $: { "android:name": "android.service.quicksettings.action.QS_TILE" } }] },
        ],
      });
    }
    return cfg;
  });
}

module.exports = function withPhotogramWidget(config) {
  return withWidgetManifest(withWidgetFiles(config));
};
