/** Webview 内联 CSS（通过 buildHtml 注入）。 */
export const STYLES = `
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

/* ===== 年度选择器 ===== */
.year-selector{
  display:flex;align-items:center;gap:8px;margin-bottom:20px;
}
.year-label{
  font-size:12px;color:var(--vscode-descriptionForeground,#999);
  padding:6px 0;
}
.year-buttons{
  display:flex;gap:4px;
}
.year-btn{
  padding:5px 14px;border-radius:16px;font-size:12px;
  border:1px solid var(--vscode-panel-border,#444);
  background:transparent;color:var(--vscode-foreground,#ccc);
  cursor:pointer;transition:all .15s;
}
.year-btn:hover{
  background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.08));
  border-color:var(--vscode-descriptionForeground,#999);
}
.year-btn.active{
  background:var(--vscode-button-background,#0e639c);
  color:var(--vscode-button-foreground,#fff);
  border-color:var(--vscode-button-background,#0e639c);
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
.canvas-wrap{width:100%;overflow:hidden}
.canvas-wrap canvas{display:block;width:100%;height:auto}
.canvas-wrap-sq{width:100%;max-width:260px;margin:0 auto;aspect-ratio:1;overflow:hidden}
.canvas-wrap-sq canvas{display:block;width:100%;height:100%}

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
`;
