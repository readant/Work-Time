/**
 * Webview 前端逻辑。
 *
 * 此模块导出 initWebview() 函数，在 webview HTML 加载后执行。
 * 所有 DOM 操作和 Canvas 绘制逻辑都在此文件中。
 */

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

// ===== 配色 =====
const PALETTE = [
    '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
    '#4dd0e1', '#aed581', '#ff8a65', '#9575cd', '#f06292',
];

let isDark = true;
let currentView = 'today';

function getChartColors() {
    return isDark ? {
        blue: '#4fc3f7', green: '#81c784', orange: '#ffb74d',
        red: '#e57373', purple: '#ba68c8', gray: '#78909c',
        bg: '#1e1e1e', grid: '#3a3a3a', text: '#bbb', bar: '#4fc3f7',
    } : {
        blue: '#0288d1', green: '#388e3c', orange: '#f57c00',
        red: '#d32f2f', purple: '#7b1fa2', gray: '#546e7a',
        bg: '#fafafa', grid: '#e0e0e0', text: '#666', bar: '#1976d2',
    };
}

// ===== 工具函数 =====
function fmtDuration(sec: number): string {
    if (!sec || sec <= 0) return '0m';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

function fmtNum(n: number): string {
    return (n || 0).toLocaleString();
}

function fmtTimeRange(start: number, end: number): string {
    const s = new Date(start), e = new Date(end);
    const pad = (n: number) => String(n).padStart(2, '0');
    return pad(s.getHours()) + ':' + pad(s.getMinutes()) + ' - ' + pad(e.getHours()) + ':' + pad(e.getMinutes());
}

// ===== 环形图 =====
function drawDonut(
    id: string,
    items: Array<{ label: string; value: number; color?: string }>,
    colors: ReturnType<typeof getChartColors>,
    centerLabel: string
) {
    const c = document.getElementById(id); if (!c) return;
    const W = (c as HTMLCanvasElement).width, H = (c as HTMLCanvasElement).height;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 16;
    const ir = r * 0.6;
    const total = items.reduce((s, i) => s + (i.value || 0), 0);
    const ctx = (c as HTMLCanvasElement).getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    if (total === 0) {
        ctx.fillStyle = colors.text;
        ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('暂无数据', cx, cy);
        return;
    }

    let angle = -Math.PI / 2;
    items.forEach((item, i) => {
        const slice = (item.value / total) * Math.PI * 2;
        if (slice <= 0) return;
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle, angle + slice);
        ctx.arc(cx, cy, ir, angle + slice, angle, true);
        ctx.closePath();
        ctx.fillStyle = item.color || PALETTE[i % PALETTE.length];
        ctx.fill();
        ctx.strokeStyle = colors.bg; ctx.lineWidth = 2;
        ctx.stroke();
        angle += slice;
    });

    ctx.fillStyle = colors.text; ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText(centerLabel, cx, cy - 7);
    ctx.fillStyle = isDark ? '#eee' : '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(fmtDuration(total), cx, cy + 12);

    const legendMap: Record<string, string> = {
        donutProject: 'legendProject',
        donutLang: 'legendLang',
        donutState: 'legendState',
    };
    const legendEl = document.getElementById(legendMap[id] || '');
    if (legendEl) {
        legendEl.innerHTML = items.map((item, i) => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            return '<div class="legend-item">' +
                '<div class="legend-dot" style="background:' + (item.color || PALETTE[i % PALETTE.length]) + '"></div>' +
                '<span class="legend-name">' + item.label + '</span>' +
                '<span class="legend-val">' + fmtDuration(item.value) + ' (' + pct + '%)</span>' +
                '</div>';
        }).join('');
    }
}

