/**
 * MCP Widget Resources
 * Self-contained HTML widgets rendered by ChatGPT as iframes when tools return meta.ui.resource.
 * No external dependencies — all CSS and JS is inline.
 */

const WIDGET_RESOURCES: Record<string, { name: string; description: string; mimeType: string }> = {
  'sentinai://metrics-widget': {
    name: 'SentinAI Metrics',
    description: 'Real-time L1/L2 network metrics and scaling status',
    mimeType: 'text/html',
  },
  'sentinai://anomalies-widget': {
    name: 'SentinAI Anomalies',
    description: 'Anomaly event list with severity indicators',
    mimeType: 'text/html',
  },
  'sentinai://health-widget': {
    name: 'SentinAI Health',
    description: 'System health diagnostics dashboard',
    mimeType: 'text/html',
  },
};

export function getWidgetResourceList() {
  return Object.entries(WIDGET_RESOURCES).map(([uri, meta]) => ({ uri, ...meta }));
}

export function getWidgetHtml(uri: string): string | null {
  switch (uri) {
    case 'sentinai://metrics-widget':
      return buildMetricsWidget();
    case 'sentinai://anomalies-widget':
      return buildAnomaliesWidget();
    case 'sentinai://health-widget':
      return buildHealthWidget();
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared CSS
// ---------------------------------------------------------------------------
const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#e5e5e5;padding:16px;min-height:100vh}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.title{font-size:16px;font-weight:700;color:#fff}
.badge{padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.3px}
.badge-live{background:#22c55e22;color:#22c55e;border:1px solid #22c55e44}
.badge-idle{background:#71717a22;color:#71717a;border:1px solid #71717a44}
.badge-crit{background:#ef444422;color:#ef4444;border:1px solid #ef444444}
.badge-warn{background:#f9731622;color:#f97316;border:1px solid #f9731644}
.badge-high{background:#eab30822;color:#eab308;border:1px solid #eab30844}
.badge-low{background:#22c55e22;color:#22c55e;border:1px solid #22c55e44}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px}
.card-label{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px}
.card-val{font-size:22px;font-weight:700;color:#fff;line-height:1}
.card-sub{font-size:11px;color:#666;margin-top:4px}
.row{display:flex;align-items:center;gap:8px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:10px 13px;margin-top:10px}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-green{background:#22c55e}
.dot-yellow{background:#eab308}
.dot-red{background:#ef4444}
.dot-gray{background:#52525b}
.empty{text-align:center;color:#444;padding:32px;font-size:13px}
`;

// ---------------------------------------------------------------------------
// Metrics Widget
// ---------------------------------------------------------------------------
function buildMetricsWidget(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}
.vcpu-bar{height:6px;background:#2a2a2a;border-radius:3px;margin-top:8px;overflow:hidden}
.vcpu-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#22c55e,#3b82f6);transition:width .5s}
</style></head><body>
<div class="header">
  <span class="title">⚡ SentinAI Metrics</span>
  <span class="badge badge-idle" id="badge">LOADING</span>
</div>
<div class="grid2" id="cards">
  <div class="card"><div class="card-label">L2 Block</div><div class="card-val" id="l2b">—</div><div class="card-sub" id="l2t">—</div></div>
  <div class="card"><div class="card-label">Gas Price</div><div class="card-val" id="gas">—</div><div class="card-sub">Gwei</div></div>
  <div class="card"><div class="card-label">L1 Block</div><div class="card-val" id="l1b">—</div><div class="card-sub" id="l1t">—</div></div>
  <div class="card"><div class="card-label">CPU Usage</div><div class="card-val" id="cpu">—</div><div class="card-sub">%</div></div>
</div>
<div class="card" style="margin-top:10px">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div><div class="card-label">vCPU</div><div class="card-val" id="vcpu">—</div></div>
    <div style="text-align:right"><div class="card-label">Memory</div><div class="card-val" id="mem">—</div></div>
  </div>
  <div class="vcpu-bar"><div class="vcpu-fill" id="vcpu-bar" style="width:0%"></div></div>
  <div class="card-sub" id="vcpu-sub" style="margin-top:4px">—</div>
</div>
<div class="row"><div class="dot dot-gray" id="status-dot"></div><span style="font-size:12px;color:#666" id="status-txt">Waiting for data…</span></div>
<script>
function fmt(n,dec){return n==null?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:dec??0})}
function render(d){
  var l=d.latest||{},s=d.scaling||{};
  document.getElementById('l2b').textContent=fmt(l.blockHeight);
  document.getElementById('l1b').textContent='—';
  var gas=l.gasUsedRatio!=null?(l.gasUsedRatio*100).toFixed(1)+'%':'—';
  document.getElementById('gas').textContent=gas;
  document.getElementById('cpu').textContent=l.cpuUsage!=null?l.cpuUsage.toFixed(1):'—';
  var vc=s.currentVcpu||0,mg=s.currentMemoryGiB||0;
  document.getElementById('vcpu').textContent=vc||'—';
  document.getElementById('mem').textContent=mg?mg+'GB':'—';
  var pct=Math.min((vc/8)*100,100);
  document.getElementById('vcpu-bar').style.width=pct+'%';
  var auto=s.autoScalingEnabled,cd=s.cooldownRemaining||0;
  document.getElementById('vcpu-sub').textContent=(auto?'Auto-scaling ON':'Manual mode')+(cd>0?' · Cooldown '+cd+'s':'');
  document.getElementById('badge').className='badge badge-live';
  document.getElementById('badge').textContent='LIVE';
  document.getElementById('status-dot').className='dot dot-green';
  document.getElementById('status-txt').textContent=(d.metricsCount||0)+' data points · '+(d.generatedAt?new Date(d.generatedAt).toLocaleTimeString():'—');
  if(l.timestamp){var ago=Math.round((Date.now()-new Date(l.timestamp).getTime())/1000);document.getElementById('l2t').textContent=ago+'s ago';}
}
function onMsg(e){
  var m=e.data;if(!m||typeof m!=='object')return;
  var d=m.structuredContent||m.data||m.result;
  if(d&&(d.scaling||d.metricsCount!=null))render(d);
}
window.addEventListener('message',onMsg);
try{var p=new URLSearchParams(location.search),enc=p.get('data');if(enc)render(JSON.parse(decodeURIComponent(enc)));}catch(_){}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Anomalies Widget
// ---------------------------------------------------------------------------
function buildAnomaliesWidget(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}
.event{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:11px 13px;margin-bottom:8px}
.event-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.event-id{font-size:10px;color:#555;font-family:monospace}
.event-time{font-size:10px;color:#555}
.anomaly-row{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;color:#aaa}
.metric-tag{background:#23232f;border:1px solid #35354a;border-radius:4px;padding:1px 6px;font-size:10px;font-family:monospace;color:#818cf8}
.impact{margin-top:7px;font-size:11px;color:#888;line-height:1.5;border-top:1px solid #252525;padding-top:6px}
</style></head><body>
<div class="header">
  <span class="title">🔍 Anomaly Events</span>
  <span class="badge badge-idle" id="badge">LOADING</span>
</div>
<div id="list"><div class="empty">Waiting for data…</div></div>
<div class="row" style="margin-top:0"><div class="dot dot-gray" id="status-dot"></div><span style="font-size:12px;color:#666" id="status-txt">—</span></div>
<script>
var SEV={critical:'badge-crit',high:'badge-high',medium:'badge-warn',low:'badge-low'};
var DIR={spike:'↑',drop:'↓',plateau:'—'};
function timeAgo(ts){var s=Math.round((Date.now()-ts)/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
function render(d){
  var evts=d.events||[];
  var list=document.getElementById('list');
  if(!evts.length){list.innerHTML='<div class="empty">No anomaly events</div>';return;}
  list.innerHTML=evts.slice(0,8).map(function(ev){
    var da=ev.deepAnalysis||{};
    var sevClass=SEV[da.severity]||'badge-idle';
    var sevLabel=(da.severity||'unknown').toUpperCase();
    var anoms=(ev.anomalies||[]).filter(function(a){return a.isAnomaly;});
    var anomHtml=anoms.slice(0,3).map(function(a){
      return '<div class="anomaly-row"><span class="metric-tag">'+a.metric+'</span>'+(DIR[a.direction]||'')+'&nbsp;'+
        (a.value!=null?a.value.toFixed(2):'')+' <span style="color:#555">(z='+
        (a.zScore!=null?a.zScore.toFixed(1):'')+') '+a.direction+'</span></div>';
    }).join('');
    var impact=da.predictedImpact?'<div class="impact">'+da.predictedImpact+'</div>':'';
    return '<div class="event"><div class="event-header"><span class="badge '+sevClass+'">'+sevLabel+'</span><span class="event-time">'+timeAgo(ev.timestamp)+'</span></div>'+anomHtml+impact+'</div>';
  }).join('');
  var ac=d.activeCount||0,tot=d.total||evts.length;
  document.getElementById('badge').className='badge '+(ac>0?'badge-crit':'badge-low');
  document.getElementById('badge').textContent=ac>0?ac+' ACTIVE':'ALL CLEAR';
  document.getElementById('status-dot').className='dot '+(ac>0?'dot-red':'dot-green');
  document.getElementById('status-txt').textContent=tot+' total · '+ac+' active';
}
function onMsg(e){var m=e.data;if(!m||typeof m!=='object')return;var d=m.structuredContent||m.data||m.result;if(d&&d.events)render(d);}
window.addEventListener('message',onMsg);
try{var p=new URLSearchParams(location.search),enc=p.get('data');if(enc)render(JSON.parse(decodeURIComponent(enc)));}catch(_){}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Health Widget
// ---------------------------------------------------------------------------
function buildHealthWidget(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}
.comp{display:flex;align-items:center;justify-content:space-between;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:10px 13px;margin-bottom:8px}
.comp-name{font-size:13px;font-weight:600;color:#e5e5e5}
.comp-detail{font-size:11px;color:#666;margin-top:2px}
.section-title{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 7px}
</style></head><body>
<div class="header">
  <span class="title">🩺 Health Diagnostics</span>
  <span class="badge badge-idle" id="badge">LOADING</span>
</div>
<div class="grid3" id="summary">
  <div class="card"><div class="card-label">Data Points</div><div class="card-val" id="dp">—</div></div>
  <div class="card"><div class="card-label">Anomalies</div><div class="card-val" id="anoms">—</div></div>
  <div class="card"><div class="card-label">vCPU</div><div class="card-val" id="vcpu">—</div></div>
</div>
<div class="section-title">L1 RPC</div>
<div class="row" id="l1-row" style="margin-top:0"><div class="dot dot-gray" id="l1-dot"></div><span style="font-size:12px" id="l1-txt">—</span></div>
<div class="section-title">Components</div>
<div id="comps"><div class="empty">Waiting for data…</div></div>
<div class="row"><div class="dot dot-gray" id="status-dot"></div><span style="font-size:12px;color:#666" id="status-txt">—</span></div>
<script>
function render(d){
  var m=d.metrics||{},an=d.anomalies||{},l1=d.l1Rpc||{},comps=d.components||[];
  document.getElementById('dp').textContent=m.count!=null?m.count:'—';
  document.getElementById('anoms').textContent=an.active!=null?an.active+(an.active>0?' ⚠':'✓'):'—';
  document.getElementById('vcpu').textContent=m.currentVcpu||'—';
  var l1ok=l1.healthy;
  document.getElementById('l1-dot').className='dot '+(l1ok?'dot-green':'dot-red');
  document.getElementById('l1-txt').textContent='L1 RPC: '+(l1ok?'Healthy':'Unhealthy')+' · '+
    (l1.endpointCount||0)+' endpoints';
  var allOk=comps.every(function(c){return c.healthy;});
  document.getElementById('comps').innerHTML=comps.length?comps.map(function(c){
    return '<div class="comp"><div><div class="comp-name">'+c.component+'</div>'+
      '<div class="comp-detail">'+c.details+'</div></div>'+
      '<span class="badge '+(c.healthy?'badge-low':'badge-crit')+'">'+(c.healthy?'OK':'DOWN')+'</span></div>';
  }).join(''):'<div class="empty">No components</div>';
  document.getElementById('badge').className='badge '+(allOk&&l1ok?'badge-live':'badge-crit');
  document.getElementById('badge').textContent=allOk&&l1ok?'HEALTHY':'DEGRADED';
  document.getElementById('status-dot').className='dot '+(allOk?'dot-green':'dot-red');
  document.getElementById('status-txt').textContent=comps.length+' components checked · '+(d.generatedAt?new Date(d.generatedAt).toLocaleTimeString():'—');
}
function onMsg(e){var m=e.data;if(!m||typeof m!=='object')return;var d=m.structuredContent||m.data||m.result;if(d&&(d.components||d.metrics))render(d);}
window.addEventListener('message',onMsg);
try{var p=new URLSearchParams(location.search),enc=p.get('data');if(enc)render(JSON.parse(decodeURIComponent(enc)));}catch(_){}
</script></body></html>`;
}
