/**
 * 按文件维度的每日统计。
 */
export interface FileDailyStats {
    /** 编码时间（秒） */
    codingTime: number;
    /** 按键次数 */
    keystrokes: number;
    /** 新增行数 */
    linesAdded: number;
    /** 删除行数 */
    linesDeleted: number;
}

/**
 * 按项目维度的每日统计。
 */
export interface ProjectDailyStats {
    /** 窗口活跃时间（秒） */
    activeTime: number;
    /** 有效编码时间（秒） */
    codingTime: number;
    /** 按键次数 */
    keystrokes: number;
    /** 新增行数 */
    linesAdded: number;
    /** 删除行数 */
    linesDeleted: number;
    /** 文件级明细 */
    files: Record<string, FileDailyStats>;
}

/**
 * Git 提交记录。
 */
export interface CommitRecord {
    /** Unix 时间戳（毫秒） */
    timestamp: number;
    /** 提交信息首行 */
    message: string;
    /** 完整 SHA（40 位） */
    hash: string;
    /** 所属项目 */
    project: string;
}

/**
 * 每日统计快照（以 UTC+8 自然日为准）。
 */
export interface DailyStats {
    /** 日期 YYYY-MM-DD */
    date: string;
    /** 窗口活跃总时间（秒） */
    totalActiveTime: number;
    /** 有效编码总时间（秒） */
    totalCodingTime: number;
    /** 按键总次数 */
    totalKeystrokes: number;
    /** 新增总行数 */
    totalLinesAdded: number;
    /** 删除总行数 */
    totalLinesDeleted: number;
    /** Git 提交记录 */
    commits: CommitRecord[];
    /** 项目级明细 */
    projects: Record<string, ProjectDailyStats>;
    /** 语言级明细（key = languageId，如 typescript/python） */
    languages: Record<string, FileDailyStats>;
}

/**
 * 跨日累计汇总。
 */
export interface GlobalStats {
    totalDays: number;
    totalActiveTime: number;
    totalCodingTime: number;
    totalKeystrokes: number;
    totalLinesAdded: number;
    totalLinesDeleted: number;
    totalCommits: number;
    topProjects: Array<{ name: string; time: number }>;
    topFiles: Array<{ path: string; time: number }>;
    topLanguages: Array<{ name: string; time: number }>;
}

/**
 * 日期范围。
 */
export interface DateRange {
    /** 起始日期 YYYY-MM-DD */
    start: string;
    /** 结束日期 YYYY-MM-DD（含） */
    end: string;
}

/**
 * 按日的时序数据点（供图表使用）。
 */
export interface DayDataPoint {
    date: string;
    codingTime: number;
    activeTime: number;
    keystrokes: number;
    linesAdded: number;
    linesDeleted: number;
    commits: number;
}

/**
 * 追踪器当前运行时状态。
 */
export enum TrackerState {
    /** 活跃中（窗口聚焦，用户有近期操作） */
    Active = 'active',
    /** 空闲（窗口聚焦但用户暂时无操作） */
    Idle = 'idle',
    /** 离开（窗口失焦或长时间无操作） */
    Away = 'away',
}

/**
 * 导出格式。
 */
export type ExportFormat = 'txt' | 'json' | 'csv' | 'md';

/**
 * 显示视图类型。
 */
export type ViewType = 'today' | 'week' | 'month' | 'all' | 'sessions';

// ========== 智能番茄钟 ==========

/** 番茄钟当前阶段。 */
export enum PomodoroPhase {
    Idle = 'idle',
    Focusing = 'focusing',
    ShortBreak = 'shortBreak',
    LongBreak = 'longBreak',
}

/** 番茄钟可配置项。 */
export interface PomodoroSettings {
    /** 专注时长（秒），默认 1500（25 分钟） */
    focusDuration: number;
    /** 短休息时长（秒），默认 300（5 分钟） */
    shortBreakDuration: number;
    /** 长休息时长（秒），默认 900（15 分钟） */
    longBreakDuration: number;
    /** 几次专注后进入长休息，默认 4 */
    longBreakInterval: number;
    /** 专注结束时自动开始休息 */
    autoStartBreak: boolean;
    /** 休息结束时自动开始下一轮专注 */
    autoStartFocus: boolean;
    /** 启用智能推荐（根据用户行为节奏调整专注时长） */
    enableSmartRecommend: boolean;
}

// ========== 文件会话计时器 ==========

/** 会话计时器状态。 */
export enum SessionTimerState {
    Idle = 'idle',
    Running = 'running',
    Paused = 'paused',
}

/** 暂停区间。 */
export interface PauseInterval {
    start: number; // Unix 时间戳 ms
    end: number;   // Unix 时间戳 ms（-1 表示尚未恢复）
}

/** 单次文件会话记录。 */
export interface SessionRecord {
    /** 唯一标识 */
    id: string;
    /** 工作区相对路径 */
    filePath: string;
    /** 文件名（末段，显示用） */
    fileName: string;
    /** 所属项目 */
    project: string;
    /** 活跃时长（秒），不含暂停 */
    duration: number;
    /** 会话期间的按键增量 */
    keystrokes: number;
    /** 会话期间的新增行增量 */
    linesAdded: number;
    /** 会话期间的删除行增量 */
    linesDeleted: number;
    /** 开始时间戳 ms */
    startTime: number;
    /** 结束时间戳 ms */
    endTime: number;
    /** 暂停区间列表 */
    pauses: PauseInterval[];
}

/** 文件统计快照（用于计算会话期间的增量）。 */
export interface FileStatsSnapshot {
    keystrokes: number;
    linesAdded: number;
    linesDeleted: number;
}
