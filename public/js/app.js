/**
 * Angelic Py - Main Application
 */
(function() {
  'use strict';

  let reader = null;
  let currentScriptPath = null;
  let currentCharacter = null;

  // UI references
  const els = {
    readerWrap: document.getElementById('reader-wrap'),
    bg: document.getElementById('reader-bg'),
    standLayer: document.getElementById('stand-layer'),
    dialogBox: document.getElementById('dialog-box'),
    speaker: document.getElementById('dialog-speaker'),
    text: document.getElementById('dialog-text'),
    choiceContainer: document.getElementById('choice-container'),
    bottomControls: document.getElementById('bottom-controls'),
    skipBtn: document.getElementById('btn-skip'),
    autoBtn: document.getElementById('btn-auto'),
    logBtn: document.getElementById('btn-log'),
    toggleUiBtn: document.getElementById('btn-toggle-ui'),
    reviewPanel: document.getElementById('review-panel'),
    reviewList: document.getElementById('review-list'),
    reviewClose: document.getElementById('review-close'),
    navPanel: document.getElementById('nav-panel'),
    navList: document.getElementById('nav-list'),
    navToggle: document.getElementById('nav-toggle'),
    mainMenu: document.getElementById('main-menu'),
    mainTitle: document.getElementById('main-title'),
    loadingScreen: document.getElementById('loading-screen'),
  };

  let uiVisible = true;
  // Pagination state
  let gridAllCharacters = [];
  let gridPageSize = 15;
  let gridCurrentPage = 0;
  let gridSearchFilter = '';
  let gridNameMap = {}; // charId -> display name

  function toggleUI() {
    uiVisible = !uiVisible;
    if (uiVisible) {
      els.dialogBox.style.display = els.dialogBox.dataset.prevDisplay || '';
      els.bottomControls.style.display = els.bottomControls.dataset.prevDisplay || '';
      els.navPanel.style.display = els.navPanel.dataset.prevDisplay || '';
      els.reviewPanel.style.display = els.reviewPanel.dataset.prevDisplay || 'none';
      els.toggleUiBtn.style.display = '';
      els.toggleUiBtn.classList.remove('active');
      document.removeEventListener('click', restoreUIFromAnyClick, true);
    } else {
      els.dialogBox.dataset.prevDisplay = els.dialogBox.style.display || '';
      els.bottomControls.dataset.prevDisplay = els.bottomControls.style.display || '';
      els.navPanel.dataset.prevDisplay = els.navPanel.style.display || '';
      els.reviewPanel.dataset.prevDisplay = els.reviewPanel.style.display || '';
      els.dialogBox.style.display = 'none';
      els.bottomControls.style.display = 'none';
      els.navPanel.style.display = 'none';
      els.reviewPanel.style.display = 'none';
      els.toggleUiBtn.style.display = 'none';
      els.toggleUiBtn.classList.add('active');
      document.addEventListener('click', restoreUIFromAnyClick, true);
    }
  }

  function restoreUIFromAnyClick(e) {
    if (!uiVisible) {
      e.stopPropagation();
      toggleUI();
    }
  }

  function hideReaderUI() {
    els.bottomControls.style.display = 'none';
    els.toggleUiBtn.style.display = 'none';
  }

  function showReaderUI() {
    if (uiVisible) {
      els.bottomControls.style.display = '';
    }
    els.dialogBox.style.display = '';
    els.choiceContainer.style.display = '';
    // X toggle button only visible during active scene reading
    els.toggleUiBtn.style.display = '';
    els.toggleUiBtn.classList.remove('active');
  }

  function initReader() {
    if (!reader) {
      reader = new NovelReader({
        container: els.readerWrap,
        dialogEl: els.dialogBox,
        speakerEl: els.speaker,
        textEl: els.text,
        bgEl: els.bg,
        standLayer: els.standLayer,
        choiceContainer: els.choiceContainer,
        skipBtn: els.skipBtn,
        autoBtn: els.autoBtn,
        logBtn: els.logBtn,
      });
    }
    return reader;
  }

  async function loadScriptList() {
    try {
      const resp = await fetch('/api/scripts');
      const data = await resp.json();
      const labelsResp = await fetch('/api/labels');
      const labelsData = await labelsResp.json();
      return { scripts: data.scripts, labels: labelsData.labels };
    } catch (e) {
      console.error('Failed to load script list:', e);
      return { scripts: [], labels: {} };
    }
  }

  async function showMainMenu() {
    currentCharacter = null;
    els.mainMenu.style.display = 'flex';
    els.readerWrap.style.display = 'none';
    els.reviewPanel.style.display = 'none';
    els.navPanel.style.display = 'none';
    els.bottomControls.style.display = 'none';
    els.toggleUiBtn.style.display = 'none';

    const bgNum = Math.floor(Math.random() * 15) + 1;
    els.mainTitle.style.backgroundImage = `url(/bg/BA${String(bgNum).padStart(2, '0')}1.jpg)`;
  }

  els.mainStartAll = document.getElementById('main-start-all');
  els.mainStartAll.addEventListener('click', startGame);

  const charBtn = document.getElementById('main-start-char');
  if (charBtn) charBtn.style.display = 'none';

  async function startGame() {
    els.loadingScreen.style.display = 'flex';

    const resp = await fetch('/api/character-scenes');
    const data = await resp.json();
    const characters = data.characters || [];

    // Load character name map
    try {
      const nameResp = await fetch('/api/character-names');
      const nameData = await nameResp.json();
      gridNameMap = nameData.names || {};
    } catch (e) {
      gridNameMap = {};
    }

    els.mainMenu.style.display = 'none';
    els.loadingScreen.style.display = 'none';
    els.readerWrap.style.display = 'flex';
    els.navPanel.style.display = 'block';
    hideReaderUI();

    gridAllCharacters = characters;
    gridCurrentPage = 0;
    gridSearchFilter = '';
    showCharacterGrid();
  }

  // ===== Character Grid with Pagination & Search =====
  function showCharacterGrid() {
    const gallery = document.getElementById('scene-gallery');
    if (gallery) gallery.remove();

    const wrap = document.createElement('div');
    wrap.id = 'scene-gallery';
    wrap.style.cssText = 'position:absolute;inset:0;z-index:40;overflow-y:auto;background:rgba(0,0,0,0.9);padding:20px;';

    // Header with back button
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:16px;';

    const backBtn = document.createElement('button');
    backBtn.textContent = '← 戻る';
    backBtn.style.cssText = 'padding:8px 20px;background:rgba(255,255,255,0.1);color:#ccc;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;font-size:14px;font-family:inherit;';
    backBtn.addEventListener('click', () => {
      els.readerWrap.style.display = 'none';
      els.mainMenu.style.display = 'flex';
      hideReaderUI();
    });
    header.appendChild(backBtn);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:22px;color:#ddd;letter-spacing:3px;';
    title.textContent = 'All H-scene';
    header.appendChild(title);

    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索角色ID或中文名...';
    searchInput.style.cssText = 'margin-left:auto;padding:8px 14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:14px;font-family:inherit;width:200px;outline:none;';
    searchInput.addEventListener('input', () => {
      gridSearchFilter = searchInput.value.trim().toLowerCase();
      gridCurrentPage = 0;
      renderGridPage(wrap);
    });
    header.appendChild(searchInput);

    wrap.appendChild(header);

    // Grid container
    const gridContainer = document.createElement('div');
    gridContainer.id = 'grid-container';
    wrap.appendChild(gridContainer);

    // Pagination controls
    const pageControls = document.createElement('div');
    pageControls.id = 'page-controls';
    pageControls.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;';
    wrap.appendChild(pageControls);

    els.readerWrap.appendChild(wrap);
    renderGridPage(wrap);
  }

  function renderGridPage(wrap) {
    const filtered = gridAllCharacters.filter(ch => {
      if (!gridSearchFilter) return true;
      const idMatch = ch.id.toLowerCase().includes(gridSearchFilter);
      const nameMatch = gridNameMap[ch.id] && gridNameMap[ch.id].toLowerCase().includes(gridSearchFilter);
      return idMatch || nameMatch;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / gridPageSize));
    if (gridCurrentPage >= totalPages) gridCurrentPage = totalPages - 1;

    const start = gridCurrentPage * gridPageSize;
    const pageItems = filtered.slice(start, start + gridPageSize);

    const gridContainer = wrap.querySelector('#grid-container');
    const pageControls = wrap.querySelector('#page-controls');

    if (!gridContainer) return;

    // Build grid
    gridContainer.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'gallery-grid char-grid';

    for (const ch of pageItems) {
      const card = document.createElement('div');
      card.className = 'gallery-card char-card';

      const thumb = document.createElement('div');
      thumb.className = 'gallery-card-thumb char-grid-thumb';
      const img = document.createElement('img');
      img.src = `/shome/${ch.id}/${ch.id}_gr_it_idle.jpg`;
      img.onerror = function() {
        this.onerror = null;
        this.src = `/stand/${ch.id}/${ch.id.toLowerCase()}_st_s_01.png`;
      };
      thumb.appendChild(img);
      card.appendChild(thumb);

      card.addEventListener('mouseenter', function() {
        img.src = `/shome/${ch.id}/${ch.id}_gr_it_hover.jpg`;
      });
      card.addEventListener('mouseleave', function() {
        img.src = `/shome/${ch.id}/${ch.id}_gr_it_idle.jpg`;
      });

      const name = document.createElement('div');
      name.className = 'gallery-card-name';
      name.textContent = gridNameMap[ch.id] || ch.id;
      card.appendChild(name);

      card.addEventListener('click', function() {
        showCharacterDetail(ch);
      });

      grid.appendChild(card);
    }

    gridContainer.appendChild(grid);

    // Pagination info & controls
    if (pageControls) {
      pageControls.innerHTML = '';
      if (filtered.length === 0) {
        pageControls.textContent = '没有匹配的角色';
        pageControls.style.color = '#888';
        return;
      }

      pageControls.style.cssText = 'position:sticky;bottom:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 0;margin-top:16px;color:#aaa;font-size:14px;background:rgba(0,0,0,0.95);border-top:1px solid rgba(255,255,255,0.08);';

      const prevBtn = document.createElement('button');
      prevBtn.textContent = '◀ 上一页';
      prevBtn.style.cssText = 'padding:6px 16px;background:rgba(255,255,255,0.08);color:' + (gridCurrentPage > 0 ? '#ccc' : '#555') + ';border:1px solid rgba(255,255,255,0.15);border-radius:4px;cursor:' + (gridCurrentPage > 0 ? 'pointer' : 'default') + ';font-size:13px;font-family:inherit;';
      prevBtn.disabled = gridCurrentPage <= 0;
      prevBtn.addEventListener('click', () => {
        if (gridCurrentPage > 0) { gridCurrentPage--; renderGridPage(wrap); }
      });
      pageControls.appendChild(prevBtn);

      const pageInfo = document.createElement('span');
      pageInfo.textContent = `${gridCurrentPage + 1} / ${totalPages} 页 (共 ${filtered.length} 人)`;
      pageControls.appendChild(pageInfo);

      const nextBtn = document.createElement('button');
      nextBtn.textContent = '下一页 ▶';
      nextBtn.style.cssText = 'padding:6px 16px;background:rgba(255,255,255,0.08);color:' + (gridCurrentPage < totalPages - 1 ? '#ccc' : '#555') + ';border:1px solid rgba(255,255,255,0.15);border-radius:4px;cursor:' + (gridCurrentPage < totalPages - 1 ? 'pointer' : 'default') + ';font-size:13px;font-family:inherit;';
      nextBtn.disabled = gridCurrentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => {
        if (gridCurrentPage < totalPages - 1) { gridCurrentPage++; renderGridPage(wrap); }
      });
      pageControls.appendChild(nextBtn);
    }
  }

  // ===== Character Detail =====
  function showCharacterDetail(ch) {
    currentCharacter = ch;
    const gallery = document.getElementById('scene-gallery');
    if (gallery) gallery.remove();

    // Hide reader dialog/controls
    els.dialogBox.classList.remove('visible');
    els.dialogBox.style.display = 'none';
    els.choiceContainer.style.display = 'none';
    els.toggleUiBtn.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.id = 'scene-gallery';
    wrap.className = 'char-detail-screen';

    const bgUrl = `/bg/${ch.bg.toUpperCase()}.jpg`;
    wrap.style.backgroundImage = `url(${bgUrl})`;
    wrap.style.backgroundSize = 'cover';
    wrap.style.backgroundPosition = 'center';

    // Character stands on the left
    const leftStand = document.createElement('div');
    leftStand.className = 'char-detail-stand';
    const charIdLower = ch.id.toLowerCase();
    // Body image (base)
    const bodyImg = document.createElement('img');
    bodyImg.className = 'char-detail-stand-img';
    bodyImg.src = `/stand/${ch.id}/${charIdLower}_st_s_99.png`;
    bodyImg.onerror = function() { this.onerror = null; this.style.display = 'none'; };
    leftStand.appendChild(bodyImg);
    // Expression overlay (current from ch.stands[1] or default 01)
    const currentExpr = ch.stands.length > 1 ? ch.stands[1] : charIdLower + '_st_s_01';
    const exprImg = document.createElement('img');
    exprImg.className = 'char-detail-stand-img overlay';
    exprImg.dataset.expr = currentExpr;
    exprImg.src = `/stand/${ch.id}/${currentExpr}.png`;
    exprImg.onerror = function() { this.onerror = null; this.style.display = 'none'; };
    leftStand.appendChild(exprImg);
    wrap.appendChild(leftStand);

    // ---- Voice panel (slide from left) ----
    const voicePanel = document.createElement('div');
    voicePanel.className = 'char-voice-panel';
    voicePanel.innerHTML = '<div class="char-voice-header">🎤 语音 <span class="char-voice-toggle">▶</span></div><div class="char-voice-body"></div>';
    wrap.appendChild(voicePanel);

    const voiceHeader = voicePanel.querySelector('.char-voice-header');
    const voiceBody = voicePanel.querySelector('.char-voice-body');
    let voiceExpanded = false;

    voiceHeader.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Collapse expression panel if open
      if (exprExpanded && voicePanel !== exprPanel) {
        exprExpanded = false;
        exprPanel.classList.remove('expanded');
        exprHeader.querySelector('.char-voice-toggle').textContent = '▶';
      }
      voiceExpanded = !voiceExpanded;
      voicePanel.classList.toggle('expanded', voiceExpanded);
      voiceHeader.querySelector('.char-voice-toggle').textContent = voiceExpanded ? '▼' : '▶';
      if (voiceExpanded && voiceBody.children.length === 0) {
        loadVoiceList(ch, voiceBody);
      }
    });

    // ---- Expression panel (slide from left) ----
    const exprPanel = document.createElement('div');
    exprPanel.className = 'char-voice-panel char-expr-panel';
    exprPanel.innerHTML = '<div class="char-voice-header">🎭 表情 <span class="char-voice-toggle">▶</span></div><div class="char-voice-body"></div>';
    wrap.appendChild(exprPanel);

    const exprHeader = exprPanel.querySelector('.char-voice-header');
    const exprBody = exprPanel.querySelector('.char-voice-body');
    let exprExpanded = false;

    exprHeader.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Collapse voice panel if open
      if (voiceExpanded) {
        voiceExpanded = false;
        voicePanel.classList.remove('expanded');
        voiceHeader.querySelector('.char-voice-toggle').textContent = '▶';
      }
      exprExpanded = !exprExpanded;
      exprPanel.classList.toggle('expanded', exprExpanded);
      exprHeader.querySelector('.char-voice-toggle').textContent = exprExpanded ? '▼' : '▶';
      if (exprExpanded && exprBody.children.length === 0) {
        loadExprList(ch, exprBody, exprImg);
      }
    });

    // ========== Helper: load voice list ==========
    async function loadVoiceList(ch, body) {
      try {
        const resp = await fetch(`/api/character-voices?charId=${ch.id}`);
        const data = await resp.json();
        if (!data.voices || data.voices.length === 0) {
          body.innerHTML = '<div class="char-voice-empty">无语音文件</div>';
          return;
        }
        body.innerHTML = '';
        data.voices.forEach(vf => {
          const item = document.createElement('div');
          item.className = 'char-voice-item';
          item.textContent = vf.replace(/\.mp3$/i, '');
          item.addEventListener('click', () => toggleVoice(item, ch, vf));
          body.appendChild(item);
        });
      } catch (e) {
        body.innerHTML = '<div class="char-voice-empty">加载失败</div>';
      }
    }

    function toggleVoice(item, ch, vf) {
      const existing = item._voiceAudio;
      if (existing) {
        existing.pause();
        existing.onended = null;
        existing.onerror = null;
        item._voiceAudio = null;
        item.classList.remove('playing');
        return;
      }
      // Stop any other playing voice
      document.querySelectorAll('.char-voice-item.playing').forEach(el => {
        if (el._voiceAudio) {
          el._voiceAudio.pause();
          el._voiceAudio.onended = null;
          el._voiceAudio.onerror = null;
          el._voiceAudio = null;
        }
        el.classList.remove('playing');
      });
      item.classList.add('playing');
      const audio = new Audio(`/ext_voice/${ch.id.toUpperCase()}/${vf}`);
      item._voiceAudio = audio;
      audio.onended = () => {
        item._voiceAudio = null;
        item.classList.remove('playing');
      };
      audio.onerror = () => {
        item._voiceAudio = null;
        item.classList.remove('playing');
      };
      audio.play().catch(() => {
        item._voiceAudio = null;
        item.classList.remove('playing');
      });
    }

    // ========== Helper: load expression list ==========
    async function loadExprList(ch, body, targetImg) {
      try {
        const resp = await fetch(`/api/character-stands?charId=${ch.id}`);
        const data = await resp.json();
        const files = data.stands || [];
        const exprs = files.filter(f => !/_st_s_99\.png$/i.test(f));
        if (exprs.length === 0) {
          body.innerHTML = '<div class="char-voice-empty">无表情文件</div>';
          return;
        }
        body.innerHTML = '';
        const currentExprFile = targetImg.dataset.expr + '.png';
        exprs.forEach(ef => {
          const item = document.createElement('div');
          item.className = 'char-voice-item';
          if (ef === currentExprFile) item.classList.add('playing');
          // Show expression number as label
          const match = ef.match(/_st_s_(\d+)\.png$/i);
          item.textContent = match ? '表情 ' + match[1] : ef.replace(/\.png$/i, '');
          item.addEventListener('click', () => {
            // Update expression overlay
            const exprName = ef.replace(/\.png$/i, '');
            targetImg.src = `/stand/${ch.id}/${exprName}.png`;
            targetImg.dataset.expr = exprName;
            targetImg.style.display = '';
            // Update highlight
            body.querySelectorAll('.char-voice-item.playing').forEach(el => el.classList.remove('playing'));
            item.classList.add('playing');
          });
          body.appendChild(item);
        });
      } catch (e) {
        body.innerHTML = '<div class="char-voice-empty">加载失败</div>';
      }
    }

    // Scene thumbnails on the right
    const rightPanel = document.createElement('div');
    rightPanel.className = 'char-detail-scenes';

    const title = document.createElement('div');
    title.className = 'char-detail-title';
    title.textContent = ch.id;
    rightPanel.appendChild(title);

    const sceneGrid = document.createElement('div');
    sceneGrid.className = 'char-detail-grid';

    for (const scene of ch.scenes) {
      const btn = document.createElement('div');
      btn.className = 'detail-scene-btn';

      const btnImg = document.createElement('img');
      btnImg.src = `/thumbnail/${scene.thumb}_idle.jpg`;
      btnImg.onerror = function() {
        this.onerror = null;
        this.src = `/stand/${ch.id}/${ch.id.toLowerCase()}_st_s_01.png`;
      };
      btnImg.className = 'detail-scene-thumb';
      btn.appendChild(btnImg);

      btn.addEventListener('mouseenter', function() {
        btnImg.src = `/thumbnail/${scene.thumb}_hover.jpg`;
      });
      btn.addEventListener('mouseleave', function() {
        btnImg.src = `/thumbnail/${scene.thumb}_idle.jpg`;
      });

      btn.addEventListener('click', async function() {
        const scriptPath = `hscene/${scene.label.substring(1)}.rpy`;
        document.getElementById('scene-gallery')?.remove();
        initReader();
        showReaderUI();
        await reader.loadScript(scriptPath, scene.label);
      });

      sceneGrid.appendChild(btn);
    }

    rightPanel.appendChild(sceneGrid);

    const backBtn = document.createElement('button');
    backBtn.className = 'detail-back-btn';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      currentCharacter = null;
      fetch('/api/character-scenes').then(r => r.json()).then(data => {
        gridAllCharacters = data.characters || [];
        showCharacterGrid();
      });
    });
    rightPanel.appendChild(backBtn);

    wrap.appendChild(rightPanel);
    els.readerWrap.appendChild(wrap);
  }

  // ===== Navigation Tree =====
  async function buildNavTree() {
    const { scripts, labels } = await loadScriptList();
    els.navList.innerHTML = '';

    const groups = {};
    for (const script of scripts) {
      const dir = script.includes('/') ? script.substring(0, script.lastIndexOf('/')) : '(root)';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(script);
    }

    for (const [dir, dirScripts] of Object.entries(groups)) {
      const header = document.createElement('div');
      header.className = 'nav-group-header';
      header.textContent = dir;
      els.navList.appendChild(header);

      for (const script of dirScripts) {
        const btn = document.createElement('button');
        btn.className = 'nav-script-btn';
        btn.textContent = script.replace(/\.rpy$/, '');
        btn.addEventListener('click', async () => {
          currentScriptPath = script;
          els.readerWrap.style.display = 'flex';
          if (reader) {
            await reader.loadScript(script);
          }
        });
        els.navList.appendChild(btn);
      }
    }

    const labelHeader = document.createElement('div');
    labelHeader.className = 'nav-group-header';
    labelHeader.textContent = '场景标签';
    els.navList.appendChild(labelHeader);

    const importantLabels = ['vpgrid_test', 'vpgrid_test_byname', 'start', 'splashscreen'];
    for (const lbl of importantLabels) {
      if (labels[lbl]) {
        const btn = document.createElement('button');
        btn.className = 'nav-script-btn';
        btn.textContent = '▶ ' + lbl;
        btn.addEventListener('click', async () => {
          currentScriptPath = labels[lbl];
          els.readerWrap.style.display = 'flex';
          if (reader) {
            await reader.loadScript(labels[lbl], lbl);
          }
        });
        els.navList.appendChild(btn);
      }
    }
  }

  // ===== Event Bindings =====

  document.addEventListener('scene-ended', () => {
    hideReaderUI();
    els.dialogBox.classList.remove('visible');
    if (reader) {
      reader._stopVoice();
    }
    if (currentCharacter) {
      showCharacterDetail(currentCharacter);
    } else {
      const gallery = document.getElementById('scene-gallery');
      if (gallery) gallery.remove();
      fetch('/api/character-scenes').then(r => r.json()).then(data => {
        gridAllCharacters = data.characters || [];
        showCharacterGrid();
      });
    }
  });

  els.navToggle.addEventListener('click', () => {
    els.navPanel.classList.toggle('collapsed');
  });

  els.backBtn = document.getElementById('btn-back');
  els.backBtn.addEventListener('click', () => {
    if (reader) {
      if (reader._skipMode) reader._stopSkip();
      if (reader.autoMode) reader._stopAuto();
      reader.isRunning = false;
      reader._stopBGM();
      reader._clearScene();
      reader = null;
    }
    const oldCanvas = document.getElementById('l2d-canvas');
    if (oldCanvas) oldCanvas.remove();
    const dialogBox = document.getElementById('dialog-box');
    if (dialogBox) dialogBox.classList.remove('visible');
    const gallery = document.getElementById('scene-gallery');
    if (gallery) gallery.remove();

    if (currentCharacter) {
      els.readerWrap.style.display = 'flex';
      hideReaderUI();
      showCharacterDetail(currentCharacter);
    } else {
      els.readerWrap.style.display = 'none';
      els.mainMenu.style.display = 'flex';
      hideReaderUI();
    }
  });

  els.toggleUiBtn.addEventListener('click', toggleUI);

  els.autoBtn.addEventListener('click', () => {
    if (reader) reader.toggleAuto();
  });

  els.skipBtn.addEventListener('click', () => {
    if (!reader) return;
    if (reader._skipMode) {
      reader._stopSkip();
    } else {
      reader.startSkip();
    }
  });

  els.logBtn.addEventListener('click', () => {
    if (reader) {
      renderReviewPanel();
      els.reviewPanel.style.display = 'flex';
    }
  });

  els.reviewClose.addEventListener('click', () => {
    els.reviewPanel.style.display = 'none';
  });

  // Language dropdown (start page)
  const langSelect = document.getElementById('lang-select');
  langSelect.value = localStorage.getItem('reader-lang') || '';
  langSelect.addEventListener('change', () => {
    const val = langSelect.value;
    if (val) {
      localStorage.setItem('reader-lang', val);
    } else {
      localStorage.removeItem('reader-lang');
    }
    // Reload current script if reading
    if (reader && reader.isRunning && reader.currentScriptPath) {
      const sp = reader.currentScriptPath;
      reader.loadScript(sp);
    }
  });

  document.addEventListener('history-update', () => {
    if (els.reviewPanel.style.display === 'flex') {
      renderReviewPanel();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      if (!uiVisible) {
        e.preventDefault();
        toggleUI();
      } else if (!els.dialogBox.classList.contains('visible')) {
        e.preventDefault();
        toggleUI();
      }
    }
  });

  function renderReviewPanel() {
    if (!reader) return;
    const history = reader.getHistory();
    els.reviewList.innerHTML = '';

    const reversed = history.slice().reverse();
    for (const entry of reversed) {
      const item = document.createElement('div');
      item.className = 'review-item';

      const headDiv = document.createElement('div');
      headDiv.className = 'review-item-head';
      headDiv.title = '点击跳转到此对话';

      const iconDiv = document.createElement('span');
      iconDiv.className = 'review-item-headicon';
      iconDiv.textContent = entry.speaker.charAt(0);
      headDiv.appendChild(iconDiv);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'review-item-name';
      nameSpan.textContent = entry.speaker;
      headDiv.appendChild(nameSpan);

      if (entry.voice) {
        const voiceBtn = document.createElement('span');
        voiceBtn.className = 'review-item-voice';
        voiceBtn.textContent = '♪';
        voiceBtn.title = '重播语音';
        voiceBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const audio = new Audio('/' + entry.voice.replace(/\\/g, '/'));
          audio.play().catch(() => {});
        });
        headDiv.appendChild(voiceBtn);
      }

      headDiv.addEventListener('click', () => {
        if (confirm('跳转到此对话？')) {
          els.reviewPanel.style.display = 'none';
          reader.jumpToLine(entry.lineIdx);
        }
      });

      const textDiv = document.createElement('div');
      textDiv.className = 'review-item-text';
      textDiv.textContent = entry.text;

      item.appendChild(headDiv);
      item.appendChild(textDiv);
      els.reviewList.appendChild(item);
    }
  }

  // ===== Boot =====
  showMainMenu();
  buildNavTree();
})();
