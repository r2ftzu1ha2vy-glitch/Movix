// ===================== STATE =====================
const state = {
  bin: [],          // imported media: {id, type, name, url, el, duration, width, height}
  tracks: {
    video: [],      // clips: {id, binId, type:'video'|'image', trackType:'video', start, end(=start+dur), inPoint, outPoint, name}
    text:  [],      // {id, type:'text', start, end, text, color, size, x, y, font}
    audio: []       // {id, type:'audio', binId, start, end, inPoint, outPoint, name}
  },
  selection: null,  // {kind:'clip'|'text', track, id}
  playhead: 0,      // seconds
  duration: 30,     // total timeline duration (auto-extends)
  playing: false,
  zoom: 70,         // px per second
  history: [],
  future: []
};

const PX_PER_SEC = () => state.zoom;
let idCounter = 1;
const uid = () => 'id' + (idCounter++);

function trackGutter(){
  const v = getComputedStyle(document.documentElement).getPropertyValue('--track-gutter').trim();
  return parseInt(v, 10) || 190;
}

// ===================== LOADER =====================
(function bootLoader(){
  const fill = document.getElementById('loaderFill');
  const status = document.getElementById('loaderStatus');
  const frames = document.getElementById('loaderFrames');
  const loader = document.getElementById('loader');
  const app = document.getElementById('app');
  const messages = [
    'threading film…', 'aligning sprockets…', 'calibrating light…',
    'spooling reel…', 'syncing audio…', 'cueing playhead…'
  ];
  let pct = 0;
  const totalFrames = 240;
  const timer = setInterval(() => {
    pct += Math.random() * 14 + 6;
    if (pct >= 100) pct = 100;
    fill.style.width = pct + '%';
    frames.textContent = `FRAME ${String(Math.round(pct/100*totalFrames)).padStart(4,'0')} / ${totalFrames}`;
    status.textContent = messages[Math.min(messages.length - 1, Math.floor(pct / (100/messages.length)))];
    if (pct >= 100) {
      clearInterval(timer);
      setTimeout(() => {
        loader.classList.add('fade-out');
        app.classList.remove('hidden');
        initApp();
        setTimeout(() => loader.remove(), 550);
      }, 250);
    }
  }, 140);
})();

