# Work Time

VS Code 扩展，自动追踪编辑器使用时长、有效编码时间、按键次数、代码行变更和 Git 提交记录，并在 Webview 面板中提供可视化统计。

## 功能特性

- **自动追踪** — 扩展随 VS Code 启动自动激活，无需手动干预
- **三态计时** — 区分"活跃 / 空闲 / 离开"三种状态，确保编码时间的准确性
- **智能空闲检测** — 支持自定义空闲/离开阈值，内置 P90 自适应算法动态调整
- **Git 提交关联** — 自动监听 Git 仓库的提交事件，记录每次提交的时间和信息
- **多维度统计** — 编码时间、活跃时间、按键次数、新增/删除行数，按项目、文件、语言分级汇总
- **可视化面板** — Webview Panel 提供今日/本周/本月/全部/会话五种视图，含柱状图、环形图和热力图
- **热力图日历** — GitHub 风格的编码日历，直观展示每日编码活跃度
- **多格式导出** — 支持 TXT、Markdown、JSON、CSV 四种格式导出统计报告
- **数据持久化** — 每日数据独立存储为 JSON 文件，按 YYYY-MM-DD 索引，支持跨日自动归档
- **智能番茄钟** — 基于用户自适应节奏推荐专注时长，支持自动暂停/恢复
- **文件会话计时** — 右键文件开始计时，切换编辑器自动暂停，切回自动恢复
- **侧边栏面板** — Activity Bar 侧边栏显示今日概览、快捷操作和最近会话
- **刷题记录** — 支持记录每日刷题数量，追踪学习进度
- **中文本地化** — 命令和 UI 界面全面中文化

## 架构原理

```
src/
├── extension.ts        # 入口：生命周期管理、命令注册、状态栏
├── tracker.ts          # 核心追踪引擎
├── storage.ts          # 数据持久化层
├── webview.ts          # Webview 面板管理
├── reporter.ts         # 多格式报告导出
├── adaptive.ts         # P90 自适应空闲阈值
├── types.ts            # TypeScript 类型定义
├── tools/
│   ├── pomodoro.ts     # 智能番茄钟
│   ├── session-timer.ts # 文件会话计时器
│   └── sidebar.ts      # 侧边栏 Tree View
├── webview/
│   ├── main.ts         # Webview 前端逻辑（图表、热力图）
│   └── styles.ts       # Webview 样式
└── __tests__/          # 单元测试
```

### 1. 追踪引擎 (`tracker.ts`)

每秒轮询一次，基于 `Date.now()` 和 `lastActivityTime` 计算空闲时长：

```
lastActivityTime ──┬── < idleTimeout ──→ Active  （计入 activeTime + codingTime）
                   ├── idleTimeout ~ afkTimeout ──→ Idle    （仅计 activeTime）
                   └── > afkTimeout ──→ Away    （不计时）
```

**活动事件触发器：**

- `onDidChangeTextDocument` — 编辑文档
- `onDidChangeActiveTextEditor` — 切换编辑器标签
- `onDidChangeWindowState` — 窗口聚焦/失焦

**行数统计原理：**

- 监听 `onDidChangeTextDocument`
- 解析每个 `contentChanges` 的 `range` 和 `text`
- `linesDeleted = range.end.line - range.start.line`
- `linesAdded = text.split('\n').length - 1`
- 按键次数 = `max(1, text.length)`，每个 change 至少计 1 次

**Git 集成原理：**

- 通过 `vscode.extensions.getExtension('vscode.git')` 获取 VS Code 内置 Git 扩展的 API
- 遍历 `api.repositories`，记录每个仓库的初始 HEAD commit
- 监听 `repo.state.onDidChange`，检测 HEAD 变化
- 变化时调用 `repo.log({maxEntries: 1})` 获取最新提交详情
- 记录到当日 `commits` 数组

### 2. 数据持久化 (`storage.ts`)

```
globalStorage/
└── stats/
    ├── 2026-05-24.json
    ├── 2026-05-25.json
    └── 2026-05-26.json
```

- 数据格式：`DailyStats` 对象的 JSON 序列化
- 每 60 秒自动保存一次，扩展停用时强制保存
- 跨日检测：每秒检查 UTC+8 日期，日期变更时保存昨日数据、重置计数器
- 汇总接口 `summarize(dates)`：跨多日聚合，计算 Top 10 项目和文件

### 3. 自适应阈值 (`adaptive.ts`)

基于用户的实际活跃模式自动调整空闲检测阈值：

1. 维护最近 200 次活动间隔的滑动窗口
2. 过滤异常值（仅保留 1s ~ 1h 之间的间隔）
3. 计算第 90 百分位数（P90）
4. 将 P90（毫秒）转为秒作为新的 `idleTimeout`
5. 每天仅在跨日时执行一次，变化 < 30 秒不触发更新
6. `afkTimeout` 自动设为 `idleTimeout × 2`

**配置边界：**

- 最小 idleTimeout：60 秒
- 最大 idleTimeout：900 秒（15 分钟）

### 4. Webview 面板 (`webview.ts`)

纯 HTML/CSS/JS 实现，无外部依赖：

