/**
 * app.js — OpenYardage main application entry point
 * Updated for Pickr transparency support and high-contrast "PuttView" aesthetics.
 */

import { initMap } from './map.js';
import { generateBook, reRenderHole } from './generator.js';
import { assemblePdf, assemblePrintPdf } from './pdf.js';

export const AppState = {
  currentStep: 1,
  bbox: null,
  courseName: '',
  colors: {
    fairway:  'rgba(222, 242, 195, 1)',
    teeBox:   'rgba(199, 209, 151, 1)',
    green:    'rgba(178, 231, 114, 1)',
    rough:    'rgba(0, 0, 0, 0)',
    water:    'rgba(151, 217, 215, 1)',
    sand:     'rgba(251, 230, 191, 1)',
    trees:    'rgba(120, 153, 94, 1)',
    text:     'rgba(0, 0, 0, 1)',
    topo:     'rgba(139, 94, 60, 1)',
  },
  options: {
    includeTrees: true, textBackground: false, inMeters: false,
    includeTopo: false, topoInterval: 2.0, topoLabels: true,
    holeWidth: 50, shortFilter: 1.0, drawAllFeatures: false, textSizeMult: 1.0,
  },
  generation: {
    isRunning: false, progress: 0, statusMessage: '', pdfUrl: null, error: null, renderedHoles: [], osmData: null,
  },
};

const dom = {
  step1: document.getElementById('step-1'), step2: document.getElementById('step-2'), step3: document.getElementById('step-3'),
  stepNav1: document.getElementById('step-nav-1'), stepNav2: document.getElementById('step-nav-2'), stepNav3: document.getElementById('step-nav-3'),
  bboxInfo: document.getElementById('bbox-info'), btnToStep2: document.getElementById('btn-to-step2'), mapHint: document.getElementById('map-hint'),
  colorPreset: document.getElementById('color-preset'),
  optTrees: document.getElementById('opt-trees'), optTextBg: document.getElementById('opt-text-bg'), optYards: document.getElementById('opt-yards'),
  optMeters: document.getElementById('opt-meters'), optHoleWidth: document.getElementById('opt-hole-width'), holeWidthVal: document.getElementById('hole-width-val'),
  optDrawAll: document.getElementById('opt-draw-all'), courseNameInput: document.getElementById('course-name-input'), bboxSummary: document.getElementById('bbox-summary'),
  btnBackToStep1: document.getElementById('btn-back-to-step1'), btnToStep3: document.getElementById('btn-to-step3'),
  progressFill: document.getElementById('progress-fill'), progressStatus: document.getElementById('progress-status'), progressPct: document.getElementById('progress-pct'),
  genCourseName: document.getElementById('gen-course-name'), generationStatus: document.getElementById('generation-status'), step3Footer: document.getElementById('step3-footer'),
  btnExport: document.getElementById('btn-export'), exportModal: document.getElementById('export-modal'), btnExportClose: document.getElementById('btn-export-close'),
  aboutModal: document.getElementById('about-modal'), btnAbout: document.querySelector('.header-about-link'), btnAboutClose: document.getElementById('btn-about-close'),
  btnViewBook: document.getElementById('btn-view-book'), btnDownloadPdf: document.getElementById('btn-download-pdf'), btnDownloadPrintPdf: document.getElementById('btn-download-print-pdf'),
  btnDownloadZip: document.getElementById('btn-download-zip'), viewerOverlay: document.getElementById('viewer-overlay'), viewerStage: document.getElementById('viewer-stage'),
  viewerTitle: document.getElementById('viewer-title'), viewerPageIndicator: document.getElementById('viewer-page-indicator'), btnViewerClose: document.getElementById('btn-viewer-close'),
  btnViewerPrev: document.getElementById('btn-viewer-prev'), btnViewerNext: document.getElementById('btn-viewer-next'), holeBrowser: document.getElementById('hole-browser'),
  holeBrowserTitle: document.getElementById('hole-browser-title'), holeSelect: document.getElementById('hole-select'), btnHolePrev: document.getElementById('btn-hole-prev'),
  btnHoleNext: document.getElementById('btn-hole-next'), btnHoleDelete: document.getElementById('btn-hole-delete'), holeDisplayCanvas: document.getElementById('hole-display-canvas'),
  greenDisplayCanvas: document.getElementById('green-display-canvas'), regenHoleWidth: document.getElementById('regen-hole-width'), regenWidthVal: document.getElementById('regen-width-val'),
  regenShortFilter: document.getElementById('regen-short-filter'), regenFilterVal: document.getElementById('regen-filter-val'), regenDrawAll: document.getElementById('regen-draw-all'),
  btnRegenHole: document.getElementById('btn-regen-hole'), regenStatus: document.getElementById('regen-status'), btnRegenToggle: document.getElementById('btn-regen-toggle'),
  holeBrowserRight: document.querySelector('.hole-browser-right'), holeOsmName: document.getElementById('hole-osm-name'), errorState: document.getElementById('error-state'),
  errorMessage: document.getElementById('error-message'), btnRetry: document.getElementById('btn-retry'), btnBackToStep2: document.getElementById('btn-back-to-step2'),
  btnStartOver: document.getElementById('btn-start-over'), optTextSize: document.getElementById('opt-text-size'), textSizeVal: document.getElementById('text-size-val'),
  btnDownloadSvg: document.getElementById('btn-download-svg'),
};