// ===================== TIME HELPERS =====================
function fmtTC(sec){
  sec = Math.max(0, sec);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  const f = Math.floor((sec%1)*30); // assume 30fps display
  const p = n => String(n).padStart(2,'0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

// ===================== APP INIT =====================
let ctx, canvas, previewWrap;

function initApp(){
  canvas = document.getElementById('previewCanvas');
  ctx = canvas.getContext('2d');
  previewWrap = document.getElementById('previewWrap');

  setupImport();
  setupTabs();
  setupTransport();
  setupTimelineDrag();
  setupZoom();
  setupExportModal();
  setupTextTool();
  setupKeyboard();
  setupDrawers();

  const copyYear = document.getElementById('copyYear');
  if (copyYear) copyYear.textContent = new Date().getFullYear();

  renderRuler();
  renderTracks();
  renderTopTimecode();
  updatePlayheadUI(true);
  window.addEventListener('resize', () => { renderRuler(); renderTracks(); syncTimelineScroll(); });
  requestAnimationFrame(renderLoop);
}

// ===================== MOBILE DRAWERS =====================
function setupDrawers(){
  const pool = document.querySelector('.pool');
  const props = document.querySelector('.props');
  const scrim = document.getElementById('drawerScrim');
  const poolToggle = document.getElementById('poolToggle');
  const propsToggle = document.getElementById('propsToggle');

  function closeDrawers(){
    pool.classList.remove('open');
    props.classList.remove('open');
    poolToggle.classList.remove('active');
    propsToggle.classList.remove('active');
    scrim.classList.remove('show');
  }
  function openPool(){
    props.classList.remove('open'); propsToggle.classList.remove('active');
    pool.classList.add('open'); poolToggle.classList.add('active');
    scrim.classList.add('show');
  }
  function openProps(){
    pool.classList.remove('open'); poolToggle.classList.remove('active');
    props.classList.add('open'); propsToggle.classList.add('active');
    scrim.classList.add('show');
  }

  poolToggle.addEventListener('click', () => {
    pool.classList.contains('open') ? closeDrawers() : openPool();
  });
  propsToggle.addEventListener('click', () => {
    props.classList.contains('open') ? closeDrawers() : openProps();
  });
  scrim.addEventListener('click', closeDrawers);

  // expose so selection logic can auto-open the props drawer on mobile
  window._movixOpenProps = openProps;
  window._movixCloseDrawers = closeDrawers;
}

// ===================== IMPORT =====================
function setupImport(){
  const drop = document.getElementById('importDrop');
  const input = document.getElementById('fileInput');

  // Note: #importDrop is a <label> wrapping #fileInput, so clicking it
  // natively opens the file picker — no extra click-forwarding needed.
  input.addEventListener('change', e => handleFiles(e.target.files));

  ['dragover','dragleave','drop'].forEach(evt=>{
    drop.addEventListener(evt, e=>{
      e.preventDefault();
      if(evt==='dragover') drop.classList.add('dragover');
      else drop.classList.remove('dragover');
    });
  });
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
}

function handleFiles(fileList){
  [...fileList].forEach(file => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const isAudio = file.type.startsWith('audio');
    const isImage = file.type.startsWith('image');

    if (isVideo || isAudio) {
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.src = url; el.muted = false; el.preload = 'metadata';
      el.playsInline = true;
      el.addEventListener('loadedmetadata', () => {
        const item = {
          id: uid(), type: isVideo ? 'video' : 'audio', name: file.name,
          url, el, duration: el.duration || 5,
          width: el.videoWidth || 0, height: el.videoHeight || 0
        };
        state.bin.push(item);
        renderBin();
      });
      el.addEventListener('error', () => {
        console.error('Failed to load media file:', file.name, el.error);
        alert(`Couldn't import "${file.name}" — the file format may not be supported by this browser.`);
      });
    } else if (isImage) {
      const img = new Image();
      img.onload = () => {
        const item = { id: uid(), type:'image', name: file.name, url, el: img, duration: 5, width: img.width, height: img.height };
        state.bin.push(item);
        renderBin();
      };
      img.onerror = () => {
        console.error('Failed to load image file:', file.name);
        alert(`Couldn't import "${file.name}" — the file may be corrupted or unsupported.`);
      };
      img.src = url;
    }
  });
}

function renderBin(){
  const bin = document.getElementById('clipBin');
  bin.innerHTML = '';
  state.bin.forEach(item => {
    const row = document.createElement('div');
    row.className = 'bin-item';
    row.draggable = true;

    let thumbHtml;
    if (item.type === 'image') {
      thumbHtml = `<img class="bin-thumb" src="${item.url}">`;
    } else {
      thumbHtml = `<div class="bin-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--slate-dim);font-size:14px;">${item.type==='audio'?'♪':'▶'}</div>`;
    }

    row.innerHTML = `
      ${thumbHtml}
      <div class="bin-meta">
        <div class="bin-name">${escapeHtml(item.name)}</div>
        <div class="bin-dur">${fmtTC(item.duration)}</div>
      </div>
      <button class="bin-add" title="Add to timeline">+</button>
    `;
    row.querySelector('.bin-add').addEventListener('click', () => addToTimeline(item));
    row.addEventListener('dblclick', () => addToTimeline(item));
    bin.appendChild(row);
  });
}

function addToTimeline(item){
  pushHistory();
  const trackType = item.type === 'audio' ? 'audio' : 'video';
  const list = state.tracks[trackType];
  const start = list.length ? Math.max(...list.map(c=>c.end)) : 0;
  const clip = {
    id: uid(), binId: item.id, type: item.type, name: item.name,
    start, end: start + item.duration, inPoint: 0, outPoint: item.duration
  };
  list.push(clip);
  extendDuration();
  renderTracks();
  selectClip('clip', trackType, clip.id, false);
  // on phones, get the drawer out of the way so the new clip is visible
  if (window._movixCloseDrawers) window._movixCloseDrawers();
}

// ===================== TABS =====================
function setupTabs(){
  document.querySelectorAll('.pool-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pool-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.pool-panel').forEach(p=>p.classList.add('hidden'));
      document.getElementById('panel-' + tab.dataset.tab).classList.remove('hidden');
    });
  });
}

