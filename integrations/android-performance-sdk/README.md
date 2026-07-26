# Android Performance SDK

该 SDK 是独立 Gradle Library，无需作为业务工程的 Module 引入。SDK 使用 `androidx.metrics:metrics-performance:1.0.0`。

## 构建与发布

在该目录执行以下命令，将 AAR、POM 和源码包发布到独立的本地 Maven 目录：

```bash
gradle publishReleasePublicationToLocalReleaseRepository
```

制品输出至 `build/repo/com/company/performance/android-performance-sdk/1.0.0/`。CI 可将该目录上传至公司 Maven 制品库，并通过 `gradle.properties` 中的 `GROUP` 与 `VERSION_NAME` 管理坐标和版本。

业务工程添加 Maven 仓库和制品依赖：

```kotlin
repositories {
    maven { url = uri("https://maven.example.com/releases") }
}

dependencies {
    implementation("com.company.performance:android-performance-sdk:1.0.0")
}
```

## 使用

在 Activity 中创建并管理采集器：

```kotlin
private lateinit var reporter: PerformanceReporter

override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    reporter = PerformanceReporter(
        this,
        PerformanceReporterConfig(
            endpoint = "https://performance.example.com/api/ingest/windows",
            appVersion = BuildConfig.VERSION_NAME,
        ),
    )
    reporter.setScene("Feed")
}

override fun onResume() {
    super.onResume()
    reporter.onResume()
}

override fun onPause() {
    reporter.onPause()
    super.onPause()
}
```

采集器每 10 秒聚合一次 JankStats 数据并异步上报。上报窗口先写入 `SharedPreferences` 队列，网络恢复后按顺序提交，队列默认保留 200 个窗口。服务端设置 `PERFORMANCE_INGEST_TOKEN` 后会校验 Bearer Token。生产环境应通过应用的认证层提供短期令牌。