const COLOR_CONFIG = [
  { el: 'color-fairway', key: 'fairway' }, { el: 'color-teebox', key: 'teeBox' },
  { el: 'color-green', key: 'green' }, { el: 'color-rough', key: 'rough' },
  { el: 'color-water', key: 'water' }, { el: 'color-sand', key: 'sand' },
  { el: 'color-trees', key: 'trees' }, { el: 'color-text', key: 'text' }
];

// Define your preset color maps
const PRESETS = {
  tour: { // The transparent style
    fairway:  'rgba(235, 235, 235, 0.8)',
    teeBox:   'rgba(195, 195, 195, 0.8)',
    green:    'rgba(255, 255, 255, 1)',
    rough:    'rgba(255, 255, 255, 0)',
    water:    'rgba(180, 180, 180, 0.7)',
    sand:     'rgba(210, 210, 210, 0.8)',
    trees:    'rgba(180, 180, 180, 0.7)',
    text:     'rgba(0, 0, 0, 1)',
  },
  default: { // Puttview Style
    fairway:  'rgba(222, 242, 195, 1)',
    teeBox:   'rgba(199, 209, 151, 1)',
    green:    'rgba(178, 231, 114, 1)',
    rough:    'rgba(0, 0, 0, 0)',
    water:    'rgba(151, 217, 215, 1)',
    sand:     'rgba(251, 230, 191, 1)',
    trees:    'rgba(120, 153, 94, 1)',
    text:     'rgba(0, 0, 0, 1)',
  },
  bw: { // The classic Black & White outline style
    fairway:  'rgba(255, 255, 255, 1)',
    teeBox:   'rgba(240, 240, 240, 1)',
    green:    'rgba(240, 240, 240, 1)',
    rough:    'rgba(255, 255, 255, 1)',
    water:    'rgba(200, 200, 200, 1)',
    sand:     'rgba(220, 220, 220, 1)',
    trees:    'rgba(150, 150, 150, 1)',
    text:     'rgba(0, 0, 0, 1)',
  },
  original: { // The original bright green solid style
    fairway:  'rgba(52, 232, 132, 1)',
    teeBox:   'rgba(90, 252, 163, 1)',
    green:    'rgba(90, 252, 163, 1)',
    rough:    'rgba(24, 187, 62, 1)',
    water:    'rgba(21, 188, 241, 1)',
    sand:     'rgba(255, 212, 53, 1)',
    trees:    'rgba(23, 130, 0, 1)',
    text:     'rgba(0, 0, 0, 1)',
  }
};

// Store the Pickr instances so we can update them when a preset is selected
const pickrInstances = {};