// ===================== TEXT TOOL =====================
function setupTextTool(){
  document.getElementById('addTextBtn').addEventListener('click', () => {
    pushHistory();
    const clip = {
      id: uid(), type:'text', name:'Text',
      start: state.playhead, end: state.playhead + 3,
      text: 'Your text here', color: '#F5A623', size: 48,
      x: 0.5, y: 0.85, font: 'Space Grotesk'
    };
    state.tracks.text.push(clip);
    extendDuration();
    renderTracks();
    selectClip('clip', 'text', clip.id);
  });
}

// ===================== TRANSPORT =====================
function setupTransport(){
  const playBtn = document.getElementById('playBtn');
  playBtn.addEventListener('click', togglePlay);
  document.getElementById('splitBtn').addEventListener('click', splitAtPlayhead);
}

function togglePlay(){
  state.playing = !state.playing;
  document.getElementById('playBtn').textContent = state.playing ? '❚❚' : '▶';
  syncMediaPlayback();
}

function syncMediaPlayback(){
  // Pause/play underlying media elements based on state.playing and whether under playhead
  [...state.tracks.video, ...state.tracks.audio].forEach(clip => {
    const item = findBinItem(clip.binId);
    if (!item || item.type === 'image') return;
    const active = state.playhead >= clip.start && state.playhead < clip.end;
    if (state.playing && active) {
      const t = clip.inPoint + (state.playhead - clip.start);
      if (Math.abs(item.el.currentTime - t) > 0.25) item.el.currentTime = t;
      item.el.play().catch(()=>{});
    } else {
      item.el.pause();
    }
  });
}

function splitAtPlayhead(){
  const t = state.playhead;
  pushHistory();
  ['video','text','audio'].forEach(trackType => {
    state.tracks[trackType].forEach(clip => {
      if (t > clip.start + 0.05 && t < clip.end - 0.05) {
        const clone = { ...clip, id: uid() };
        if (clip.type !== 'text') {
          clone.inPoint = clip.inPoint + (t - clip.start);
        }
        clone.start = t;
        const originalOut = clip.outPoint;
        clip.end = t;
        if (clip.type !== 'text') clip.outPoint = clip.inPoint + (clip.end - clip.start);
        if (clip.type !== 'text') clone.outPoint = originalOut;
        state.tracks[trackType].push(clone);
      }
    });
  });
  renderTracks();
}

// ===================== ZOOM =====================
function setupZoom(){
  const range = document.getElementById('zoomRange');
  range.addEventListener('input', () => {
    state.zoom = parseInt(range.value, 10);
    renderRuler();
    renderTracks();
    syncTimelineScroll();
  });
}

// ===================== RULER =====================
function timelineWidth(){
  return Math.max(state.duration, 30) * PX_PER_SEC() + 400;
}
// clips are positioned inside the track, after the (sticky) label gutter
const clipLeft = sec => trackGutter() + sec * PX_PER_SEC();

function renderRuler(){
  const ruler = document.getElementById('ruler');
  ruler.innerHTML = '';
  const px = PX_PER_SEC();
  const totalW = timelineWidth();
  ruler.style.width = totalW + 'px';

  const step = px < 40 ? 5 : px < 90 ? 2 : 1;
  for (let s = 0; s <= Math.max(state.duration, 30) + 20; s += step) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = (s * px) + 'px';
    tick.textContent = fmtTC(s).slice(0,8);
    ruler.appendChild(tick);
  }
}

// ===================== TRACKS RENDER =====================
const TRACK_DEFS = [
  { key:'text', label:'Text', icon:'T' },
  { key:'video', label:'Video', icon:'▶' },
  { key:'audio', label:'Audio', icon:'♪' },
];

