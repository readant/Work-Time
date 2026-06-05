import * as vscode from 'vscode';
import {
    CommitRecord,
    DailyStats,
    DayDataPoint,
    GlobalStats,
    TrackerState,
    ViewType,
} from './types';

interface WebviewData {
    view: ViewType;
    state: TrackerState;
    todayStats: DailyStats;
    summary: GlobalStats | null;
    dataPoints: DayDataPoint[];
    commits: CommitRecord[];
    adaptiveNote: string;
    theme?: { kind: number; isDark: boolean };
    sessionRecords?: SessionRecord[];
}

interface SessionRecord {
    id: string;
    filePath: string;
    fileName: string;
    project: string;
    duration: number;
    keystrokes: number;
    linesAdded: number;
    linesDeleted: number;
    startTime: number;
    endTime: number;
    pauses: { start: number; end: number }[];
}

/**
 * Webview Panel 管理。
 */
export class StatsWebview {
    private panel: vscode.WebviewPanel | null = null;
    private disposables: vscode.Disposable[] = [];

    show(
        extensionUri: vscode.Uri,
        view: ViewType,
        data: WebviewData
    ): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.postData(view, data);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'workTime',
            'Work Time',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        this.panel.webview.html = this.buildHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(
            (msg: { type: string; view?: ViewType }) => {
                if (msg.type === 'switchView' && msg.view) {
                    vscode.commands.executeCommand(
                        'work-time.webviewSwitchView',
                        msg.view
                    );
                }
            },
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(
            () => {
                this.panel = null;
            },
            null,
            this.disposables
        );

        this.postData(view, data);
    }

    update(view: ViewType, data: WebviewData): void {
        this.postData(view, data);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
        for (const d of this.disposables) d.dispose();
    }

    // ============ 内部 ============