function bindColorInputs() {
  if (typeof Pickr === 'undefined') {
    console.error('Pickr library failed to load. Please check your index.html script tags.');
    return; 
  }

  COLOR_CONFIG.forEach(({ el, key }) => {
    const targetEl = document.getElementById(el);
    if (!targetEl) return;

    const pickr = Pickr.create({
      el: targetEl,
      theme: 'classic',
      default: AppState.colors[key],
      components: {
        preview: true,
        opacity: true,
        hue: true,
        interaction: { input: true, save: true }
      }
    });

    // Save the instance to our tracker
    pickrInstances[key] = pickr;

    pickr.on('change', (color) => {
      const rgbaStr = color.toRGBA().toString(3);
      AppState.colors[key] = rgbaStr;
      
      const hexLabel = document.getElementById(`hex-${key.toLowerCase()}`);
      if (hexLabel) hexLabel.textContent = rgbaStr;
      if (dom.colorPreset) dom.colorPreset.value = 'custom';
    }).on('save', (color, instance) => {
      instance.hide();
    });
  });

  // Handle Preset Dropdown Changes
  if (dom.colorPreset) {
    dom.colorPreset.addEventListener('change', (e) => {
      const selectedPreset = e.target.value;
      
      // If "custom" is selected directly, do nothing until they use a picker
      if (selectedPreset === 'custom' || !PRESETS[selectedPreset]) return;

      const colors = PRESETS[selectedPreset];
      
      Object.keys(colors).forEach(key => {
        const rgbaStr = colors[key];
        
        // 1. Update AppState
        AppState.colors[key] = rgbaStr;
        
        // 2. Update Pickr UI (this does not trigger the 'change' event above)
        if (pickrInstances[key]) {
          pickrInstances[key].setColor(rgbaStr);
        }
        
        // 3. Update the text label
        const hexLabel = document.getElementById(`hex-${key.toLowerCase()}`);
        if (hexLabel) hexLabel.textContent = rgbaStr;
      });
    });
  }
}

function showStep(n) {
  AppState.currentStep = n;
  [dom.step1, dom.step2, dom.step3].forEach((panel, i) => { const stepNum = i + 1; if (stepNum === n) { panel.removeAttribute('hidden'); panel.classList.add('active'); } else { panel.setAttribute('hidden', ''); panel.classList.remove('active'); }});
  [dom.stepNav1, dom.stepNav2, dom.stepNav3].forEach((el, i) => { const stepNum = i + 1; el.classList.toggle('active', stepNum === n); el.classList.toggle('completed', stepNum < n); });
  if (n === 2) populateStep2Summary();
  if (n === 3) startGeneration();
}

function handleBboxChange(bbox, courseName) {
  AppState.bbox = bbox; AppState.courseName = courseName || ''; AppState.generation.osmData = null; delete dom.courseNameInput.dataset.userEdited;
  if (bbox) { dom.mapHint.classList.add('hidden'); dom.bboxInfo.innerHTML = `<span class="bbox-label">Selected: </span><span class="bbox-coords">${bbox.latmin.toFixed(4)}, ${bbox.lonmin.toFixed(4)}&nbsp;→&nbsp;${bbox.latmax.toFixed(4)}, ${bbox.lonmax.toFixed(4)}</span>`; dom.btnToStep2.disabled = false; } 
  else { dom.bboxInfo.innerHTML = '<span class="bbox-label">No area selected</span>'; dom.btnToStep2.disabled = true; dom.mapHint.classList.remove('hidden'); }
}

