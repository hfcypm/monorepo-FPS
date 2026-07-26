# Android Performance Observability Requirements

## Introduction

将当前基于 ADB 的单设备 FPS 面板升级为面向大型 Android 项目的性能观测原型。系统提供开发设备实时诊断、会话级指标聚合和企业看板。

## Glossary

- **采集会话**: 一个设备和前台应用在连续运行期间产生的性能数据集合。
- **帧预算**: 设备刷新率对应的单帧时间上限，单位为毫秒。
- **卡顿帧**: 帧耗时大于帧预算的帧。
- **冻结帧**: 帧耗时大于 700 毫秒的帧。
- **指标窗口**: 1 秒内聚合的性能数据。

## Requirements

### Requirement 1: 会话采集

**User Story:** AS 性能工程师, I want 以设备和应用维度查看采集会话, so that 性能数据可以归属到明确的诊断对象。

#### Acceptance Criteria

1. WHEN 前台应用发生变化, the collector SHALL 创建或切换到对应的采集会话。
2. WHILE 采集会话处于活动状态, the collector SHALL 记录设备、应用包名、刷新率和最近采样时间。
3. WHEN ADB 命令失败, the collector SHALL 在会话中记录采集状态并保持服务可用。

### Requirement 2: 帧指标聚合

**User Story:** AS 性能工程师, I want 查看可靠的帧耗时和卡顿指标, so that 可以识别渲染回归和高风险场景。

#### Acceptance Criteria

1. WHEN 采集器取得帧耗时, the collector SHALL 按刷新率计算帧预算和卡顿帧。
2. WHEN 指标窗口结束, the collector SHALL 输出总帧数、卡顿帧数、冻结帧数、平均帧耗时、p95 和 p99 帧耗时。
3. WHILE 采集会话处于活动状态, the collector SHALL 保留最近 150 个窗口的趋势数据。

### Requirement 3: 企业性能看板

**User Story:** AS 研发管理者, I want 查看会话概览、风险状态和趋势, so that 可以优先处理影响最大的性能问题。

#### Acceptance Criteria

1. WHEN 用户打开看板, the dashboard SHALL 展示采集状态、应用、刷新率、总帧数、卡顿率、p95 和冻结帧数。
2. WHEN 采集器发布新指标, the dashboard SHALL 更新会话概览、趋势图和风险事件。
3. WHILE 看板连接处于活动状态, the dashboard SHALL 显示 WebSocket 连接状态和最近更新时间。

### Requirement 4: 严重卡顿诊断

**User Story:** AS 性能工程师, I want 在严重卡顿发生时查看上下文, so that 可以关联问题场景与线程堆栈。

#### Acceptance Criteria

1. WHEN 指标窗口包含冻结帧或严重卡顿, the collector SHALL 发布风险事件。
2. WHEN 风险事件满足采集冷却条件, the collector SHALL 请求主线程堆栈并关联当前会话。
3. IF 主线程堆栈采集失败, the collector SHALL 保留风险事件和失败状态。
