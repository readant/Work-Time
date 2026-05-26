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
}

/**
 * Webview Panel 管理。
 * 第一次调用 showStats 时创建面板，后续调用聚焦已有面板。
 */
export class StatsWebview {
    private panel: vscode.WebviewPanel | null = null;
    private disposables: vscode.Disposable[] = [];

    /** 打开或聚焦面板。 */
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
            'codingStats',
            '编码时间统计',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        this.panel.webview.html = this.buildHtml(
            extensionUri,
            this.panel.webview
        );

        // 监听 Webview 消息
        this.panel.webview.onDidReceiveMessage(
            (msg: { type: string; view?: ViewType }) => {
                if (msg.type === 'switchView' && msg.view) {
                    // 通知扩展重新加载该视图的数据
                    vscode.commands.executeCommand(
                        'vscode-coding-tracker.webviewSwitchView',
                        msg.view
                    );
                }
            },
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(() => {
            this.panel = null;
        }, null, this.disposables);

        this.postData(view, data);
    }

    /** 推送数据到面板。 */
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
        });
    }

    private buildHtml(
        extensionUri: vscode.Uri,
        webview: vscode.Webview
    ): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'stats.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>编码时间统计</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: var(--vscode-font-family, -apple-system, sans-serif);
  font-size: 13px;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 16px;
}
.tabs {
  display: flex; gap: 4px; margin-bottom: 16px;
}
.tab {
  padding: 6px 14px; border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  border-radius: 4px; cursor: pointer; font-size: 12px;
}
.tab.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.status-row {
  display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
}
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.status-dot.active { background: #4caf50; }
.status-dot.idle { background: #ff9800; }
.status-dot.away { background: #9e9e9e; }
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px; margin-bottom: 20px;
}
.card {
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px; padding: 12px;
}
.card .label { font-size: 11px; color: var(--vscode-descriptionForeground); }
.card .value { font-size: 22px; font-weight: 600; margin-top: 2px; }
.chart-title {
  font-size: 12px; font-weight: 600; margin-bottom: 8px;
  color: var(--vscode-descriptionForeground);
}
canvas { display: block; margin-bottom: 20px; }
.bars { margin-bottom: 20px; }
.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.bar-label { width: 120px; font-size: 11px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex:1; height: 14px; background: var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--vscode-charts-blue); border-radius: 4px; transition: width .3s; }
.bar-time { width: 60px; font-size: 11px; }
.commit-list { margin-bottom: 20px; }
.commit-item {
  padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 11px; display: flex; gap: 8px;
}
.commit-hash { color: var(--vscode-descriptionForeground); font-family: monospace; }
.commit-msg { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.commit-proj { color: var(--vscode-descriptionForeground); }
.note {
  font-size: 11px; color: var(--vscode-descriptionForeground);
  padding: 8px; background: var(--vscode-sideBar-background);
  border-radius: 4px; margin-bottom: 12px;
}
</style>
</head>
<body>
<div class="tabs">
  <button class="tab" data-view="today">今日</button>
  <button class="tab" data-view="week">本周</button>
  <button class="tab" data-view="month">本月</button>
  <button class="tab" data-view="all">全部</button>
</div>
<div class="status-row">
  <div class="status-dot" id="statusDot"></div>
  <span id="statusLabel"></span>
</div>
<div class="cards" id="cards"></div>
<div id="adaptiveNote" class="note" style="display:none"></div>
<div class="chart-title">每日编码时间</div>
<canvas id="chart" width="720" height="220"></canvas>
<div class="chart-title">项目分布（编码时间）</div>
<div class="bars" id="projectBars"></div>
<div class="chart-title">最近提交</div>
<div class="commit-list" id="commitList"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// 状态
let currentView = 'today';

// 标签切换
document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    const view = el.dataset.view;
    if (view && view !== currentView) {
      currentView = view;
      vscode.postMessage({ type: 'switchView', view });
    }
  });
});

// 接收数据
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type !== 'data') return;
  currentView = msg.view;
  render(msg);
});