function renderTracks(){
  const wrap = document.getElementById('tracks');
  wrap.innerHTML = '';
  const px = PX_PER_SEC();
  const trackW = timelineWidth();

  TRACK_DEFS.forEach(def => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    trackEl.dataset.track = def.key;
    trackEl.style.width = (trackW + trackGutter()) + 'px';

    const label = document.createElement('div');
    label.className = 'track-label';
    label.innerHTML = `<span class="track-icon">${def.icon}</span> ${def.label}`;
    trackEl.appendChild(label);

    state.tracks[def.key].forEach(clip => {
      const clipEl = document.createElement('div');
      const kindClass = def.key === 'text' ? 'text-clip' : def.key === 'audio' ? 'audio-clip' : '';
      clipEl.className = `clip ${kindClass}`.trim();
      if (state.selection && state.selection.id === clip.id) clipEl.classList.add('selected');
      clipEl.style.left = clipLeft(clip.start) + 'px';
      clipEl.style.width = Math.max(6, (clip.end - clip.start) * px) + 'px';
      clipEl.dataset.id = clip.id;
      clipEl.dataset.track = def.key;

      clipEl.innerHTML = `
        <div class="clip-name">${escapeHtml(clip.text || clip.name || 'Clip')}</div>
        <div class="clip-handle left"></div>
        <div class="clip-handle right"></div>
      `;
      attachClipDrag(clipEl, clip, def.key);
      trackEl.appendChild(clipEl);
    });

    wrap.appendChild(trackEl);
  });
}

// ===================== CLIP DRAG / TRIM =====================
// Pointer events so mouse, touch and pen all work. During a drag the clip
// element is updated in place (rebuilding it would drop the touch pointer);
// the tracks are fully re-rendered once the gesture ends.
function attachClipDrag(clipEl, clip, trackType){
  clipEl.addEventListener('click', (e) => {
    e.stopPropagation();
    selectClip('clip', trackType, clip.id);
  });

  const startDrag = (e, mode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    pushHistory();
    const px = PX_PER_SEC();
    const startX = e.clientX;
    const pointerId = e.pointerId;
    const origStart = clip.start, origEnd = clip.end;
    const origIn = clip.inPoint, origOut = clip.outPoint;
    const dur = origEnd - origStart;
    let moved = false;

    function onMove(ev){
      if (ev.pointerId !== pointerId) return;
      const dx = (ev.clientX - startX) / px;
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      if (mode === 'move') {
        let ns = Math.max(0, origStart + dx);
        clip.start = ns; clip.end = ns + dur;
      } else if (mode === 'left') {
        let ns = Math.max(0, Math.min(origEnd - 0.2, origStart + dx));
        const delta = ns - origStart;
        clip.start = ns;
        if (clip.type !== 'text') clip.inPoint = Math.max(0, origIn + delta);
      } else if (mode === 'right') {
        let ne = Math.max(origStart + 0.2, origEnd + dx);
        if (clip.type !== 'text') {
          const item = findBinItem(clip.binId);
          if (item) ne = Math.min(ne, origStart + (item.duration - origIn));
        }
        clip.end = ne;
        if (clip.type !== 'text') clip.outPoint = origOut + (ne - origEnd);
      }
      clipEl.style.left = clipLeft(clip.start) + 'px';
      clipEl.style.width = Math.max(6, (clip.end - clip.start) * px) + 'px';
    }
    function onUp(ev){
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) {
        extendDuration();
        renderTracks();
        // the re-render replaced the element, so a click won't fire — keep selection in sync
        if (state.selection && state.selection.id === clip.id) renderProps();
      } else {
        // a tap / click without movement: drop the history entry we just pushed
        state.history.pop();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  clipEl.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('clip-handle')) return;
    startDrag(e, 'move');
  });
  clipEl.querySelector('.clip-handle.left').addEventListener('pointerdown', e => startDrag(e, 'left'));
  clipEl.querySelector('.clip-handle.right').addEventListener('pointerdown', e => startDrag(e, 'right'));
}

function findBinItem(binId){ return state.bin.find(b => b.id === binId); }

function extendDuration(){
  let max = 10;
  ['video','text','audio'].forEach(t => state.tracks[t].forEach(c => { if (c.end > max) max = c.end; }));
  state.duration = max + 5;
  renderRuler();
}