function bindOptionInputs() {
  if (dom.optTrees) dom.optTrees.addEventListener('change', () => { AppState.options.includeTrees = dom.optTrees.checked; });
  if (dom.optTextBg) dom.optTextBg.addEventListener('change', () => { AppState.options.textBackground = dom.optTextBg.checked; });
  if (dom.optYards) dom.optYards.addEventListener('change', () => { AppState.options.inMeters = false; });
  if (dom.optMeters) dom.optMeters.addEventListener('change', () => { AppState.options.inMeters = true; });
  if (dom.optHoleWidth) dom.optHoleWidth.addEventListener('input', () => { const val = parseInt(dom.optHoleWidth.value, 10); AppState.options.holeWidth = val; dom.holeWidthVal.textContent = `${val} yds`; });
  if (dom.optDrawAll) dom.optDrawAll.addEventListener('change', () => { AppState.options.drawAllFeatures = dom.optDrawAll.checked; });
  if (dom.optTextSize) { dom.optTextSize.addEventListener('input', () => { const val = parseFloat(dom.optTextSize.value); AppState.options.textSizeMult = val; if (dom.textSizeVal) dom.textSizeVal.textContent = `${val.toFixed(1)}x`; }); }
  if (dom.courseNameInput) dom.courseNameInput.addEventListener('input', () => { AppState.courseName = dom.courseNameInput.value; dom.courseNameInput.dataset.userEdited = '1'; });
  if (dom.regenHoleWidth) dom.regenHoleWidth.addEventListener('input', () => { dom.regenWidthVal.textContent = `${dom.regenHoleWidth.value} yds`; });
  if (dom.regenShortFilter) dom.regenShortFilter.addEventListener('input', () => { dom.regenFilterVal.textContent = `${parseFloat(dom.regenShortFilter.value).toFixed(1)}×`; });
}

function populateStep2Summary() {
  if (dom.courseNameInput && !dom.courseNameInput.dataset.userEdited) dom.courseNameInput.value = AppState.courseName || '';
  if (dom.bboxSummary && AppState.bbox) dom.bboxSummary.textContent = `${AppState.bbox.latmin.toFixed(4)}°N, ${AppState.bbox.lonmin.toFixed(4)}°W  →  ${AppState.bbox.latmax.toFixed(4)}°N, ${AppState.bbox.lonmax.toFixed(4)}°W`;
}

function startGeneration() {
  const cachedOsmData = AppState.generation.osmData;
  dom.holeBrowser.setAttribute('hidden', '');
  dom.step3Footer.setAttribute('hidden', '');
  dom.generationStatus.removeAttribute('hidden');
  dom.errorState.setAttribute('hidden', '');
  dom.genCourseName.textContent = AppState.courseName || 'Yardage Book';
  setProgress(0, 'Starting…');
  AppState.generation.isRunning = true;
  AppState.generation.error = null;
  AppState.generation.pdfUrl = null;
  AppState.generation.renderedHoles = [];
  AppState.generation.osmData = null;
  generateBook({ bbox: AppState.bbox, courseName: AppState.courseName, colors: AppState.colors, options: AppState.options, cachedOsmData, onProgress: handleProgress, onHoleStatus: handleHoleStatus, onDone: handleGenerationDone, onError: handleGenerationError });
}

export function handleProgress({ pct, message }) { setProgress(pct, message); }
export function handleHoleStatus(_event) {}
export function handleGenerationDone({ holeCount, renderedHoles, osmData }) {
  AppState.generation.isRunning = false;
  AppState.generation.renderedHoles = renderedHoles;
  AppState.generation.osmData = osmData;
  dom.generationStatus.setAttribute('hidden', '');
  showHoleBrowser();
  dom.step3Footer.removeAttribute('hidden');
}

export function handleGenerationError({ message }) {
  AppState.generation.isRunning = false;
  AppState.generation.error = message;
  dom.errorMessage.innerHTML = message;
  dom.errorState.removeAttribute('hidden');
}

function setProgress(pct, message) {
  AppState.generation.progress = pct;
  AppState.generation.statusMessage = message;
  dom.progressFill.style.width = `${pct}%`;
  dom.progressFill.closest('[role=progressbar]').setAttribute('aria-valuenow', pct);
  dom.progressStatus.textContent = message;
  dom.progressPct.textContent = `${Math.round(pct)}%`;
}