/** 渲染全部 */
function render(d) {
  // 标签激活态
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.view === d.view);
  });

  // 状态
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot ' + d.state;
  const labels = { active: '● 活跃', idle: '◐ 空闲', away: '○ 离开' };
  document.getElementById('statusLabel').textContent = labels[d.state] || d.state;

  // 自适应提示
  const noteEl = document.getElementById('adaptiveNote');
  if (d.adaptiveNote) {
    noteEl.style.display = '';
    noteEl.textContent = d.adaptiveNote;
  } else {
    noteEl.style.display = 'none';
  }

  // 统计卡片 — 从 todayStats (今日) 或 summary (其他) 取
  const s = d.view === 'today' ? d.todayStats : (d.summary || {});
  const cards = [
    { label: '编码时间', value: fmtTime(s.totalCodingTime || 0) },
    { label: '活跃时间', value: fmtTime(s.totalActiveTime || 0) },
    { label: '按键次数', value: fmtNum(s.totalKeystrokes || 0) },
    { label: '新增 / 删除', value: '+'+(s.totalLinesAdded||0)+' / -'+(s.totalLinesDeleted||0) },
    { label: 'Git 提交', value: (d.view === 'today' ? (d.commits||[]).length : ((s.totalCommits||0))) + '' },
    { label: '统计天数', value: (d.summary ? d.summary.totalDays : 1) + ' 天' },
  ];
  document.getElementById('cards').innerHTML = cards.map(c =>
    '<div class="card"><div class="label">'+c.label+'</div><div class="value">'+c.value+'</div></div>'
  ).join('');

  // 柱状图
  drawChart(d.dataPoints || []);

  // 项目分布
  renderProjectBars(d.summary && d.summary.topProjects || [], d.todayStats ? d.todayStats.projects : {});

  // 提交列表
  renderCommits(d.commits || []);
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function fmtNum(n) { return n.toLocaleString(); }

/** Canvas 柱状图 */
function drawChart(points) {
  const canvas = document.getElementById('chart');
  if (!canvas) return;
  const W = canvas.width = canvas.clientWidth || 720;
  const H = canvas.height = 220;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (points.length === 0) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', W/2, H/2);
    return;
  }

  const maxVal = Math.max(...points.map(p => p.codingTime), 1);
  const pad = { top: 10, right: 20, bottom: 30, left: 40 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const barW = Math.min(40, (chartW / points.length) * 0.7);
  const gap = (chartW - barW * points.length) / (points.length + 1);

  // Y 轴刻度
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') || '#444';
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = (maxVal / 4) * i;
    const y = pad.top + chartH - (val / maxVal) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtTime(val), pad.left - 4, y + 4);
  }

  // 柱子
  const blue = getComputedStyle(document.body).getPropertyValue('--vscode-charts-blue') || '#1a85ff';
  ctx.fillStyle = blue;
  ctx.textAlign = 'center';
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
  points.forEach((p, i) => {
    const x = pad.left + gap + i * (barW + gap);
    const h = (p.codingTime / maxVal) * chartH;
    const y = pad.top + chartH - h;
    ctx.fillStyle = blue;
    ctx.fillRect(x, y, barW, h);
    // 日期标签（取 MM-DD 部分）
    const label = p.date.length >= 10 ? p.date.slice(5) : p.date;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
    ctx.fillText(label, x + barW/2, H - 4);
  });
}

/** 项目分布条形图 */
function renderProjectBars(topProjects, projectDict) {
  const el = document.getElementById('projectBars');
  if (!el) return;
  const list = topProjects.length > 0 ? topProjects :
    Object.entries(projectDict || {}).map(([k,v]) => ({ name: k, time: v.codingTime || 0 }));
  if (list.length === 0) { el.innerHTML = '<div style="font-size:11px;color:var(--vscode-descriptionForeground)">暂无数据</div>'; return; }
  const maxT = Math.max(...list.map(p => p.time), 1);
  el.innerHTML = list.map(p => {
    const pct = ((p.time / maxT) * 100).toFixed(0);
    return '<div class="bar-row">' +
      '<div class="bar-label" title="'+p.name+'">'+p.name+'</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>' +
      '<div class="bar-time">'+fmtTime(p.time)+'</div>' +
    '</div>';
  }).join('');
}

/** 提交列表 */
function renderCommits(commits) {
  const el = document.getElementById('commitList');
  if (!el) return;
  if (commits.length === 0) { el.innerHTML = '<div style="font-size:11px;color:var(--vscode-descriptionForeground)">暂无提交</div>'; return; }
  const recent = commits.slice(-10).reverse();
  el.innerHTML = recent.map(c =>
    '<div class="commit-item">' +
      '<span class="commit-hash">'+c.hash.slice(0,7)+'</span>' +
      '<span class="commit-msg" title="'+c.message+'">'+c.message+'</span>' +
      '<span class="commit-proj">'+c.project+'</span>' +
    '</div>'
  ).join('');
}
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