// ===================== TIMELINE SCRUB =====================
function setupTimelineDrag(){
  const rulerWrap = document.getElementById('rulerWrap');
  const tracksEl = document.getElementById('tracks');

  function seekFromEvent(e){
    const rect = tracksEl.getBoundingClientRect();
    const x = e.clientX - rect.left + tracksEl.scrollLeft - trackGutter();
    state.playhead = Math.max(0, x / PX_PER_SEC());
    updatePlayheadUI();
  }

  function beginScrub(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    seekFromEvent(e);
    const onMove = ev => { if (ev.pointerId === pointerId) seekFromEvent(ev); };
    const onUp = ev => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  rulerWrap.addEventListener('pointerdown', beginScrub);

  // empty timeline space: tap to move the playhead and deselect.
  // (touch scrolling still works here — only the ruler and clips lock touch gestures)
  let tapStart = null;
  tracksEl.addEventListener('pointerdown', e => {
    if (e.target === tracksEl || e.target.classList.contains('track')) {
      tapStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    } else tapStart = null;
  });
  tracksEl.addEventListener('pointerup', e => {
    if (!tapStart || tapStart.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 6;
    tapStart = null;
    if (moved) return;
    selectClip(null);
    seekFromEvent(e);
  });
  tracksEl.addEventListener('pointercancel', () => { tapStart = null; });

  // keep ruler + playhead aligned with the horizontally scrolling tracks
  tracksEl.addEventListener('scroll', syncTimelineScroll, { passive: true });
}

function syncTimelineScroll(){
  const sl = document.getElementById('tracks').scrollLeft;
  document.getElementById('ruler').style.transform = `translateX(${-sl}px)`;
  updatePlayheadUI(true);
}

function updatePlayheadUI(skipSync){
  const px = PX_PER_SEC();
  const tr = document.getElementById('tracks');
  let x = state.playhead * px - tr.scrollLeft;   // relative to the start of the track area
  if (state.playing) {
    // keep the playhead in view while playing
    const viewW = tr.clientWidth - trackGutter();
    if (x > viewW - 24 || x < 0) {
      tr.scrollLeft = Math.max(0, state.playhead * px - 40);
      x = state.playhead * px - tr.scrollLeft;
    }
  }
  const ph = document.getElementById('playhead');
  ph.style.left = (trackGutter() + x) + 'px';
  ph.style.visibility = x < -1 ? 'hidden' : 'visible'; // scrolled under the labels
  renderTopTimecode();
  if (!skipSync) syncMediaPlayback();
}

function renderTopTimecode(){
  document.getElementById('topTimecode').textContent = fmtTC(state.playhead);
  document.getElementById('transportTc').textContent = fmtTC(state.playhead);
  document.getElementById('transportDur').textContent = fmtTC(state.duration);
}

// ===================== SELECTION / PROPERTIES =====================
function selectClip(kind, trackType, id, openPanel = true){
  if (!kind) { state.selection = null; renderTracks(); renderProps(); return; }
  state.selection = { kind, track: trackType, id };
  renderTracks();
  renderProps();
  if (openPanel && window.matchMedia('(max-width: 900px)').matches && window._movixOpenProps) window._movixOpenProps();
}

function getSelectedClip(){
  if (!state.selection) return null;
  return state.tracks[state.selection.track].find(c => c.id === state.selection.id);
}

function renderProps(){
  const empty = document.getElementById('propsEmpty');
  const content = document.getElementById('propsContent');
  const clip = getSelectedClip();

  if (!clip) {
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  content.classList.remove('hidden');

  if (clip.type === 'text') {
    content.innerHTML = `
      <div class="prop-group">
        <span class="prop-label">Content</span>
        <textarea class="prop-textarea" id="propText">${escapeHtml(clip.text)}</textarea>
      </div>
      <div class="prop-group">
        <span class="prop-label">Style</span>
        <div class="prop-row"><label>Color</label><input type="color" id="propColor" value="${clip.color}"></div>
        <div class="prop-row"><label>Size</label><input type="range" id="propSize" min="12" max="120" value="${clip.size}"><span class="prop-value">${clip.size}</span></div>
      </div>
      <div class="prop-group">
        <span class="prop-label">Position</span>
        <div class="prop-row"><label>X</label><input type="range" id="propX" min="0" max="1" step="0.01" value="${clip.x}"></div>
        <div class="prop-row"><label>Y</label><input type="range" id="propY" min="0" max="1" step="0.01" value="${clip.y}"></div>
      </div>
      <div class="prop-group">
        <span class="prop-label">Timing</span>
        <div class="prop-row"><label>Start</label><input type="number" id="propStart" step="0.1" value="${clip.start.toFixed(2)}"></div>
        <div class="prop-row"><label>End</label><input type="number" id="propEnd" step="0.1" value="${clip.end.toFixed(2)}"></div>
      </div>
      <button class="prop-delete" id="propDelete">Delete layer</button>
    `;
    document.getElementById('propText').addEventListener('input', e => { pushHistory(); clip.text = e.target.value; renderTracks(); });
    document.getElementById('propColor').addEventListener('input', e => { clip.color = e.target.value; });
    document.getElementById('propSize').addEventListener('input', e => { clip.size = parseInt(e.target.value); e.target.nextElementSibling.textContent = clip.size; });
    document.getElementById('propX').addEventListener('input', e => { clip.x = parseFloat(e.target.value); });
    document.getElementById('propY').addEventListener('input', e => { clip.y = parseFloat(e.target.value); });
    document.getElementById('propStart').addEventListener('change', e => { clip.start = parseFloat(e.target.value); extendDuration(); renderTracks(); });
    document.getElementById('propEnd').addEventListener('change', e => { clip.end = parseFloat(e.target.value); extendDuration(); renderTracks(); });
  } else {
    const item = findBinItem(clip.binId);
    content.innerHTML = `
      <div class="prop-group">
        <span class="prop-label">Clip</span>
        <div class="prop-row"><label>Name</label><span style="font-size:12px;color:var(--bone);">${escapeHtml(clip.name)}</span></div>
      </div>
      <div class="prop-group">
        <span class="prop-label">Timing</span>
        <div class="prop-row"><label>Start</label><span class="prop-value" style="font-family:var(--font-mono)">${fmtTC(clip.start)}</span></div>
        <div class="prop-row"><label>End</label><span class="prop-value" style="font-family:var(--font-mono)">${fmtTC(clip.end)}</span></div>
        <div class="prop-row"><label>Duration</label><span class="prop-value" style="font-family:var(--font-mono)">${fmtTC(clip.end-clip.start)}</span></div>
      </div>
      ${clip.type !== 'audio' ? `
      <div class="prop-group">
        <span class="prop-label">Opacity</span>
        <div class="prop-row"><input type="range" id="propOpacity" min="0" max="1" step="0.01" value="${clip.opacity ?? 1}"></div>
      </div>` : ''}
      <button class="prop-delete" id="propDelete">Remove from timeline</button>
    `;
    const opacityEl = document.getElementById('propOpacity');
    if (opacityEl) opacityEl.addEventListener('input', e => { clip.opacity = parseFloat(e.target.value); });
  }

  document.getElementById('propDelete').addEventListener('click', () => {
    pushHistory();
    const track = state.selection.track;
    state.tracks[track] = state.tracks[track].filter(c => c.id !== clip.id);
    state.selection = null;
    renderTracks();
    renderProps();
  });
}

// ===================== HISTORY (undo/redo) =====================
function pushHistory(){
  state.history.push(JSON.stringify({ tracks: state.tracks, duration: state.duration }));
  if (state.history.length > 50) state.history.shift();
  state.future = [];
}
function undo(){
  if (!state.history.length) return;
  state.future.push(JSON.stringify({ tracks: state.tracks, duration: state.duration }));
  const prev = JSON.parse(state.history.pop());
  state.tracks = prev.tracks; state.duration = prev.duration;
  state.selection = null;
  renderTracks(); renderProps(); renderRuler();
}
function redo(){
  if (!state.future.length) return;
  state.history.push(JSON.stringify({ tracks: state.tracks, duration: state.duration }));
  const next = JSON.parse(state.future.pop());
  state.tracks = next.tracks; state.duration = next.duration;
  state.selection = null;
  renderTracks(); renderProps(); renderRuler();
}
document.getElementById('undoBtn')?.addEventListener('click', undo);
document.getElementById('redoBtn')?.addEventListener('click', redo);

// ===================== KEYBOARD =====================
function setupKeyboard(){
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's' || e.key === 'S') splitAtPlayhead();
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const clip = getSelectedClip();
      if (clip) {
        pushHistory();
        state.tracks[state.selection.track] = state.tracks[state.selection.track].filter(c => c.id !== clip.id);
        state.selection = null;
        renderTracks(); renderProps();
      }
    }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });
}