let currentHoleIndex = 0;
function showHoleBrowser() {
  const holes = AppState.generation.renderedHoles;
  dom.holeBrowserTitle.textContent = AppState.courseName || 'Yardage Book';
  dom.holeSelect.innerHTML = holes.map((h, i) => `<option value="${i}">Hole ${h.holeNum}${h.par ? ` — Par ${h.par}` : ''}</option>`).join('');
  
  if (dom.regenHoleWidth) {
      dom.regenHoleWidth.value  = AppState.options.holeWidth;
      dom.regenWidthVal.textContent = `${AppState.options.holeWidth} yds`;
      dom.regenShortFilter.value = AppState.options.shortFilter;
      dom.regenFilterVal.textContent = `${AppState.options.shortFilter.toFixed(1)}×`;
      dom.regenDrawAll.checked = AppState.options.drawAllFeatures;
  }
  dom.holeBrowser.removeAttribute('hidden');
  displayHole(0);
}

function displayHole(index) {
  const holes = AppState.generation.renderedHoles;
  currentHoleIndex = index;
  dom.holeSelect.value = String(index);
  drawToDisplayCanvas(holes[index].holeImageUrl,  dom.holeDisplayCanvas);
  drawToDisplayCanvas(holes[index].greenImageUrl, dom.greenDisplayCanvas);
  
  const osmName = holes[index].holeWay?.tags?.name;
  if (osmName) {
    dom.holeOsmName.textContent = osmName;
    dom.holeOsmName.removeAttribute('hidden');
  } else {
    dom.holeOsmName.setAttribute('hidden', '');
  }
  dom.btnHolePrev.disabled = index === 0;
  dom.btnHoleNext.disabled = index === holes.length - 1;
}

function deleteCurrentHole() {
  const holes = AppState.generation.renderedHoles;
  if (holes.length <= 1) { alert('Cannot delete the last hole.'); return; }
  holes.splice(currentHoleIndex, 1);
  dom.holeSelect.innerHTML = holes.map((h, i) => `<option value="${i}">Hole ${h.holeNum}${h.par ? ` — Par ${h.par}` : ''}</option>`).join('');
  displayHole(Math.min(currentHoleIndex, holes.length - 1));
}

function regenCurrentHole() {}

function drawToDisplayCanvas(src, dest) {
  if (typeof src === 'string') {
    const img = new Image();
    img.onload = () => { dest.width  = img.naturalWidth; dest.height = img.naturalHeight; dest.getContext('2d').drawImage(img, 0, 0); };
    img.src = src;
    return;
  }
  dest.width = src.width; dest.height = src.height;
  dest.getContext('2d').drawImage(src, 0, 0);
}

function openExportModal() { dom.exportModal.removeAttribute('hidden'); }
function closeExportModal() { dom.exportModal.setAttribute('hidden', ''); }
function openAboutModal() { dom.aboutModal.removeAttribute('hidden'); }
function closeAboutModal() { dom.aboutModal.setAttribute('hidden', ''); }