    private postData(view: ViewType, data: WebviewData): void {
        this.panel?.webview.postMessage({
            type: 'data',
            view,
            state: data.state,
            todayStats: data.todayStats,
            summary: data.summary,
            dataPoints: data.dataPoints,
            commits: data.commits,
            adaptiveNote: data.adaptiveNote,
            theme: data.theme,
            sessionRecords: data.sessionRecords,
        });
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Work Time</title>
<style>
/* ===== 基础 ===== */
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:var(--vscode-font-family,-apple-system,sans-serif);
  font-size:13px;color:var(--vscode-foreground,#ccc);
  background:var(--vscode-editor-background,#1e1e1e);
  padding:20px 24px;
}

/* ===== 标签页 Pill ===== */
.tabs{
  display:flex;gap:6px;margin-bottom:24px;
}
.tab{
  padding:6px 16px;border-radius:20px;font-size:12px;
  border:1px solid var(--vscode-panel-border,#444);
  background:transparent;color:var(--vscode-foreground,#ccc);
  cursor:pointer;transition:all .2s;
}
.tab.active{
  background:var(--vscode-button-background,#0e639c);
  color:var(--vscode-button-foreground,#fff);
  border-color:var(--vscode-button-background,#0e639c);
}
.tab:hover:not(.active){
  background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.06));
}

/* ===== 状态条 ===== */
.status-bar{
  display:flex;align-items:center;gap:8px;margin-bottom:20px;
  padding:8px 14px;border-radius:8px;
  background:var(--vscode-sideBar-background,#252526);
  border:1px solid var(--vscode-panel-border,#444);
}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.status-dot.active{background:#4caf50}
.status-dot.idle{background:#ff9800}
.status-dot.away{background:#9e9e9e}
.status-text{font-size:13px;font-weight:500}
.status-time{margin-left:auto;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}

/* ===== 卡片 ===== */
.cards{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:10px;margin-bottom:24px;
}
.card{
  background:var(--vscode-sideBar-background,#252526);
  border:1px solid var(--vscode-panel-border,#444);
  border-radius:10px;padding:14px 16px;
  transition:transform .15s,box-shadow .15s;
}
.card:hover{
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(0,0,0,.2);
}
.card-label{font-size:11px;color:var(--vscode-descriptionForeground,#999);margin-bottom:4px}
.card-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}

/* ===== 图表容器 ===== */
.chart-box{
  background:var(--vscode-sideBar-background,#252526);
  border:1px solid var(--vscode-panel-border,#444);
  border-radius:12px;padding:18px 20px;margin-bottom:18px;
}
.chart-title{
  font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.5px;margin-bottom:14px;
  color:var(--vscode-descriptionForeground,#999);
}
.chart-row{display:flex;gap:18px;flex-wrap:wrap}
.chart-row .chart-box{flex:1;min-width:280px}
canvas{display:block;max-width:100%}

/* ===== 图例 ===== */
.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:11px}
.legend-item{display:flex;align-items:center;gap:5px}
.legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.legend-name{color:var(--vscode-foreground,#ccc)}
.legend-val{color:var(--vscode-descriptionForeground,#999)}

/* ===== 热力图 ===== */
.heatmap{display:flex;gap:2px;margin-bottom:8px}
.heatmap-col{display:flex;flex-direction:column;gap:2px}
.heatmap-cell{width:14px;height:14px;border-radius:2px}
.heatmap-labels{display:flex;justify-content:space-between;font-size:10px;
  color:var(--vscode-descriptionForeground,#999);margin-top:4px}
.heatmap-legend{display:flex;align-items:center;gap:4px;
  justify-content:flex-end;font-size:10px;
  color:var(--vscode-descriptionForeground,#999);margin-top:4px}
.heatmap-legend .cell{width:12px;height:12px;border-radius:2px;display:inline-block}

/* ===== 提交列表 ===== */
.commit-list{margin-bottom:20px}
.commit-item{
  padding:6px 0;border-bottom:1px solid var(--vscode-panel-border,#444);
  font-size:11px;display:flex;gap:8px;
}
.commit-hash{color:var(--vscode-descriptionForeground,#999);font-family:monospace}
.commit-msg{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commit-proj{color:var(--vscode-descriptionForeground,#999)}

/* ===== 会话记录 ===== */
.session-date{
  font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground,#999);
  margin:14px 0 8px;
}
.session-card{
  background:var(--vscode-sideBar-background,#252526);
  border:1px solid var(--vscode-panel-border,#444);
  border-radius:10px;padding:14px 16px;margin-bottom:8px;
  transition:transform .15s;
}
.session-card:hover{transform:translateY(-1px)}
.session-head{
  display:flex;align-items:center;gap:8px;margin-bottom:6px;
}
.session-time{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;color:#4fc3f7}
.session-file{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-detail{display:flex;gap:16px;font-size:11px;color:var(--vscode-descriptionForeground,#999)}
.session-summary{
  text-align:center;font-size:12px;color:var(--vscode-descriptionForeground,#999);
  padding:12px;border-top:1px solid var(--vscode-panel-border,#444);
  margin-top:8px;
}

/* ===== 其他 ===== */
.note{
  font-size:11px;color:var(--vscode-descriptionForeground,#999);
  padding:8px 12px;background:var(--vscode-sideBar-background,#252526);
  border-radius:8px;margin-bottom:14px;
}
.note-empty{
  text-align:center;padding:40px 20px;color:var(--vscode-descriptionForeground,#999);
  font-size:13px;
}
</style>
</head>
<body>

<div class="tabs">
  <button class="tab" data-view="today">今日</button>
  <button class="tab" data-view="week">本周</button>
  <button class="tab" data-view="month">本月</button>
  <button class="tab" data-view="all">全部</button>
  <button class="tab" data-view="sessions">会话</button>
</div>

<div id="statusBar" class="status-bar"></div>
<div class="cards" id="cards"></div>
<div id="adaptiveNote" class="note" style="display:none"></div>

<div id="charts"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let currentView = 'today';
let isDark = true;

// ===== 配色 =====
const PALETTE = [
  '#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8',
  '#4dd0e1','#aed581','#ff8a65','#9575cd','#f06292',
];

function getChartColors() {
  return isDark ? {
    blue:'#4fc3f7',green:'#81c784',orange:'#ffb74d',
    red:'#e57373',purple:'#ba68c8',gray:'#78909c',
    bg:'#1e1e1e',grid:'#3a3a3a',text:'#bbb',bar:'#4fc3f7',
  } : {
    blue:'#0288d1',green:'#388e3c',orange:'#f57c00',
    red:'#d32f2f',purple:'#7b1fa2',gray:'#546e7a',
    bg:'#fafafa',grid:'#e0e0e0',text:'#666',bar:'#1976d2',
  };
}

// ===== 标签切换 =====
document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    const v = el.dataset.view;
    if (v && v !== currentView) { currentView = v; vscode.postMessage({type:'switchView',view:v}); }
  });
});

// ===== 接收数据 =====
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type !== 'data') return;
  currentView = m.view;
  if (m.theme) isDark = m.theme.isDark;
  render(m);
});

// ===== 工具函数 =====
function fmtDuration(sec) {
  if (!sec || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function fmtNum(n) { return (n || 0).toLocaleString(); }
function fmtTimeRange(start, end) {
  const s = new Date(start), e = new Date(end);
  const pad = n => String(n).padStart(2, '0');
  return pad(s.getHours())+':'+pad(s.getMinutes())+' - '+pad(e.getHours())+':'+pad(e.getMinutes());
}

// ===== 主渲染 =====
function render(d) {
  // 标签激活
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.view === d.view);
  });

  // 状态栏
  const s = d.view === 'today' ? d.todayStats : (d.summary || {});
  const total = s.totalCodingTime || 0;
  const labels = {active:'活跃',idle:'空闲',away:'离开'};
  document.getElementById('statusBar').innerHTML =
    '<div class="status-dot '+d.state+'"></div>' +
    '<span class="status-text">'+labels[d.state]+'</span>' +
    '<span class="status-time">'+fmtDuration(total)+'</span>';

  // 自适应提示
  const noteEl = document.getElementById('adaptiveNote');
  if (d.adaptiveNote) {
    noteEl.style.display = ''; noteEl.textContent = d.adaptiveNote;
  } else { noteEl.style.display = 'none'; }

  // 卡片
  const cards = [
    {label:'按键次数',value:fmtNum(s.totalKeystrokes||0)},
    {label:'新增行',value:'+'+fmtNum(s.totalLinesAdded||0)},
    {label:'删除行',value:'-'+fmtNum(s.totalLinesDeleted||0)},
    {label:'提交',value: d.view==='today' ? d.commits.length : (s.totalCommits||0)},
    {label:'天数',value: d.summary ? d.summary.totalDays : 1},
  ];
  document.getElementById('cards').innerHTML = cards.map(c =>
    '<div class="card">' +
      '<div class="card-label">'+c.label+'</div>' +
      '<div class="card-value">'+c.value+'</div>' +
    '</div>'
  ).join('');

  // 图表区
  renderCharts(d);

  // 提交列表
  if (d.view !== 'sessions') {
    renderCommits(d.commits || []);
  }
}

// ===== 图表渲染 =====
function renderCharts(d) {
  const el = document.getElementById('charts');
  if (d.view === 'sessions') {
    el.innerHTML = '';
    renderSessions(d.sessionRecords || []);
    return;
  }

  const colors = getChartColors();
  const pts = d.dataPoints || [];
  const summary = d.summary;
  const today = d.todayStats;

  let html = '';

  // 热力图 — 全年概览，始终显示
  if (pts.length >= 1 || d.view !== 'today') {
    html += '<div class="chart-box">' +
      '<div class="chart-title">编码日历</div>' +
      '<canvas id="heatmap" width="720" height="140"></canvas>' +
      '<div class="legend" id="legendHeat"></div>' +
      '</div>';
  }

  // 柱状图 + 趋势线
  if (pts.length > 0) {
    html += '<div class="chart-box">' +
      '<div class="chart-title">每日编码趋势</div>' +
      '<canvas id="barChart" width="700" height="240"></canvas>' +
      '</div>';
  } else {
    html += '<div class="chart-box"><div class="note-empty">暂无数据</div></div>';
  }

  // 项目分布环形图 + 语言分布
  if (summary && summary.topProjects && summary.topProjects.length > 0) {
    html += '<div class="chart-row">' +
      '<div class="chart-box">' +
        '<div class="chart-title">项目分布</div>' +
        '<canvas id="donutProject" width="260" height="260"></canvas>' +
        '<div class="legend" id="legendProject"></div>' +
      '</div>';

    // 语言分布环形图
    if (summary.topLanguages && summary.topLanguages.length > 0) {
      html += '<div class="chart-box">' +
        '<div class="chart-title">语言分布</div>' +
        '<canvas id="donutLang" width="260" height="260"></canvas>' +
        '<div class="legend" id="legendLang"></div>' +
        '</div>';
    }

    // 活跃状态环形图（仅今日视图有意义）
    if (d.view === 'today') {
      const active = today.totalCodingTime || 0;
      const idle = Math.max(0, (today.totalActiveTime||0) - active);
      html += '<div class="chart-box">' +
        '<div class="chart-title">活跃状态</div>' +
        '<canvas id="donutState" width="260" height="260"></canvas>' +
        '<div class="legend" id="legendState"></div>' +
        '</div>';
    }
    html += '</div>';
  }

  el.innerHTML = html;

  // 绘制各图表（热力图 → 柱状图 → 环形图）
  if (pts.length >= 1 || d.view !== 'today') drawHeatmap('heatmap', pts, colors);
  if (pts.length > 0) drawBarChart('barChart', pts, colors);
  if (summary && summary.topProjects && summary.topProjects.length > 0) {
    drawDonut('donutProject', summary.topProjects.map(p => ({label:p.name,value:p.time})), colors, '项目');
    if (summary.topLanguages && summary.topLanguages.length > 0) {
      drawDonut('donutLang', summary.topLanguages.map(l => {
        const displayNames = { typescript:'TypeScript', javascript:'JavaScript',
          python:'Python', go:'Go', rust:'Rust', java:'Java', cpp:'C++',
          c:'C', csharp:'C#', php:'PHP', ruby:'Ruby', swift:'Swift',
          kotlin:'Kotlin', scala:'Scala', html:'HTML', css:'CSS',
          json:'JSON', markdown:'Markdown', yaml:'YAML', xml:'XML',
          shellscript:'Shell', dockerfile:'Docker', sql:'SQL', vue:'Vue',
          tsx:'TSX', jsx:'JSX', lua:'Lua', r:'R', perl:'Perl' };
        return { label: displayNames[l.name] || l.name, value: l.time };
      }), colors, '语言');
    }
    if (d.view === 'today') {
      const active = today.totalCodingTime || 0;
      const idle = Math.max(0, (today.totalActiveTime||0) - active);
      drawDonut('donutState', [
        {label:'编码',value:active,color:colors.green},
        {label:'空闲',value:idle,color:colors.orange},
      ], colors, '活跃率');
    }
  }
}

// ===== 环形图 =====
function drawDonut(id, items, colors, centerLabel) {
  const c = document.getElementById(id); if (!c) return;
  const W = c.width, H = c.height;
  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 16;
  const ir = r * 0.6;
  const total = items.reduce((s,i) => s + (i.value||0), 0);
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,W,H);

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
    // 间隙
    ctx.strokeStyle = colors.bg; ctx.lineWidth = 2;
    ctx.stroke();
    angle += slice;
  });

  // 中心文字
  ctx.fillStyle = colors.text; ctx.textAlign = 'center';
  ctx.font = '11px sans-serif';
  ctx.fillText(centerLabel, cx, cy - 7);
  ctx.fillStyle = isDark ? '#eee' : '#333';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(fmtDuration(total), cx, cy + 12);

  // 图例
  const legendMap = { donutProject: 'legendProject', donutLang: 'legendLang', donutState: 'legendState' };
  const legendEl = document.getElementById(legendMap[id] || '');
  if (legendEl) {
    legendEl.innerHTML = items.map((item, i) => {
      const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
      return '<div class="legend-item">' +
        '<div class="legend-dot" style="background:'+(item.color||PALETTE[i%PALETTE.length])+'"></div>' +
        '<span class="legend-name">'+item.label+'</span>' +
        '<span class="legend-val">'+fmtDuration(item.value)+' ('+pct+'%)</span>' +
        '</div>';
    }).join('');
  }
}

// ===== 柱状图 + 趋势线 =====
function drawBarChart(id, pts, colors) {
  const c = document.getElementById(id); if (!c) return;
  const W = c.width = Math.max(500, c.parentElement?.clientWidth || 700);
  const H = c.height = 240;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,W,H);

  if (!pts.length) return;

  const pad = {top:10,right:24,bottom:36,left:44};
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
    ctx.beginPath(); ctx.setLineDash([3,3]);
    ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText(fmtDuration(val), pad.left - 6, y + 4);
  }

  // 7 日移动平均
  const ma = [];
  for (let i = 0; i < pts.length; i++) {
    const w = pts.slice(Math.max(0,i-3), Math.min(pts.length,i+4));
    ma.push(w.reduce((s,p) => s + p.codingTime, 0) / w.length);
  }

  // 趋势线
  ctx.beginPath(); ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 2;
  ctx.setLineDash([]);
  let first = true;
  pts.forEach((p, i) => {
    const x = pad.left + gap + barW/2 + i * (barW + gap);
    const y = pad.top + ch - (ma[i] / maxVal) * ch;
    if (first) { ctx.moveTo(x, y); first = false; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 均值虚线
  const avg = pts.reduce((s,p) => s + p.codingTime, 0) / pts.length;
  const avgY = pad.top + ch - (avg / maxVal) * ch;
  ctx.beginPath(); ctx.strokeStyle = colors.text; ctx.lineWidth = 1;
  ctx.setLineDash([4,4]);
  ctx.moveTo(pad.left, avgY); ctx.lineTo(W - pad.right, avgY);
  ctx.stroke(); ctx.setLineDash([]);

  // 柱子（渐变 + 圆角顶部）
  pts.forEach((p, i) => {
    const x = pad.left + gap + i * (barW + gap);
    const h = (p.codingTime / maxVal) * ch;
    const y = pad.top + ch - h;
    const r = Math.min(4, barW/2);
    // 渐变
    const grad = ctx.createLinearGradient(x, y, x, pad.top + ch);
    grad.addColorStop(0, colors.blue);
    grad.addColorStop(0.5, colors.bar);
    grad.addColorStop(1, isDark ? 'rgba(79,195,247,.15)' : 'rgba(25,118,210,.1)');
    ctx.fillStyle = grad;
    // 圆角矩形
    ctx.beginPath();
    ctx.moveTo(x, pad.top + ch);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, pad.top + ch);
    ctx.closePath();
    ctx.fill();

    // 日期标签（当日高亮）
    const label = p.date.length >= 10 ? p.date.slice(5) : p.date;
    const today = new Date().toISOString().slice(5,10);
    ctx.fillStyle = label === today ? '#4fc3f7' : colors.text;
    ctx.font = (label === today ? 'bold ' : '') + '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW/2, H - 8);
  });
}

// ===== 热力图（完整一年 52 周，GitHub 风格） =====
function drawHeatmap(id, pts, colors) {
  const c = document.getElementById(id); if (!c) return;
  const W = c.width = Math.max(720, c.parentElement.clientWidth || 720);
  const H = c.height = 130;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // 构建日期 -> codingTime 映射
  const dataMap = {};
  pts.forEach(p => { dataMap[p.date] = p.codingTime; });

  // 用系统时间，结束日 = 今天
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // 计算网格：周日起始, 52 周, 最后一格是今天
  const todayDay = now.getDay(); // 0=Sun
  const cols = 52;
  const rows = 7; // 0=Sun .. 6=Sat

  // 起始日期 = 52*7 天前 + 调整使周日对齐
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - (cols * 7 - 1) - todayDay);

  // 收集所有值确定色阶
  const allVals = [];
  const endDate = new Date(now);
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    allVals.push(dataMap[key] || 0);
  }
  const maxVal = Math.max(...allVals, 1);

  // GitHub 风格绿阶
  function heatColor(val) {
    if (val <= 0) return isDark ? '#161b22' : '#ebedf0';
    const lvl = Math.min(4, Math.ceil((val / maxVal) * 4) - 1);
    if (isDark) {
      return ['#0e4429','#006d32','#26a641','#39d353'][Math.max(0,lvl)];
    } else {
      return ['#9be9a8','#40c463','#30a14e','#216e39'][Math.max(0,lvl)];
    }
  }

  const pad = { top: 20, left: 36, right: 16, bottom: 22 };
  const cellSize = Math.floor((W - pad.left - pad.right) / (cols + 0.5));
  const gap = Math.max(2, Math.floor(cellSize * 0.15));
  const step = cellSize + gap;

  // 星期标签（左侧）
  const dayLabels = ['','周一','','周三','','周五',''];
  ctx.fillStyle = colors.text;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  dayLabels.forEach((label, row) => {
    if (label) {
      const y = pad.top + row * step + cellSize / 2 + 3;
      ctx.fillText(label, pad.left - 5, y);
    }
  });

  // 月份标签（顶部）
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  let lastMonth = -1;
  for (let col = 0; col < cols; col++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + col * 7);
    const m = d.getMonth();
    if (m !== lastMonth && d.getDate() <= 7) {
      lastMonth = m;
      const x = pad.left + col * step;
      ctx.fillStyle = colors.text;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(months[m], x, pad.top - 7);
    }
  }

  // 绘制 52×7 格子
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + col * 7 + row);
      const key = d.toISOString().slice(0, 10);
      // 未来的日期不绘制
      if (key > todayStr) continue;

      const val = dataMap[key] || 0;
      const x = pad.left + col * step;
      const y = pad.top + row * step;

      ctx.fillStyle = heatColor(val);
      ctx.beginPath();
      roundRectPath(ctx, x, y, cellSize, cellSize, 2);
      ctx.fill();

      // 今天的格子加蓝色边框
      if (key === todayStr) {
        ctx.strokeStyle = isDark ? '#58a6ff' : '#1a7f37';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // 图例
  const legendEl = document.getElementById('legendHeat');
  if (legendEl) {
    let leg = '<span style="font-size:10px;color:'+colors.text+'">少 </span>';
    for (let lvl = 0; lvl < 4; lvl++) {
      const val = lvl === 0 ? 0 : (maxVal / 4) * (lvl + 1);
      leg += '<span class="legend-dot" style="background:'+heatColor(val)+';width:12px;height:12px;border-radius:2px"></span>';
    }
    leg += '<span style="font-size:10px;color:'+colors.text+'"> 多</span>';
    legendEl.innerHTML = leg;
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
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

// ===== 提交列表 =====
function renderCommits(commits) {
  const charts = document.getElementById('charts');
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
      '<span class="commit-hash">'+c.hash.slice(0,7)+'</span>' +
      '<span class="commit-msg" title="'+c.message+'">'+c.message+'</span>' +
      '<span class="commit-proj">'+c.project+'</span>' +
      '</div>';
  });
  html += '</div></div>';
  charts.insertAdjacentHTML('beforeend', html);
}

// ===== 会话历史 =====
function renderSessions(records) {
  const charts = document.getElementById('charts');
  if (!records || !records.length) {
    charts.innerHTML = '<div class="note-empty">暂无会话记录<br><small>右键文件选择「开始计时」来创建</small></div>';
    return;
  }

  // 按日期分组
  const groups = {};
  records.forEach(r => {
    const date = new Date(r.startTime).toISOString().slice(0,10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(r);
  });
  const dates = Object.keys(groups).sort().reverse();

  let totalSec = 0, totalCount = records.length;
  records.forEach(r => totalSec += r.duration || 0);

  let html = '';
  dates.forEach(date => {
    html += '<div class="session-date">'+date+'</div>';
    groups[date].forEach(r => {
      const d = r.duration || 0;
      html += '<div class="session-card">' +
        '<div class="session-head">' +
          '<span class="session-time">'+fmtDuration(d)+'</span>' +
          '<span class="session-file">'+r.fileName+'</span>' +
        '</div>' +
        '<div class="session-detail">' +
          '<span>按键 '+fmtNum(r.keystrokes)+'</span>' +
          '<span>+'+(r.linesAdded||0)+' / -'+(r.linesDeleted||0)+'</span>' +
          '<span>'+r.project+'</span>' +
          '<span>'+fmtTimeRange(r.startTime, r.endTime)+'</span>' +
        '</div>' +
        '</div>';
    });
  });

  html += '<div class="session-summary">共 '+dates.length+' 天 · '+totalCount+' 次会话 · '+fmtDuration(totalSec)+'</div>';
  charts.innerHTML = html;
}
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
