CREATE DATABASE IF NOT EXISTS performance;

CREATE TABLE IF NOT EXISTS performance.performance_windows
(
  sessionId String,
  deviceId String,
  packageName LowCardinality(String),
  timestamp DateTime64(3, 'UTC'),
  refreshRate Float32,
  frameBudgetMs Float32,
  fps Float32,
  totalFrames UInt32,
  jankFrames UInt32,
  frozenFrames UInt32,
  averageFrameMs Float32,
  p95FrameMs Float32,
  p99FrameMs Float32,
  jankRate Float32,
  severity LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (packageName, timestamp, deviceId)
TTL timestamp + INTERVAL 180 DAY;
