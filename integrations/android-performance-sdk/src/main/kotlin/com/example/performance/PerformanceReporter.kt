package com.example.performance

import android.app.Activity
import android.os.Build
import androidx.metrics.performance.JankStats
import androidx.metrics.performance.PerformanceMetricsState
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.ceil
import org.json.JSONArray
import org.json.JSONObject

data class PerformanceReporterConfig(
    val endpoint: String,
    val appVersion: String,
    val ingestionToken: String? = null,
    val deviceId: String = "${Build.MANUFACTURER}-${Build.MODEL}",
    val windowMillis: Long = 10_000,
    val maxPendingWindows: Int = 200,
)

class PerformanceReporter(
    private val activity: Activity,
    private val config: PerformanceReporterConfig,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val sessionId = UUID.randomUUID().toString()
    private val frameDurations = mutableListOf<Long>()
    private var jankFrames = 0
    private var startedAt = System.currentTimeMillis()
    private var scene = activity.javaClass.simpleName
    private val pendingStore = activity.getSharedPreferences("performance-reporter", Activity.MODE_PRIVATE)
    private val metricsState = PerformanceMetricsState.getHolderForHierarchy(
        activity.findViewById(android.R.id.content),
    )
    private val jankStats = JankStats.createAndTrack(activity.window) { frameData -> onFrame(frameData) }

    init {
        metricsState.state?.putState("screen", scene)
        executor.execute { drainQueue() }
    }

    fun setScene(name: String) {
        scene = name
        metricsState.state?.putState("screen", name)
    }

    fun onResume() {
        jankStats.isTrackingEnabled = true
    }

    fun onPause() {
        jankStats.isTrackingEnabled = false
        flush()
    }

    fun close() {
        flush()
        executor.shutdown()
    }

    @Synchronized
    private fun onFrame(frameData: JankStats.FrameData) {
        frameDurations += frameData.frameDurationUiNanos
        if (frameData.isJank) jankFrames += 1
        if (System.currentTimeMillis() - startedAt >= config.windowMillis) flush()
    }

    @Synchronized
    private fun flush() {
        if (frameDurations.isEmpty()) return

        val durations = frameDurations.map { it / 1_000_000.0 }
        val refreshRate = activity.display?.refreshRate?.toDouble() ?: 60.0
        val sorted = durations.sorted()
        val frozenFrames = durations.count { it > 700 }
        val payload = JSONObject().apply {
            put("deviceId", config.deviceId)
            put("packageName", activity.packageName)
            put("appVersion", config.appVersion)
            put("androidVersion", Build.VERSION.SDK_INT.toString())
            put("scene", scene)
            put("refreshRate", refreshRate)
            put("windowMs", config.windowMillis)
            put("totalFrames", durations.size)
            put("jankFrames", jankFrames)
            put("frozenFrames", frozenFrames)
            put("averageFrameMs", durations.average())
            put("p95FrameMs", percentile(sorted, 0.95))
            put("p99FrameMs", percentile(sorted, 0.99))
            put("sessionId", sessionId)
        }.toString()

        frameDurations.clear()
        jankFrames = 0
        startedAt = System.currentTimeMillis()
        executor.execute {
            enqueue(payload)
            drainQueue()
        }
    }

    private fun enqueue(payload: String) {
        val queue = JSONArray(pendingStore.getString("pendingWindows", "[]"))
        queue.put(payload)
        while (queue.length() > config.maxPendingWindows) queue.remove(0)
        pendingStore.edit().putString("pendingWindows", queue.toString()).apply()
    }

    private fun drainQueue() {
        val queue = JSONArray(pendingStore.getString("pendingWindows", "[]"))
        var delivered = 0
        while (delivered < queue.length() && postWithRetry(queue.getString(delivered))) delivered += 1
        if (delivered == 0) return

        val remaining = JSONArray()
        for (index in delivered until queue.length()) remaining.put(queue.getString(index))
        pendingStore.edit().putString("pendingWindows", remaining.toString()).apply()
    }

    private fun postWithRetry(payload: String): Boolean {
        repeat(3) { attempt ->
            try {
                post(payload)
                return true
            } catch (_: IOException) {
                if (attempt < 2) Thread.sleep(500L * (attempt + 1))
            }
        }
        return false
    }

    private fun post(payload: String) {
        val connection = (URL(config.endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 5_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            config.ingestionToken?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            connection.outputStream.use { it.write(payload.toByteArray()) }
            if (connection.responseCode !in 200..299) throw IOException("性能上报失败")
        } finally {
            connection.disconnect()
        }
    }

    private fun percentile(values: List<Double>, ratio: Double): Double {
        return values[(ceil(values.size * ratio).toInt() - 1).coerceIn(0, values.lastIndex)]
    }
}