// ===== 柱状图 + 趋势线 =====
function drawBarChart(id: string, pts: Array<{ date: string; codingTime: number }>, colors: ReturnType<typeof getChartColors>) {
    const c = document.getElementById(id) as HTMLCanvasElement; if (!c) return;
    const W = c.width = Math.max(500, c.parentElement?.clientWidth || 700);
    const H = c.height = 240;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    if (!pts.length) return;

    const pad = { top: 10, right: 24, bottom: 36, left: 44 };
    const cw = W - pad.left - pad.right;
    const ch = H - pad.top - pad.bottom;
    const maxVal = Math.max(...pts.map(p => p.codingTime), 1);
    const barW = Math.min(32, Math.max(6, (cw / pts.length) * 0.6));
    const gap = (cw - barW * pts.length) / (pts.length + 1);

    // Y 轴刻度
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.5;
    ctx.fillStyle = colors.text; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const val = (maxVal / 4) * i;
        const y = pad.top + ch - (val / maxVal) * ch;
        ctx.beginPath(); ctx.setLineDash([3, 3]);
        ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText(fmtDuration(val), pad.left - 6, y + 4);
    }

    // 7 日移动平均
    const ma: number[] = [];
    for (let i = 0; i < pts.length; i++) {
        const w = pts.slice(Math.max(0, i - 3), Math.min(pts.length, i + 4));
        ma.push(w.reduce((s, p) => s + p.codingTime, 0) / w.length);
    }

    // 趋势线
    ctx.beginPath(); ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 2;
    ctx.setLineDash([]);
    let first = true;
    pts.forEach((p, i) => {
        const x = pad.left + gap + barW / 2 + i * (barW + gap);
        const y = pad.top + ch - (ma[i] / maxVal) * ch;
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 均值虚线
    const avg = pts.reduce((s, p) => s + p.codingTime, 0) / pts.length;
    const avgY = pad.top + ch - (avg / maxVal) * ch;
    ctx.beginPath(); ctx.strokeStyle = colors.text; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(pad.left, avgY); ctx.lineTo(W - pad.right, avgY);
    ctx.stroke(); ctx.setLineDash([]);

    // 柱子
    pts.forEach((p, i) => {
        const x = pad.left + gap + i * (barW + gap);
        const h = (p.codingTime / maxVal) * ch;
        const y = pad.top + ch - h;
        const r = Math.min(4, barW / 2);
        const grad = ctx.createLinearGradient(x, y, x, pad.top + ch);
        grad.addColorStop(0, colors.blue);
        grad.addColorStop(0.5, colors.bar);
        grad.addColorStop(1, isDark ? 'rgba(79,195,247,.15)' : 'rgba(25,118,210,.1)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, pad.top + ch);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, pad.top + ch);
        ctx.closePath();
        ctx.fill();

        const label = p.date.length >= 10 ? p.date.slice(5) : p.date;
        const today = new Date().toISOString().slice(5, 10);
        ctx.fillStyle = label === today ? '#4fc3f7' : colors.text;
        ctx.font = (label === today ? 'bold ' : '') + '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barW / 2, H - 8);
    });
}

// ===== 热力图 =====
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawHeatmap(id: string, pts: Array<{ date: string; codingTime: number }>, colors: ReturnType<typeof getChartColors>) {
    const c = document.getElementById(id) as HTMLCanvasElement; if (!c) return;
    const W = c.width = Math.max(720, c.parentElement?.clientWidth || 720);
    const H = c.height = 140;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    const dataMap: Record<string, number> = {};
    pts.forEach(p => { dataMap[p.date] = p.codingTime; });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const todayStr = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(currentDay).padStart(2, '0');

    const monthList: Array<{ year: number; month: number }> = [];
    for (let m = 0; m <= currentMonth; m++) {
        monthList.push({ year: currentYear, month: m });
    }

    function getDaysInMonth(year: number, month: number) {
        return new Date(year, month + 1, 0).getDate();
    }

    function getFirstDayOfWeek(year: number, month: number) {
        return new Date(year, month, 1).getDay();
    }

    let maxVal = 1;
    for (const dateStr in dataMap) {
        if (dataMap[dateStr] > maxVal) maxVal = dataMap[dateStr];
    }

    function heatColor(val: number) {
        if (val <= 0) return isDark ? '#161b22' : '#ebedf0';
        const lvl = Math.min(4, Math.ceil((val / maxVal) * 4) - 1);
        if (isDark) {
            return ['#0e4429', '#006d32', '#26a641', '#39d353'][Math.max(0, lvl)];
        } else {
            return ['#9be9a8', '#40c463', '#30a14e', '#216e39'][Math.max(0, lvl)];
        }
    }

    const cellSize = 14;
    const cellGap = 2;
    const monthGap = 12;
    const pad = { top: 22, left: 30, right: 16, bottom: 8 };
    const totalMonths = monthList.length;
    const monthWidth = cellSize * 7 + cellGap * 6;
    const startX = pad.left;

    const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
    ctx.fillStyle = colors.text;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    dayLabels.forEach((label, i) => {
        const y = pad.top + 4 + i * (cellSize + cellGap) + cellSize / 2 + 1;
        ctx.fillText(label, pad.left - 4, y);
    });

    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    monthList.forEach((item, idx) => {
        const monthX = startX + idx * (monthWidth + monthGap);
        const daysInMonth = getDaysInMonth(item.year, item.month);
        const firstDay = getFirstDayOfWeek(item.year, item.month);
        const isCurrentMonth = (item.year === currentYear && item.month === currentMonth);

        ctx.fillStyle = isCurrentMonth ? (isDark ? '#4fc3f7' : '#1976d2') : colors.text;
        ctx.font = isCurrentMonth ? 'bold 9px sans-serif' : '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(monthNames[item.month], monthX + monthWidth / 2, pad.top - 6);

        if (isCurrentMonth) {
            ctx.strokeStyle = isDark ? '#58a6ff' : '#1a7f37';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(monthX - 3, pad.top - 1, monthWidth + 6, 5 * (cellSize + cellGap) + cellGap + 6);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayOfWeek = (firstDay + day - 1) % 7;
            const week = Math.floor((firstDay + day - 1) / 7);
            const cellX = monthX + dayOfWeek * (cellSize + cellGap);
            const cellY = pad.top + 4 + week * (cellSize + cellGap);
            const dateStr = item.year + '-' + String(item.month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            if (dateStr > todayStr) continue;

            const val = dataMap[dateStr] || 0;
            ctx.fillStyle = heatColor(val);
            ctx.beginPath();
            roundRectPath(ctx, cellX, cellY, cellSize, cellSize, 2);
            ctx.fill();

            if (dateStr === todayStr) {
                ctx.strokeStyle = isDark ? '#58a6ff' : '#1a7f37';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    });

    const legendEl = document.getElementById('legendHeat');
    if (legendEl) {
        let leg = '<span style="font-size:10px;color:' + colors.text + '">少 </span>';
        for (let lvl = 0; lvl < 4; lvl++) {
            const val = lvl === 0 ? 0 : (maxVal / 4) * (lvl + 1);
            leg += '<span class="legend-dot" style="background:' + heatColor(val) + ';width:12px;height:12px;border-radius:2px"></span>';
        }
        leg += '<span style="font-size:10px;color:' + colors.text + '"> 多</span>';
        legendEl.innerHTML = leg;
    }
}

// ===== 提交列表 =====
function renderCommits(commits: Array<{ hash: string; message: string; project: string }>) {
    const charts = document.getElementById('charts')!;
    let html = '<div class="chart-box"><div class="chart-title">最近提交</div>';
    if (!commits.length) {
        html += '<div class="note-empty">暂无提交记录</div></div>';
        charts.insertAdjacentHTML('beforeend', html);
        return;
    }
    html += '<div class="commit-list">';
    const recent = commits.slice(-10).reverse();
    recent.forEach(c => {
        html += '<div class="commit-item">' +
            '<span class="commit-hash">' + c.hash.slice(0, 7) + '</span>' +
            '<span class="commit-msg" title="' + c.message + '">' + c.message + '</span>' +
            '<span class="commit-proj">' + c.project + '</span>' +
            '</div>';
    });
    html += '</div></div>';
    charts.insertAdjacentHTML('beforeend', html);
}

// ===== 会话历史 =====
function renderSessions(records: Array<{
    startTime: number; endTime: number; duration: number;
    fileName: string; project: string; keystrokes: number;
    linesAdded: number; linesDeleted: number;
}>) {
    const charts = document.getElementById('charts')!;
    if (!records || !records.length) {
        charts.innerHTML = '<div class="note-empty">暂无会话记录<br><small>右键文件选择「开始计时」来创建</small></div>';
        return;
    }

    const groups: Record<string, typeof records> = {};
    records.forEach(r => {
        const date = new Date(r.startTime).toISOString().slice(0, 10);
        if (!groups[date]) groups[date] = [];
        groups[date].push(r);
    });
    const dates = Object.keys(groups).sort().reverse();

    let totalSec = 0;
    const totalCount = records.length;
    records.forEach(r => totalSec += r.duration || 0);

    let html = '';
    dates.forEach(date => {
        html += '<div class="session-date">' + date + '</div>';
        groups[date].forEach(r => {
            const d = r.duration || 0;
            html += '<div class="session-card">' +
                '<div class="session-head">' +
                '<span class="session-time">' + fmtDuration(d) + '</span>' +
                '<span class="session-file">' + r.fileName + '</span>' +
                '</div>' +
                '<div class="session-detail">' +
                '<span>按键 ' + fmtNum(r.keystrokes) + '</span>' +
                '<span>+' + (r.linesAdded || 0) + ' / -' + (r.linesDeleted || 0) + '</span>' +
                '<span>' + r.project + '</span>' +
                '<span>' + fmtTimeRange(r.startTime, r.endTime) + '</span>' +
                '</div>' +
                '</div>';
        });
    });

    html += '<div class="session-summary">共 ' + dates.length + ' 天 · ' + totalCount + ' 次会话 · ' + fmtDuration(totalSec) + '</div>';
    charts.innerHTML = html;
}

// ===== 图表渲染 =====
function renderCharts(d: Record<string, unknown>) {
    const el = document.getElementById('charts')!;
    if (d.view === 'sessions') {
        el.innerHTML = '';
        renderSessions(d.sessionRecords as Parameters<typeof renderSessions>[0] || []);
        return;
    }

    const colors = getChartColors();
    const pts = (d.dataPoints || []) as Array<{ date: string; codingTime: number }>;
    const summary = d.summary as Record<string, unknown> | null;
    const today = d.todayStats as Record<string, unknown>;

    let html = '';

    if (pts.length >= 1 || d.view !== 'today') {
        html += '<div class="chart-box">' +
            '<div class="chart-title">编码日历</div>' +
            '<canvas id="heatmap" width="720" height="140"></canvas>' +
            '<div class="legend" id="legendHeat"></div>' +
            '</div>';
    }

    if (pts.length > 0) {
        html += '<div class="chart-box">' +
            '<div class="chart-title">每日编码趋势</div>' +
            '<canvas id="barChart" width="700" height="240"></canvas>' +
            '</div>';
    } else {
        html += '<div class="chart-box"><div class="note-empty">暂无数据</div></div>';
    }

    const topProjects = (summary?.topProjects || []) as Array<{ name: string; time: number }>;
    if (topProjects.length > 0) {
        html += '<div class="chart-row">' +
            '<div class="chart-box">' +
            '<div class="chart-title">项目分布</div>' +
            '<canvas id="donutProject" width="260" height="260"></canvas>' +
            '<div class="legend" id="legendProject"></div>' +
            '</div>';

        const topLanguages = (summary?.topLanguages || []) as Array<{ name: string; time: number }>;
        if (topLanguages.length > 0) {
            html += '<div class="chart-box">' +
                '<div class="chart-title">语言分布</div>' +
                '<canvas id="donutLang" width="260" height="260"></canvas>' +
                '<div class="legend" id="legendLang"></div>' +
                '</div>';
        }

        if (d.view === 'today') {
            html += '<div class="chart-box">' +
                '<div class="chart-title">活跃状态</div>' +
                '<canvas id="donutState" width="260" height="260"></canvas>' +
                '<div class="legend" id="legendState"></div>' +
                '</div>';
        }
        html += '</div>';
    }

    el.innerHTML = html;

    if (pts.length >= 1 || d.view !== 'today') drawHeatmap('heatmap', pts, colors);
    if (pts.length > 0) drawBarChart('barChart', pts, colors);
    if (topProjects.length > 0) {
        drawDonut('donutProject', topProjects.map(p => ({ label: p.name, value: p.time })), colors, '项目');
        const topLanguages = (summary?.topLanguages || []) as Array<{ name: string; time: number }>;
        if (topLanguages.length > 0) {
            const displayNames: Record<string, string> = {
                typescript: 'TypeScript', javascript: 'JavaScript',
                python: 'Python', go: 'Go', rust: 'Rust', java: 'Java', cpp: 'C++',
                c: 'C', csharp: 'C#', php: 'PHP', ruby: 'Ruby', swift: 'Swift',
                kotlin: 'Kotlin', scala: 'Scala', html: 'HTML', css: 'CSS',
                json: 'JSON', markdown: 'Markdown', yaml: 'YAML', xml: 'XML',
                shellscript: 'Shell', dockerfile: 'Docker', sql: 'SQL', vue: 'Vue',
                tsx: 'TSX', jsx: 'JSX', lua: 'Lua', r: 'R', perl: 'Perl',
            };
            drawDonut('donutLang', topLanguages.map(l => ({
                label: displayNames[l.name] || l.name, value: l.time,
            })), colors, '语言');
        }
        if (d.view === 'today') {
            const active = (today.totalCodingTime as number) || 0;
            const idle = Math.max(0, ((today.totalActiveTime as number) || 0) - active);
            drawDonut('donutState', [
                { label: '编码', value: active, color: colors.green },
                { label: '空闲', value: idle, color: colors.orange },
            ], colors, '活跃率');
        }
    }
}

// ===== 主渲染 =====
function render(d: Record<string, unknown>) {
    document.querySelectorAll('.tab').forEach(el => {
        el.classList.toggle('active', (el as HTMLElement).dataset.view === d.view);
    });

    const s = d.view === 'today' ? d.todayStats : (d.summary || {});
    const total = (s as Record<string, unknown>).totalCodingTime || 0;
    const labels: Record<string, string> = { active: '活跃', idle: '空闲', away: '离开' };
    document.getElementById('statusBar')!.innerHTML =
        '<div class="status-dot ' + d.state + '"></div>' +
        '<span class="status-text">' + labels[d.state as string] + '</span>' +
        '<span class="status-time">' + fmtDuration(total as number) + '</span>';

    const noteEl = document.getElementById('adaptiveNote')!;
    if (d.adaptiveNote) {
        noteEl.style.display = ''; noteEl.textContent = d.adaptiveNote as string;
    } else { noteEl.style.display = 'none'; }

    const cards = [
        { label: '按键次数', value: fmtNum((s as Record<string, unknown>).totalKeystrokes as number || 0) },
        { label: '新增行', value: '+' + fmtNum((s as Record<string, unknown>).totalLinesAdded as number || 0) },
        { label: '删除行', value: '-' + fmtNum((s as Record<string, unknown>).totalLinesDeleted as number || 0) },
        { label: '提交', value: d.view === 'today' ? (d.commits as unknown[]).length : ((s as Record<string, unknown>).totalCommits as number || 0) },
        { label: '天数', value: d.summary ? (d.summary as Record<string, unknown>).totalDays : 1 },
    ];
    document.getElementById('cards')!.innerHTML = cards.map(c =>
        '<div class="card">' +
        '<div class="card-label">' + c.label + '</div>' +
        '<div class="card-value">' + c.value + '</div>' +
        '</div>'
    ).join('');

    renderCharts(d);

    if (d.view !== 'sessions') {
        renderCommits((d.commits || []) as Parameters<typeof renderCommits>[0]);
    }
}

// ===== 初始化 =====
export function initWebview(): void {
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('.tab').forEach(el => {
        el.addEventListener('click', () => {
            const v = (el as HTMLElement).dataset.view;
            if (v && v !== currentView) { currentView = v; vscode.postMessage({ type: 'switchView', view: v }); }
        });
    });

    window.addEventListener('message', (e: MessageEvent) => {
        const m = e.data;
        if (m.type !== 'data') return;
        currentView = m.view;
        if (m.theme) isDark = m.theme.isDark;
        render(m);
    });
}
