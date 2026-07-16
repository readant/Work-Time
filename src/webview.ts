import * as vscode from 'vscode';
import {
    CommitRecord,
    DailyStats,
    DayDataPoint,
    GlobalStats,
    SessionRecord,
    TrackerState,
    ViewType,
} from './types';
import { STYLES } from './webview/styles';

interface WebviewData {
    view: ViewType;
    state: TrackerState;
    todayStats: DailyStats;
    summary: GlobalStats | null;
    dataPoints: DayDataPoint[];
    heatmapDataPoints: DayDataPoint[];
    commits: CommitRecord[];
    adaptiveNote: string;
    theme?: { kind: number; isDark: boolean };
    sessionRecords?: SessionRecord[];
    years?: number[];
    year?: number;
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

        try {
            this.panel.webview.html = this.buildHtml(this.panel.webview);
        } catch (e: any) {
            console.error('[work-time] buildHtml failed:', e.message, e.stack);
            this.panel.webview.html = '<html><body><h1>Error</h1><pre>' + e.message + '</pre></body></html>';
        }

        this.panel.webview.onDidReceiveMessage(
            (msg: { type: string; view?: ViewType; year?: number }) => {
                if (msg.type === 'switchView' && msg.view) {
                    vscode.commands.executeCommand(
                        'work-time.webviewSwitchView',
                        msg.view
                    );
                } else if (msg.type === 'switchYear' && msg.year) {
                    vscode.commands.executeCommand(
                        'work-time.webviewSwitchYear',
                        msg.year
                    );
                }
            },
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(
            () => { this.panel = null; },
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

    private postData(view: ViewType, data: WebviewData): void {
        this.panel?.webview.postMessage({
            type: 'data',
            view,
            state: data.state,
            todayStats: data.todayStats,
            summary: data.summary,
            dataPoints: data.dataPoints,
            heatmapDataPoints: data.heatmapDataPoints,
            commits: data.commits,
            adaptiveNote: data.adaptiveNote,
            theme: data.theme,
            sessionRecords: data.sessionRecords,
            years: data.years,
            year: data.year,
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
<style>${STYLES}</style>
</head>
<body>
<div class="tabs">
  <button class="tab" data-view="today">今日</button>
  <button class="tab" data-view="week">本周</button>
  <button class="tab" data-view="month">本月</button>
  <button class="tab" data-view="all">全部</button>
  <button class="tab" data-view="sessions">会话</button>
</div>
<div id="yearSelector" class="year-selector" style="display:none">
  <span class="year-label">年度:</span>
  <div id="yearButtons" class="year-buttons"></div>
</div>
<div id="statusBar" class="status-bar"></div>
<div class="cards" id="cards"></div>
<div id="adaptiveNote" class="note" style="display:none"></div>
<div id="charts"></div>
<script nonce="${nonce}">
${WEBVIEW_SCRIPT}
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

// ============ Webview 前端脚本（内联） ============

const WEBVIEW_SCRIPT = `
const vscode = acquireVsCodeApi();
let currentView = 'today';
let isDark = true;
let currentYear = new Date().getFullYear();

const PALETTE = ['#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8','#4dd0e1','#aed581','#ff8a65','#9575cd','#f06292'];

function getChartColors() {
  return isDark ? {blue:'#4fc3f7',green:'#81c784',orange:'#ffb74d',red:'#e57373',purple:'#ba68c8',gray:'#78909c',bg:'#1e1e1e',grid:'#3a3a3a',text:'#bbb',bar:'#4fc3f7'}
    : {blue:'#0288d1',green:'#388e3c',orange:'#f57c00',red:'#d32f2f',purple:'#7b1fa2',gray:'#546e7a',bg:'#fafafa',grid:'#e0e0e0',text:'#666',bar:'#1976d2'};
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return '0s';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
function fmtNum(n) { return (n || 0).toLocaleString(); }
function fmtTimeRange(start, end) {
  const s = new Date(start), e = new Date(end);
  const pad = n => String(n).padStart(2, '0');
  return pad(s.getHours())+':'+pad(s.getMinutes())+' - '+pad(e.getHours())+':'+pad(e.getMinutes());
}

// 标签切换
document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    const v = el.dataset.view;
    if (v && v !== currentView) { currentView = v; vscode.postMessage({type:'switchView',view:v}); }
  });
});

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type !== 'data') return;
  currentView = m.view;
  if (m.theme) isDark = m.theme.isDark;
  if (m.year) currentYear = m.year;
  if (m.years) initYearSelector(m.years);
  render(m);
});

function initYearSelector(years) {
  const btns = document.getElementById('yearButtons');
  const container = document.getElementById('yearSelector');
  if (!btns || !container) return;
  if (!years || years.length === 0) { container.style.display = 'none'; return; }
  btns.innerHTML = years.map(y => '<button class="year-btn'+(y===currentYear?' active':'')+'" data-year="'+y+'">'+y+'</button>').join('');
  container.style.display = currentView === 'all' ? 'flex' : 'none';
  btns.querySelectorAll('.year-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const y = parseInt(btn.dataset.year);
      if (y !== currentYear) {
        currentYear = y;
        btns.querySelectorAll('.year-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.year) === y));
        vscode.postMessage({type:'switchYear', year: y});
      }
    });
  });
}

function render(d) {
  document.querySelectorAll('.tab').forEach(el => { el.classList.toggle('active', el.dataset.view === d.view); });
  const yearSel = document.getElementById('yearSelector');
  if (yearSel) yearSel.style.display = d.view === 'all' ? 'flex' : 'none';
  const s = d.view === 'today' ? d.todayStats : (d.summary || {});
  const total = s.totalCodingTime || 0;
  const labels = {active:'活跃',idle:'空闲',away:'离开'};
  document.getElementById('statusBar').innerHTML =
    '<div class="status-dot '+d.state+'"></div><span class="status-text">'+labels[d.state]+'</span><span class="status-time">'+fmtDuration(total)+'</span>';
  const noteEl = document.getElementById('adaptiveNote');
  if (d.adaptiveNote) { noteEl.style.display = ''; noteEl.textContent = d.adaptiveNote; } else { noteEl.style.display = 'none'; }
  const cards = [
    {label:'按键次数',value:fmtNum(s.totalKeystrokes||0)},
    {label:'新增行',value:'+'+fmtNum(s.totalLinesAdded||0)},
    {label:'删除行',value:'-'+fmtNum(s.totalLinesDeleted||0)},
    {label:'提交',value: d.view==='today' ? d.commits.length : (s.totalCommits||0)},
    {label:'天数',value: d.summary ? d.summary.totalDays : 1},
  ];
  document.getElementById('cards').innerHTML = cards.map(c => '<div class="card"><div class="card-label">'+c.label+'</div><div class="card-value">'+c.value+'</div></div>').join('');
  renderCharts(d);
  if (d.view !== 'sessions') renderCommits(d.commits || []);
}

function renderCharts(d) {
  const el = document.getElementById('charts');
  if (d.view === 'sessions') { el.innerHTML = ''; renderSessions(d.sessionRecords || []); return; }
  const colors = getChartColors();
  const pts = d.dataPoints || [], heatPts = d.heatmapDataPoints || [];
  const summary = d.summary, today = d.todayStats;

  const barTitles = {today:'每小时编码趋势',week:'每日编码趋势',month:'每周编码趋势',all:'每日编码趋势'};
  const barTitle = barTitles[d.view] || '编码趋势';

  let html = '';
  if (heatPts.length >= 1) html += '<div class="chart-box"><div class="chart-title">编码日历</div><div class="canvas-wrap"><canvas id="heatmap"></canvas></div><div class="legend" id="legendHeat"></div></div>';
  if (pts.length > 0) html += '<div class="chart-box"><div class="chart-title">'+barTitle+'</div><div class="canvas-wrap"><canvas id="barChart"></canvas></div></div>';
  else html += '<div class="chart-box"><div class="note-empty">暂无数据</div></div>';
  if (summary && summary.topProjects && summary.topProjects.length > 0) {
    html += '<div class="chart-row"><div class="chart-box"><div class="chart-title">项目分布</div><div class="canvas-wrap-sq"><canvas id="donutProject"></canvas></div><div class="legend" id="legendProject"></div></div>';
    if (summary.topLanguages && summary.topLanguages.length > 0) html += '<div class="chart-box"><div class="chart-title">语言分布</div><div class="canvas-wrap-sq"><canvas id="donutLang"></canvas></div><div class="legend" id="legendLang"></div></div>';
    if (d.view === 'today') html += '<div class="chart-box"><div class="chart-title">活跃状态</div><div class="canvas-wrap-sq"><canvas id="donutState"></canvas></div><div class="legend" id="legendState"></div></div>';
    html += '</div>';
  }
  el.innerHTML = html;
  if (heatPts.length >= 1) drawHeatmap('heatmap', heatPts, colors);
  if (pts.length > 0) drawBarChart('barChart', pts, colors, d.view);
  if (summary && summary.topProjects && summary.topProjects.length > 0) {
    drawDonut('donutProject', summary.topProjects.map(p => ({label:p.name,value:p.time})), colors, '项目');
    if (summary.topLanguages && summary.topLanguages.length > 0) {
      const dn = {typescript:'TypeScript',javascript:'JavaScript',python:'Python',go:'Go',rust:'Rust',java:'Java',cpp:'C++',c:'C',csharp:'C#',php:'PHP',ruby:'Ruby',swift:'Swift',kotlin:'Kotlin',scala:'Scala',html:'HTML',css:'CSS',json:'JSON',markdown:'Markdown',yaml:'YAML',xml:'XML',shellscript:'Shell',dockerfile:'Docker',sql:'SQL',vue:'Vue',tsx:'TSX',jsx:'JSX',lua:'Lua',r:'R',perl:'Perl'};
      drawDonut('donutLang', summary.topLanguages.map(l => ({label:dn[l.name]||l.name,value:l.time})), colors, '语言');
    }
    if (d.view === 'today') {
      const active = today.totalCodingTime || 0, idle = Math.max(0, (today.totalActiveTime||0) - active);
      drawDonut('donutState', [{label:'编码',value:active,color:colors.green},{label:'空闲',value:idle,color:colors.orange}], colors, '活跃率');
    }
  }
}

function drawDonut(id, items, colors, centerLabel) {
  const c = document.getElementById(id); if (!c) return;
  const rect = c.parentElement.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) || 260;
  const dpr = window.devicePixelRatio || 1;
  c.width = size * dpr; c.height = size * dpr;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const W = c.width, H = c.height;
  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 16*dpr, ir = r * 0.6;
  const total = items.reduce((s,i) => s + (i.value||0), 0);
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0,0,W,H);
  const sW = size, sH = size, scx = sW/2, scy = sH/2, sr = Math.min(sW,sH)/2 - 16, sir = sr * 0.6;
  if (total === 0) { ctx.fillStyle = colors.text; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暂无数据', scx, scy); return; }
  let angle = -Math.PI / 2;
  items.forEach((item, i) => {
    const slice = (item.value / total) * Math.PI * 2; if (slice <= 0) return;
    ctx.beginPath(); ctx.arc(scx, scy, sr, angle, angle + slice); ctx.arc(scx, scy, sir, angle + slice, angle, true); ctx.closePath();
    ctx.fillStyle = item.color || PALETTE[i % PALETTE.length]; ctx.fill(); ctx.strokeStyle = colors.bg; ctx.lineWidth = 2; ctx.stroke(); angle += slice;
  });
  ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.font = '11px sans-serif'; ctx.fillText(centerLabel, scx, scy - 7);
  ctx.fillStyle = isDark ? '#eee' : '#333'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(fmtDuration(total), scx, scy + 12);
  const lm = {donutProject:'legendProject',donutLang:'legendLang',donutState:'legendState'};
  const le = document.getElementById(lm[id] || '');
  if (le) le.innerHTML = items.map((item, i) => { const pct = total > 0 ? Math.round((item.value / total) * 100) : 0; return '<div class="legend-item"><div class="legend-dot" style="background:'+(item.color||PALETTE[i%PALETTE.length])+'"></div><span class="legend-name">'+item.label+'</span><span class="legend-val">'+fmtDuration(item.value)+' ('+pct+'%)</span></div>'; }).join('');
}

function drawBarChart(id, pts, colors, view) {
  const c = document.getElementById(id); if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.parentElement.getBoundingClientRect();
  const W = rect.width || 700, H = 240;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0,0,W,H); if (!pts.length) return;
  const pad = {top:10,right:24,bottom:36,left:44}, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
  const maxVal = Math.max(...pts.map(p => p.codingTime), 1), barW = Math.min(32, Math.max(6, (cw / pts.length) * 0.6)), gap = (cw - barW * pts.length) / (pts.length + 1);
  ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.5; ctx.fillStyle = colors.text; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const val = (maxVal / 4) * i, y = pad.top + ch - (val / maxVal) * ch; ctx.beginPath(); ctx.setLineDash([3,3]); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(fmtDuration(val), pad.left - 6, y + 4); }
  const ma = []; for (let i = 0; i < pts.length; i++) { const w = pts.slice(Math.max(0,i-3), Math.min(pts.length,i+4)); ma.push(w.reduce((s,p) => s + p.codingTime, 0) / w.length); }
  ctx.beginPath(); ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 2; ctx.setLineDash([]); let first = true;
  pts.forEach((p, i) => { const x = pad.left + gap + barW/2 + i * (barW + gap), y = pad.top + ch - (ma[i] / maxVal) * ch; if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }); ctx.stroke();
  const avg = pts.reduce((s,p) => s + p.codingTime, 0) / pts.length, avgY = pad.top + ch - (avg / maxVal) * ch;
  ctx.beginPath(); ctx.strokeStyle = colors.text; ctx.lineWidth = 1; ctx.setLineDash([4,4]); ctx.moveTo(pad.left, avgY); ctx.lineTo(W - pad.right, avgY); ctx.stroke(); ctx.setLineDash([]);

  const todayStr = new Date().toISOString().slice(5,10);
  pts.forEach((p, i) => {
    const x = pad.left + gap + i * (barW + gap), h = (p.codingTime / maxVal) * ch, y = pad.top + ch - h, r = Math.min(4, barW/2);
    const grad = ctx.createLinearGradient(x, y, x, pad.top + ch); grad.addColorStop(0, colors.blue); grad.addColorStop(0.5, colors.bar); grad.addColorStop(1, isDark ? 'rgba(79,195,247,.15)' : 'rgba(25,118,210,.1)'); ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(x, pad.top + ch); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.lineTo(x + barW - r, y); ctx.quadraticCurveTo(x + barW, y, x + barW, y + r); ctx.lineTo(x + barW, pad.top + ch); ctx.closePath(); ctx.fill();
    let label = p.date;
    const isToday = label === todayStr || label === todayStr.slice(5);
    ctx.fillStyle = isToday ? '#4fc3f7' : colors.text; ctx.font = (isToday ? 'bold ' : '') + '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + barW/2, H - 8);
  });
}

function roundRectPath(ctx, x, y, w, h, r) { ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath(); }

function drawHeatmap(id, pts, colors) {
  const c = document.getElementById(id); if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.parentElement.getBoundingClientRect();
  const W = rect.width || 720, H = 140;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  const dataMap = {}; pts.forEach(p => { dataMap[p.date] = p.codingTime; });
  const now = new Date(), currentYear = now.getFullYear(), currentMonth = now.getMonth(), currentDay = now.getDate();
  const todayStr = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(currentDay).padStart(2, '0');
  const monthList = []; for (let m = 0; m <= currentMonth; m++) monthList.push({ year: currentYear, month: m });
  function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function getFirstDayOfWeek(year, month) { return new Date(year, month, 1).getDay(); }
  let maxVal = 1; for (const dateStr in dataMap) if (dataMap[dateStr] > maxVal) maxVal = dataMap[dateStr];
  function heatColor(val) { if (val <= 0) return isDark ? '#161b22' : '#ebedf0'; const lvl = Math.min(4, Math.ceil((val / maxVal) * 4) - 1); return isDark ? ['#0e4429','#006d32','#26a641','#39d353'][Math.max(0,lvl)] : ['#9be9a8','#40c463','#30a14e','#216e39'][Math.max(0,lvl)]; }
  const cellSize = 14, cellGap = 2, monthGap = 12, pad = { top: 22, left: 30, right: 16, bottom: 8 };
  const monthWidth = cellSize * 7 + cellGap * 6, startX = pad.left;
  const dayLabels = ['日','一','二','三','四','五','六'];
  ctx.fillStyle = colors.text; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
  dayLabels.forEach((label, i) => { ctx.fillText(label, pad.left - 4, pad.top + 4 + i * (cellSize + cellGap) + cellSize / 2 + 1); });
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  monthList.forEach((item, idx) => {
    const monthX = startX + idx * (monthWidth + monthGap), daysInMonth = getDaysInMonth(item.year, item.month), firstDay = getFirstDayOfWeek(item.year, item.month);
    const isCurrentMonth = (item.year === currentYear && item.month === currentMonth);
    ctx.fillStyle = isCurrentMonth ? (isDark ? '#4fc3f7' : '#1976d2') : colors.text; ctx.font = isCurrentMonth ? 'bold 9px sans-serif' : '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(monthNames[item.month], monthX + monthWidth / 2, pad.top - 6);
    if (isCurrentMonth) { ctx.strokeStyle = isDark ? '#58a6ff' : '#1a7f37'; ctx.lineWidth = 1.5; ctx.strokeRect(monthX - 3, pad.top - 1, monthWidth + 6, 5 * (cellSize + cellGap) + cellGap + 6); }
    for (let day = 1; day <= daysInMonth; day++) {
      const dayOfWeek = (firstDay + day - 1) % 7, week = Math.floor((firstDay + day - 1) / 7);
      const cellX = monthX + dayOfWeek * (cellSize + cellGap), cellY = pad.top + 4 + week * (cellSize + cellGap);
      const dateStr = item.year + '-' + String(item.month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      if (dateStr > todayStr) continue;
      ctx.fillStyle = heatColor(dataMap[dateStr] || 0); ctx.beginPath(); roundRectPath(ctx, cellX, cellY, cellSize, cellSize, 2); ctx.fill();
      if (dateStr === todayStr) { ctx.strokeStyle = isDark ? '#58a6ff' : '#1a7f37'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  });
  const legendEl = document.getElementById('legendHeat');
  if (legendEl) { let leg = '<span style="font-size:10px;color:'+colors.text+'">少 </span>'; for (let lvl = 0; lvl < 4; lvl++) { const val = lvl === 0 ? 0 : (maxVal / 4) * (lvl + 1); leg += '<span class="legend-dot" style="background:'+heatColor(val)+';width:12px;height:12px;border-radius:2px"></span>'; } leg += '<span style="font-size:10px;color:'+colors.text+'"> 多</span>'; legendEl.innerHTML = leg; }
}

function renderCommits(commits) {
  const charts = document.getElementById('charts');
  let html = '<div class="chart-box"><div class="chart-title">最近提交</div>';
  if (!commits.length) { html += '<div class="note-empty">暂无提交记录</div></div>'; charts.insertAdjacentHTML('beforeend', html); return; }
  html += '<div class="commit-list">';
  commits.slice(-10).reverse().forEach(c => { html += '<div class="commit-item"><span class="commit-hash">'+c.hash.slice(0,7)+'</span><span class="commit-msg" title="'+c.message+'">'+c.message+'</span><span class="commit-proj">'+c.project+'</span></div>'; });
  html += '</div></div>'; charts.insertAdjacentHTML('beforeend', html);
}

function renderSessions(records) {
  const charts = document.getElementById('charts');
  if (!records || !records.length) { charts.innerHTML = '<div class="note-empty">暂无会话记录<br><small>右键文件选择「开始计时」来创建</small></div>'; return; }
  const groups = {}; records.forEach(r => { const date = new Date(r.startTime).toISOString().slice(0,10); if (!groups[date]) groups[date] = []; groups[date].push(r); });
  const dates = Object.keys(groups).sort().reverse();
  let totalSec = 0; records.forEach(r => totalSec += r.duration || 0);
  let html = '';
  dates.forEach(date => { html += '<div class="session-date">'+date+'</div>'; groups[date].forEach(r => { const d = r.duration || 0; html += '<div class="session-card"><div class="session-head"><span class="session-time">'+fmtDuration(d)+'</span><span class="session-file">'+r.fileName+'</span></div><div class="session-detail"><span>按键 '+fmtNum(r.keystrokes)+'</span><span>+'+(r.linesAdded||0)+' / -'+(r.linesDeleted||0)+'</span><span>'+r.project+'</span><span>'+fmtTimeRange(r.startTime, r.endTime)+'</span></div></div>'; }); });
  html += '<div class="session-summary">共 '+dates.length+' 天 · '+records.length+' 次会话 · '+fmtDuration(totalSec)+'</div>';
  charts.innerHTML = html;
}
`;