// ===================== RENDER LOOP (preview compositing) =====================
function renderLoop(ts){
  if (state.playing) {
    if (!renderLoop._last) renderLoop._last = ts;
    const dt = (ts - renderLoop._last) / 1000;
    renderLoop._last = ts;
    state.playhead += dt;
    if (state.playhead > state.duration) { state.playhead = 0; state.playing = false; document.getElementById('playBtn').textContent = '▶'; syncMediaPlayback(); }
    updatePlayheadUI();
  } else {
    renderLoop._last = ts;
  }
  compositeFrame();
  requestAnimationFrame(renderLoop);
}

function compositeFrame(){
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const activeVideo = state.tracks.video.find(c => state.playhead >= c.start && state.playhead < c.end);
  const emptyStage = document.getElementById('emptyStage');

  if (activeVideo) {
    emptyStage.classList.add('hidden');
    const item = findBinItem(activeVideo.binId);
    if (item) {
      if (item.type === 'video') {
        const t = activeVideo.inPoint + (state.playhead - activeVideo.start);
        if (!state.playing && Math.abs(item.el.currentTime - t) > 0.04) {
          try { item.el.currentTime = t; } catch(e){}
        }
        drawCover(item.el, item.width || item.el.videoWidth, item.height || item.el.videoHeight, w, h, activeVideo.opacity ?? 1);
      } else if (item.type === 'image') {
        drawCover(item.el, item.width, item.height, w, h, activeVideo.opacity ?? 1);
      }
    }
  } else {
    if (state.tracks.video.length === 0 && state.tracks.text.length === 0) {
      emptyStage.classList.remove('hidden');
    } else {
      emptyStage.classList.add('hidden');
    }
  }

  // text layers
  state.tracks.text.forEach(clip => {
    if (state.playhead >= clip.start && state.playhead < clip.end) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = clip.color;
      ctx.font = `700 ${clip.size}px ${clip.font}, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 8;
      const lines = clip.text.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, clip.x * w, clip.y * h + i * clip.size * 1.15);
      });
      ctx.restore();
    }
  });
}

function drawCover(mediaEl, srcW, srcH, dstW, dstH, opacity){
  if (!srcW || !srcH) return;
  const srcRatio = srcW / srcH, dstRatio = dstW / dstH;
  let sx=0, sy=0, sw=srcW, sh=srcH;
  if (srcRatio > dstRatio) { sw = srcH * dstRatio; sx = (srcW - sw)/2; }
  else { sh = srcW / dstRatio; sy = (srcH - sh)/2; }
  ctx.save();
  ctx.globalAlpha = opacity;
  try { ctx.drawImage(mediaEl, sx, sy, sw, sh, 0, 0, dstW, dstH); } catch(e){}
  ctx.restore();
}

// ===================== EXPORT =====================
function setupExportModal(){
  const modal = document.getElementById('exportModal');
  function openExportModal(){
    modal.classList.remove('hidden');
    document.getElementById('exportProgress').classList.add('hidden');
    document.getElementById('exportDownload').classList.add('hidden');
    document.getElementById('exportStart').classList.remove('hidden');
  }
  document.getElementById('exportBtn').addEventListener('click', openExportModal);
  document.getElementById('exportCancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('exportStart').addEventListener('click', runExport);
}

async function runExport(){
  const formatSel = document.getElementById('exportFormat').value;
  const [resW, resH] = document.getElementById('exportRes').value.split('x').map(Number);
  const startBtn = document.getElementById('exportStart');
  const progressWrap = document.getElementById('exportProgress');
  const fill = document.getElementById('exportFill');
  const status = document.getElementById('exportStatus');
  const downloadBtn = document.getElementById('exportDownload');

  startBtn.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  downloadBtn.classList.add('hidden');

  // offscreen render canvas at export resolution
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = resW; exportCanvas.height = resH;
  const exCtx = exportCanvas.getContext('2d');

  const fps = 30;
  const totalDuration = Math.max(1, Math.max(
    ...state.tracks.video.map(c=>c.end), ...state.tracks.text.map(c=>c.end), ...state.tracks.audio.map(c=>c.end), 1
  ));
  const totalFrames = Math.ceil(totalDuration * fps);

  let mimeType = formatSel;
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  const stream = exportCanvas.captureStream(fps);

  // Try to include audio via a mixed audio destination
  let audioDest = null, audioCtx = null;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioDest = audioCtx.createMediaStreamDestination();
    const audioTrack = audioDest.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  } catch(e){ /* audio mixing unavailable, continue video-only */ }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start();

  // pause main playback during export
  const wasPlaying = state.playing;
  state.playing = false;

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    renderExportFrame(exCtx, exportCanvas.width, exportCanvas.height, t);
    fill.style.width = Math.round((f/totalFrames)*100) + '%';
    status.textContent = `Rendering frame ${f+1} / ${totalFrames}…`;
    // yield to allow canvas stream to capture + UI to update
    await new Promise(r => setTimeout(r, 1000/fps));
  }

  status.textContent = 'Finalizing…';
  recorder.stop();
  await done;
  if (audioCtx) audioCtx.close();

  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  const url = URL.createObjectURL(blob);
  downloadBtn.href = url;
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  downloadBtn.download = `${(document.getElementById('projName').textContent || 'movix-export').trim().replace(/\s+/g,'-')}.${ext}`;
  downloadBtn.classList.remove('hidden');
  status.textContent = `Done — ${(blob.size/1024/1024).toFixed(1)} MB ready to download.`;
  fill.style.width = '100%';

  state.playing = wasPlaying;
}

function renderExportFrame(exCtx, w, h, t){
  exCtx.fillStyle = '#000';
  exCtx.fillRect(0,0,w,h);

  const activeVideo = state.tracks.video.find(c => t >= c.start && t < c.end);
  if (activeVideo) {
    const item = findBinItem(activeVideo.binId);
    if (item) {
      if (item.type === 'video') {
        const vt = activeVideo.inPoint + (t - activeVideo.start);
        try { item.el.currentTime = vt; } catch(e){}
      }
      drawCoverTo(exCtx, item.el, item.width, item.height, w, h, activeVideo.opacity ?? 1);
    }
  }

  state.tracks.text.forEach(clip => {
    if (t >= clip.start && t < clip.end) {
      exCtx.save();
      exCtx.fillStyle = clip.color;
      exCtx.font = `700 ${clip.size * (w/1280)}px ${clip.font}, sans-serif`;
      exCtx.textAlign = 'center';
      exCtx.textBaseline = 'middle';
      exCtx.shadowColor = 'rgba(0,0,0,.6)';
      exCtx.shadowBlur = 8;
      const lines = clip.text.split('\n');
      lines.forEach((line, i) => {
        exCtx.fillText(line, clip.x * w, clip.y * h + i * clip.size * 1.15 * (w/1280));
      });
      exCtx.restore();
    }
  });
}

function drawCoverTo(c, mediaEl, srcW, srcH, dstW, dstH, opacity){
  if (!srcW || !srcH) return;
  const srcRatio = srcW / srcH, dstRatio = dstW / dstH;
  let sx=0, sy=0, sw=srcW, sh=srcH;
  if (srcRatio > dstRatio) { sw = srcH * dstRatio; sx = (srcW - sw)/2; }
  else { sh = srcW / dstRatio; sy = (srcH - sh)/2; }
  c.save();
  c.globalAlpha = opacity;
  try { c.drawImage(mediaEl, sx, sy, sw, sh, 0, 0, dstW, dstH); } catch(e){}
  c.restore();
}

// ===================== UTIL =====================
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