- **Canvas 柱状图** — 每日编码时间，Y 轴自适应刻度
- **CSS 条形图** — 项目分布，基于 `--vscode-charts-blue` 等 VS Code 主题变量
- **提交列表** — 最近 10 条 Git 提交，显示 SHA(7位)、消息、项目
- **视图切换** — 通过 `postMessage` 与扩展通信，触发数据重新加载

面板通过 `retainContextWhenHidden: true` 保持状态，切换标签页不会丢失数据。

### 5. 报告导出 (`reporter.ts`)

| 格式 | 特点 |
|---|---|
| TXT | 纯文本，带 === 分隔符 |
| Markdown | 表格排版，适合 README / 文档 |
| JSON | 完整结构化数据，含 `daily` 数组和 `summary` 汇总 |
| CSV | 扁平化日统计，可导入 Excel/Google Sheets |

## 安装与运行

### 开发环境

```bash
git clone https://github.com/readant/Work-Time
cd Work-Time
npm install
npm run compile    # 构建到 dist/
npm test           # 运行单元测试
```

在 VS Code 中按 **F5** 启动 Extension Development Host 进行调试。

### 构建生产包

```bash
npm run package    # 生成 .vsix 安装包
```

### 从 VSIX 安装

```bash
code --install-extension work-time-0.3.0.vsix
```

或通过 VS Code 扩展面板 → "从 VSIX 安装"。

## 使用说明

### 状态栏

右下角状态栏显示当前编码分钟数，图标表示追踪状态：

| 图标 | 含义 |
|---|---|
| `$(pulse)` ● | 活跃中 |
| `$(history)` ◐ | 空闲 |
| `$(circle-slash)` ○ | 离开 |

悬停状态栏可查看详细数据（活跃时间、编码时间、按键数、行变更、提交数）。

### 查看统计

两种方式打开统计面板：

- 点击状态栏
- `Ctrl+Shift+P` → 搜索 "显示编码统计"

面板包含五个视图：

- **今日** — 当前自然日的统计数据
- **本周** — 本周一至周日的汇总
- **本月** — 本月 1 日至今天/月末的汇总
- **全部** — 所有历史数据的汇总
- **会话** — 文件会话计时记录

### 侧边栏

Activity Bar 中的 "Work Time" 侧边栏提供：

- **今日概览** — 状态、编码时间、活跃时间、效率、按键、行变更、提交数
- **快捷操作** — 开始计时、启动番茄钟、打开统计面板
- **最近会话** — 最近 5 条文件会话记录

### 智能番茄钟

`Ctrl+Shift+P` → 搜索 "Start Pomodoro" 启动番茄钟：

- 基于用户自适应节奏智能推荐专注时长
- 状态栏实时显示倒计时和进度条
- 自动检测离开/返回，暂停/恢复计时
- 支持短休息和长休息（可配置间隔）
- 可跳过休息直接开始下一轮专注

### 文件会话计时

右键文件 → "开始计时"：

- 计时器绑定该文件，切换到其他文件自动暂停
- 切回原文件自动恢复计时
- 结束时保存会话记录（时长、按键、行变更）
- 侧边栏显示最近会话记录

### 导出报告

`Ctrl+Shift+P` → 搜索 "导出统计报告" → 选择格式 → 选择保存路径。

## 配置项

在 VS Code 设置中搜索 `workTime` 可调整：

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `workTime.idleTimeout` | number | 300 | 空闲检测阈值（秒），无操作超过此时间进入 idle 状态 |
| `workTime.afkTimeout` | number | 600 | 离开检测阈值（秒），无操作超过此时间进入 away 状态，停止计时 |
| `workTime.dataDir` | string | "" | 自定义数据存储目录，留空使用 VS Code 全局存储路径 |
| `workTime.pomodoro.focusDuration` | number | 1500 | 专注时长（秒），默认 1500 = 25 分钟 |
| `workTime.pomodoro.shortBreakDuration` | number | 300 | 短休息时长（秒），默认 300 = 5 分钟 |
| `workTime.pomodoro.longBreakDuration` | number | 900 | 长休息时长（秒），默认 900 = 15 分钟 |
| `workTime.pomodoro.longBreakInterval` | number | 4 | 几次专注后进入长休息 |
| `workTime.pomodoro.autoStartBreak` | boolean | false | 专注结束时是否自动开始休息 |
| `workTime.pomodoro.autoStartFocus` | boolean | false | 休息结束时是否自动开始下一轮专注 |
| `workTime.pomodoro.enableSmartRecommend` | boolean | true | 启用在自适应阈值基础上智能推荐专注时长 |

> **注意**：启用自适应阈值后，`idleTimeout` 和 `afkTimeout` 会被算法自动调整。如需固定阈值，可将阈值设为极值（如 9999 秒）来禁用自适应效果。

## 技术栈

- TypeScript 5.3+（node16 模块系统）
- esbuild（零运行时依赖的单文件打包）
- VS Code Extension API（^1.85.0）
- VS Code Git Extension API（提交监听）
- 纯 Canvas / CSS（Webview 图表、热力图）
- Vitest（单元测试框架）

## 许可

MIT License