let viewerPageIndex = 0;
let viewerPages = [];
function openViewer() {
  const holes = AppState.generation.renderedHoles;
  if (!holes || holes.length === 0) return;
  const sorted = [...holes].sort((a, b) => a.holeNum - b.holeNum), stage = dom.viewerStage;
  stage.innerHTML = ''; viewerPages = [];
  const cover = document.createElement('div');
  cover.className = 'viewer-page viewer-page-cover';
  cover.innerHTML = `<div class="viewer-cover-name">${escapeHtml(AppState.courseName || 'Golf Course')}</div><div class="viewer-cover-sub">Yardage Book</div><div class="viewer-cover-credit">Generated by OpenYardage<br>Map data \u00A9 OpenStreetMap contributors</div>`;
  stage.appendChild(cover); viewerPages.push(cover);
  
  for (const hole of sorted) {
    const page = document.createElement('div');
    page.className = 'viewer-page';
    const roughColor = AppState.colors.rough || 'rgba(255,255,255,0)';
    page.innerHTML = `<div class="viewer-left"><div class="viewer-hole-num">Hole ${hole.holeNum}</div>${hole.par ? `<div class="viewer-par">Par ${hole.par}</div>` : ''}<div class="viewer-notes-label">Notes</div><div class="viewer-green-wrap"><img src="${hole.greenImageUrl}" alt="Green detail — Hole ${hole.holeNum}" /></div></div><div class="viewer-right" style="background: ${roughColor}"><img src="${hole.holeImageUrl}" alt="Hole ${hole.holeNum}" /></div>`;
    stage.appendChild(page); viewerPages.push(page);
  }
  dom.viewerTitle.textContent = AppState.courseName || 'Yardage Book';
  viewerPageIndex = 0;
  updateViewerPage();
  dom.viewerOverlay.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

function closeViewer() { dom.viewerOverlay.setAttribute('hidden', ''); document.body.style.overflow = ''; }
function updateViewerPage() {
  viewerPages.forEach((p, i) => p.classList.toggle('active', i === viewerPageIndex));
  dom.btnViewerPrev.disabled = viewerPageIndex === 0;
  dom.btnViewerNext.disabled = viewerPageIndex === viewerPages.length - 1;
  dom.viewerPageIndicator.textContent = viewerPageIndex === 0 ? 'Cover' : `${viewerPageIndex} of ${viewerPages.length - 1}`;
}

function viewerPrev() { if (viewerPageIndex > 0) { viewerPageIndex--; updateViewerPage(); } }
function viewerNext() { if (viewerPageIndex < viewerPages.length - 1) { viewerPageIndex++; updateViewerPage(); } }
function escapeHtml(str) { const el = document.createElement('span'); el.textContent = str; return el.innerHTML; }
function initViewerSwipe() {
  let startX = 0, startY = 0;
  dom.viewerStage.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
  dom.viewerStage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) viewerNext(); else viewerPrev(); }
  }, { passive: true });
}

function safeFilename(base) { return (base || 'yardage-book').replace(/[^a-z0-9]/gi, '-').toLowerCase(); }
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

