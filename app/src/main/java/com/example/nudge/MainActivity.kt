package com.example.nudge

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var openedReminderId: String? = null

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        webView.evaluateJavascript(
            "window.onNativeNotificationPermissionChanged && window.onNativeNotificationPermissionChanged()",
            null,
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ReminderReceiver.createNotificationChannel(this)
        openedReminderId = intent.getStringExtra(ReminderReceiver.EXTRA_REMINDER_ID)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            addJavascriptInterface(NudgeWebBridge(this@MainActivity), "NudgeNative")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    return !request.url.toString().startsWith(APP_ASSETS_URL)
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    openPendingReminder()
                    view.evaluateJavascript(
                        "window.onNativeNotificationPermissionChanged && window.onNativeNotificationPermissionChanged()",
                        null,
                    )
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openedReminderId = intent.getStringExtra(ReminderReceiver.EXTRA_REMINDER_ID)
        openPendingReminder()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            ReminderScheduler.scheduleSaved(this)
            webView.evaluateJavascript(
                "window.onNativeNotificationPermissionChanged && window.onNativeNotificationPermissionChanged()",
                null,
            )
        }
    }

    private fun openPendingReminder() {
        val reminderId = openedReminderId ?: return
        openedReminderId = null
        webView.post {
            webView.evaluateJavascript(
                "window.openNudgeReminder && window.openNudgeReminder(${JSONObject.quote(reminderId)})",
                null,
            )
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private companion object {
        const val APP_ASSETS_URL = "file:///android_asset/www/"
    }

    class NudgeWebBridge(private val activity: Activity) {
        @JavascriptInterface
        fun syncReminders(serializedReminders: String): String {
            return ReminderScheduler.saveAndSchedule(activity.applicationContext, serializedReminders)
        }

        @JavascriptInterface
        fun hasNotificationPermission(): Boolean {
            return Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(
                    activity,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
        }

        @JavascriptInterface
        fun requestNotificationPermission() {
            activity.runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33 && !hasNotificationPermission()) {
                    (activity as? MainActivity)?.notificationPermissionLauncher
                        ?.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }

        @JavascriptInterface
        fun canScheduleExactAlarms(): Boolean {
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                activity.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
        }

        @JavascriptInterface
        fun requestExactAlarmPermission() {
            activity.runOnUiThread {
                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    !canScheduleExactAlarms()
                ) {
                    try {
                        activity.startActivity(
                            Intent(
                                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                Uri.parse("package:${activity.packageName}"),
                            ),
                        )
                    } catch (exception: Exception) {
                        Log.e(TAG, "Could not open exact alarm settings.", exception)
                    }
                }
            }
        }

        private companion object {
            const val TAG = "NudgeWebBridge"
        }
    }
}
