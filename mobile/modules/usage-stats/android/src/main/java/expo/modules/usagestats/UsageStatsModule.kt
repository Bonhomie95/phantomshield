package expo.modules.usagestats

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads Android UsageStats to learn which apps were foregrounded and when.
 *
 * This returns ONLY the package name and a timestamp per foreground event —
 * never any screen content, message text, or keystrokes. It is the privacy-safe
 * replacement for screen recording: there is structurally no way for chats or
 * passwords to be captured, because the API never exposes pixels.
 *
 * Requires the user to grant "Usage access" in system settings (a special
 * permission that cannot be granted by a runtime dialog).
 */
class UsageStatsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UsageStats")

    // Whether the user has granted Usage Access to this app.
    Function("hasPermission") {
      val context = appContext.reactContext ?: return@Function false
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName
      )
      mode == AppOpsManager.MODE_ALLOWED
    }

    // Open the system "Usage access" settings screen so the user can grant it.
    Function("openSettings") {
      val context = appContext.reactContext
      if (context != null) {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    // Foreground ("app opened") events in [startMs, endMs). Each item is just
    // { packageName, timestamp } — no content of any kind.
    AsyncFunction("queryForegroundEvents") { startMs: Double, endMs: Double ->
      val context = appContext.reactContext
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val events = usm.queryEvents(startMs.toLong(), endMs.toLong())
      val result = mutableListOf<Map<String, Any>>()
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
          result.add(
            mapOf(
              "packageName" to event.packageName,
              "timestamp" to event.timeStamp.toDouble()
            )
          )
        }
      }
      result
    }
  }
}
