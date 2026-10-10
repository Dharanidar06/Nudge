package com.example.nudge

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

object ReminderScheduler {
    private const val PREFERENCES = "nudge_native"
    private const val REMINDERS_KEY = "reminders"
    private const val CHANNEL_ID = "daily_reminders"
    private const val TAG = "NudgeReminders"

    fun saveAndSchedule(context: Context, serializedReminders: String): String {
        return try {
            val reminders = JSONArray(serializedReminders)
            validate(reminders)
            val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            val previousReminders = JSONArray(preferences.getString(REMINDERS_KEY, "[]") ?: "[]")
            val activeIds = (0 until reminders.length())
                .map { reminders.getJSONObject(it).getString("id") }
                .toSet()
            for (index in 0 until previousReminders.length()) {
                val removedId = previousReminders.getJSONObject(index).getString("id")
                if (removedId !in activeIds) cancel(context, removedId)
            }
            val saved = preferences
                .edit()
                .putString(REMINDERS_KEY, reminders.toString())
                .commit()
            if (!saved) {
                throw IllegalStateException("Android could not save your reminder settings.")
            }
            scheduleAll(context, reminders)
            "ok: Reminders saved and Android alarms updated."
        } catch (exception: Exception) {
            Log.e(TAG, "Could not persist or schedule reminders.", exception)
            "error: ${exception.message ?: "Android could not schedule these reminders."}"
        }
    }

    fun scheduleSaved(context: Context) {
        val serialized = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(REMINDERS_KEY, "[]") ?: "[]"
        try {
            val reminders = JSONArray(serialized)
            validate(reminders)
            scheduleAll(context, reminders)
        } catch (exception: Exception) {
            Log.e(TAG, "Could not restore reminders from device storage.", exception)
        }
    }

    private fun validate(reminders: JSONArray) {
        for (index in 0 until reminders.length()) {
            val reminder = reminders.getJSONObject(index)
            val id = reminder.getString("id")
            val title = reminder.getString("title")
            val note = reminder.getString("note")
            val startMinute = reminder.getInt("startMinute")
            val endMinute = reminder.getInt("endMinute")
            val interval = reminder.getInt("intervalMinutes")
            val avatar = reminder.getString("avatar")
            if (
                id.isBlank() ||
                title.isBlank() ||
                note.isBlank() ||
                startMinute !in 0..1439 ||
                endMinute !in (startMinute + 1)..1439 ||
                interval !in 15..720 ||
                (avatar != "girl" && avatar != "boy")
            ) {
                throw IllegalArgumentException("One of your reminders has invalid settings.")
            }
            reminder.getBoolean("enabled")
        }
    }

    private fun scheduleAll(context: Context, reminders: JSONArray) {
        for (index in 0 until reminders.length()) {
            scheduleNext(context, reminders.getJSONObject(index))
        }
    }

    private fun scheduleNext(context: Context, reminder: JSONObject) {
        val id = reminder.getString("id")
        val pendingIntent = alarmPendingIntent(context, id)
        if (!reminder.getBoolean("enabled")) {
            context.getSystemService(AlarmManager::class.java).cancel(pendingIntent)
            return
        }

        val occurrence = nextOccurrence(
            startMinute = reminder.getInt("startMinute"),
            endMinute = reminder.getInt("endMinute"),
            intervalMinutes = reminder.getInt("intervalMinutes"),
            after = LocalDateTime.now(),
        )
        if (occurrence == null) {
            context.getSystemService(AlarmManager::class.java).cancel(pendingIntent)
            return
        }
        val triggerAt = occurrence.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val manager = context.getSystemService(AlarmManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        } else {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        }
    }

    internal fun nextOccurrence(
        startMinute: Int,
        endMinute: Int,
        intervalMinutes: Int,
        after: LocalDateTime,
    ): LocalDateTime? {
        for (dayOffset in 0..1) {
            val date = after.toLocalDate().plusDays(dayOffset.toLong())
            var minute = startMinute
            while (minute <= endMinute) {
                val candidate = LocalDateTime.of(date, LocalTime.of(minute / 60, minute % 60))
                if (candidate.isAfter(after)) return candidate
                minute += intervalMinutes
            }
        }
        return null
    }

    private fun alarmPendingIntent(context: Context, id: String): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setData(Uri.parse("nudge://reminder/$id"))
            .putExtra(ReminderReceiver.EXTRA_REMINDER_ID, id)
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun cancel(context: Context, id: String) {
        context.getSystemService(AlarmManager::class.java).cancel(alarmPendingIntent(context, id))
    }

    internal fun showReminderNotification(context: Context, reminder: JSONObject) {
        ReminderReceiver.createNotificationChannel(context)
        val reminderId = reminder.getString("id")
        val launchIntent = Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(ReminderReceiver.EXTRA_REMINDER_ID, reminderId)
        val contentIntent = PendingIntent.getActivity(
            context,
            reminderId.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(reminder.getString("title"))
            .setContentText(reminder.getString("note"))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setPriority(Notification.PRIORITY_HIGH)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(reminderId.hashCode(), notification)
    }

    internal fun reminderById(context: Context, reminderId: String): JSONObject? {
        val reminders = JSONArray(
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .getString(REMINDERS_KEY, "[]") ?: "[]",
        )
        for (index in 0 until reminders.length()) {
            val reminder = reminders.getJSONObject(index)
            if (reminder.getString("id") == reminderId) return reminder
        }
        return null
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val reminder = ReminderScheduler.reminderById(context, reminderId) ?: return
        if (!reminder.getBoolean("enabled")) return

        try {
            ReminderScheduler.showReminderNotification(context, reminder)
        } catch (exception: SecurityException) {
            Log.e(TAG, "Notification permission has not been granted.", exception)
        } catch (exception: Exception) {
            Log.e(TAG, "Could not show the reminder notification.", exception)
        } finally {
            try {
                ReminderScheduler.scheduleSaved(context)
            } catch (exception: Exception) {
                Log.e(TAG, "Could not schedule the next daily reminder.", exception)
            }
        }
    }

    companion object {
        const val EXTRA_REMINDER_ID = "reminder_id"
        private const val TAG = "NudgeReminders"
        private const val CHANNEL_ID = "daily_reminders"

        fun createNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.getSystemService(NotificationManager::class.java)
                    .createNotificationChannel(
                        NotificationChannel(
                            CHANNEL_ID,
                            "Daily reminders",
                            NotificationManager.IMPORTANCE_HIGH,
                        ).apply {
                            description = "Your scheduled daily Nudge reminders"
                            enableVibration(true)
                        },
                    )
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.TIME_SET",
            "android.intent.action.TIMEZONE_CHANGED",
            Intent.ACTION_MY_PACKAGE_REPLACED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> {
                ReminderScheduler.scheduleSaved(context)
            }
        }
    }
}
