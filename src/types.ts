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
export type ViewType = 'today' | 'week' | 'month' | 'all';