async function generateAndDownloadPdf() {
  const btn = dom.btnDownloadPdf; const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '⌛ Building Vector PDF…';
  try {
    const pdfBlob = await assemblePdf({ holes: AppState.generation.renderedHoles, courseName: AppState.courseName, colors: AppState.colors });
    triggerBlobDownload(pdfBlob, `${safeFilename(AppState.courseName)}.pdf`);
  } catch (err) {
    console.error('PDF generation failed:', err); alert('PDF generation failed: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = origText; }
}

async function generateAndDownloadPrintPdf() {
  const btn = dom.btnDownloadPrintPdf; const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '⌛ Building Vector PDF…';
  try {
    const pdfBlob = await assemblePrintPdf({ holes: AppState.generation.renderedHoles, courseName: AppState.courseName, colors: AppState.colors });
    triggerBlobDownload(pdfBlob, `${safeFilename(AppState.courseName)}-print.pdf`);
  } catch (err) {
    console.error('Print PDF generation failed:', err); alert('Print PDF generation failed: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = origText; }
}

async function downloadZip() {
  const btn = dom.btnDownloadZip; const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '⌛ Preparing ZIP…';
  try {
    const zip = new window.JSZip(); const folder = zip.folder('yardage-book');
    for (const hole of AppState.generation.renderedHoles) {
      const num = String(hole.holeNum).padStart(2, '0');
      folder.file(`hole-${num}.svg`, hole.holeSvg);
      folder.file(`hole-${num}-green.svg`, hole.greenSvg);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(blob, `${safeFilename(AppState.courseName)}-svg-images.zip`);
  } catch (err) {
    console.error('ZIP generation failed:', err); alert('ZIP generation failed: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = origText; }
}

async function downloadCurrentHoleSvg() {
  if (!dom.btnDownloadSvg) return;
  const index = currentHoleIndex; const hole = AppState.generation.renderedHoles[index];
  const blob = new Blob([hole.holeSvg], { type: 'image/svg+xml;charset=utf-8' });
  triggerBlobDownload(blob, `hole-${String(hole.holeNum).padStart(2, '0')}.svg`);
}

function bindNavButtons() {
  dom.btnToStep2.addEventListener('click', () => { if (AppState.bbox) showStep(2); });
  dom.btnBackToStep1.addEventListener('click', () => showStep(1));
  dom.btnToStep3.addEventListener('click', () => showStep(3));
  dom.btnBackToStep2.addEventListener('click', () => { if (AppState.generation.isRunning) return; showStep(2); });
  dom.btnRetry.addEventListener('click', () => { dom.errorState.setAttribute('hidden', ''); startGeneration(); });
  dom.btnStartOver.addEventListener('click', () => { AppState.generation.pdfUrl = null; showStep(1); });
  
  if(dom.btnHolePrev) dom.btnHolePrev.addEventListener('click', () => { if (currentHoleIndex > 0) displayHole(currentHoleIndex - 1); });
  if(dom.btnHoleNext) dom.btnHoleNext.addEventListener('click', () => { const max = AppState.generation.renderedHoles.length - 1; if (currentHoleIndex < max) displayHole(currentHoleIndex + 1); });
  if(dom.holeSelect) dom.holeSelect.addEventListener('change', () => { displayHole(parseInt(dom.holeSelect.value, 10)); });
  if(dom.btnHoleDelete) dom.btnHoleDelete.addEventListener('click', deleteCurrentHole);
  if(dom.btnRegenHole) dom.btnRegenHole.addEventListener('click', regenCurrentHole);
  
  if(dom.btnRegenToggle) dom.btnRegenToggle.addEventListener('click', () => {
    const isOpen = dom.holeBrowserRight.classList.toggle('regen-open');
    dom.btnRegenToggle.textContent = isOpen ? 'Close ▴' : 'Edit ▾';
    dom.btnRegenToggle.setAttribute('aria-expanded', isOpen);
  });
  
  if(dom.btnAbout) dom.btnAbout.addEventListener('click', e => { e.preventDefault(); openAboutModal(); });
  if(dom.btnAboutClose) dom.btnAboutClose.addEventListener('click', closeAboutModal);
  if(dom.aboutModal) dom.aboutModal.addEventListener('click', e => { if (e.target === dom.aboutModal) closeAboutModal(); });
  
  if(dom.btnExport) dom.btnExport.addEventListener('click', openExportModal);
  if(dom.btnExportClose) dom.btnExportClose.addEventListener('click', closeExportModal);
  if(dom.exportModal) dom.exportModal.addEventListener('click', e => { if (e.target === dom.exportModal) closeExportModal(); });
  
  if(dom.btnDownloadPdf) dom.btnDownloadPdf.addEventListener('click', () => { closeExportModal(); generateAndDownloadPdf(); });
  if(dom.btnDownloadPrintPdf) dom.btnDownloadPrintPdf.addEventListener('click', () => { closeExportModal(); generateAndDownloadPrintPdf(); });
  if(dom.btnDownloadZip) dom.btnDownloadZip.addEventListener('click', () => { closeExportModal(); downloadZip(); });
  if(dom.btnDownloadSvg) dom.btnDownloadSvg.addEventListener('click', () => { closeExportModal(); downloadCurrentHoleSvg(); });
  
  if(dom.btnViewBook) dom.btnViewBook.addEventListener('click', openViewer);
  if(dom.btnViewerClose) dom.btnViewerClose.addEventListener('click', closeViewer);
  if(dom.btnViewerPrev) dom.btnViewerPrev.addEventListener('click', viewerPrev);
  if(dom.btnViewerNext) dom.btnViewerNext.addEventListener('click', viewerNext);
  
  document.addEventListener('keydown', (e) => {
    if (dom.viewerOverlay && dom.viewerOverlay.hidden) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') viewerPrev();
    else if (e.key === 'ArrowRight') viewerNext();
  });
  
  initViewerSwipe();
  
  dom.stepNav1.addEventListener('click', () => { if (dom.stepNav1.classList.contains('completed')) showStep(1); });
  dom.stepNav2.addEventListener('click', () => { if (dom.stepNav2.classList.contains('completed')) showStep(2); });
}

function init() {
  initMap({ containerId: 'map', onBboxChange: handleBboxChange });
  bindColorInputs();
  bindOptionInputs();
  bindNavButtons();
}

init();