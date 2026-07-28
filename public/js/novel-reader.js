/**
 * Angelic Py - Novel Reader Engine
 * Handles instruction execution, asset loading, and state management.
 */
class NovelReader {
  constructor(options) {
    this.container = options.container;       // Main display area
    this.dialogEl = options.dialogEl;         // Dialog box element
    this.speakerEl = options.speakerEl;       // Speaker name element
    this.textEl = options.textEl;             // Dialogue text element
    this.bgEl = options.bgEl;                 // Background image element
    this.standLayer = options.standLayer;     // Stand character container
    this.choiceContainer = options.choiceContainer; // Choice buttons container
    this.skipBtn = options.skipBtn;
    this.autoBtn = options.autoBtn;
    this.logBtn = options.logBtn;

    // State
    this.instructions = [];
    this.labels = {};
    this.currentIdx = 0;
    this.pendingVoice = null;
    this.currentVoice = null;
    this.currentBGM = null;
    this.cgVideoEl = null;
    this.autoMode = false;
    this.autoTimer = null;
    this.isRunning = false;
    this.dialogHistory = [];
    this.callStack = [];
    this.currentScriptPath = null;
    this.waitingForReturn = false;

    // Active stands
    this.activeStands = {};

    // Async execution guard — prevents re-entrancy during rapid next() calls
    this._busy = false;
    this._advanceTimer = null;

    // Skip mode
    this._skipMode = false;
    this._skipTimer = null;

    this._bindEvents();
  }

  _bindEvents() {
    // Click to advance
    const handleClick = (e) => {
      if (this.choiceContainer.contains(e.target)) return;
      if (this.skipBtn.contains(e.target)) return;
      if (this.autoBtn.contains(e.target)) return;
      if (this.logBtn.contains(e.target)) return;

      // Click cancels auto mode or skip mode
      if (this.autoMode) {
        this._stopAuto();
        return;
      }
      if (this._skipMode) {
        this._stopSkip();
        return;
      }
      this.next();
    };

    this.container.addEventListener('click', handleClick);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (this.autoMode) {
          this._stopAuto();
          this.next();
          return;
        }
        if (this._skipMode) {
          this._stopSkip();
          this.next();
          return;
        }
        this.next();
      }
    });
  }

  /** Search the instructions array for a label by name, return its index or -1. */
  _findLabelIndex(name) {
    for (let i = 0; i < this.instructions.length; i++) {
      if (this.instructions[i].type === 'label' && this.instructions[i].name === name) {
        return i;
      }
    }
    return -1;
  }

  async loadScript(scriptPath, startLabel) {
    this.currentScriptPath = scriptPath;
    
    try {
      const lang = localStorage.getItem('reader-lang') || '';
      let url = `/api/parse-script?path=${encodeURIComponent(scriptPath)}`;
      if (lang) url += `&lang=${encodeURIComponent(lang)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      this.instructions = data.instructions;
      this.labels = data.labels;

      if (startLabel && this.labels[startLabel]) {
        const labelIdx = this._findLabelIndex(startLabel);
        this.currentIdx = labelIdx > 0 ? labelIdx - 1 : 0;
      } else {
        this.currentIdx = 0;
      }

      this.dialogHistory = [];
      this.callStack = [];
      this.isRunning = true;
      this._clearScene();
      this._renderChoices(null); // hide choices
      this._updateHistoryUI();
      this.next();
    } catch (e) {
      console.error('Failed to load script:', e);
      this._showNotification('脚本加载失败: ' + e.message);
    }
  }

  async next(skipGuard) {
    if (!this.isRunning) return;

    // If waiting for return after scene end, dispatch event and stop
    if (this.waitingForReturn) {
      this.waitingForReturn = false;
      this.isRunning = false;
      document.dispatchEvent(new CustomEvent('scene-ended'));
      return;
    }

    // Re-entrancy guard: block external rapid calls while an async _execute is in flight.
    if (!skipGuard && this._busy) return;

    // Clear any pending timers
    this._clearTimers();

    this._busy = true;

    try {
      // Skip image_def, python, with, screen definition instructions automatically
      while (this.currentIdx < this.instructions.length) {
        const inst = this.instructions[this.currentIdx];
        if (!inst) { this.currentIdx++; continue; }

        if (inst.type === 'image_def' || inst.type === 'python' || inst.type === 'screen' || inst.type === 'with') {
          this.currentIdx++;
          continue;
        }
        break;
      }

      if (this.currentIdx >= this.instructions.length) {
        this._showNotification('剧本结束');
        this.isRunning = false;
        return;
      }

      const inst = this.instructions[this.currentIdx];
      await this._execute(inst);
    } finally {
      this._busy = false;
    }
  }

  _clearTimers() {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this._advanceTimer) {
      clearTimeout(this._advanceTimer);
      this._advanceTimer = null;
    }
    if (this._skipTimer) {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
    }
  }

  async _execute(inst) {
    switch (inst.type) {
      case 'label':
        this.currentIdx++;
        await this.next(true);
        break;

      case 'scene':
        this._clearDisplayables();
        await this._setBackground(inst.name);
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'show':
        if (inst.showType === 'bg') {
          await this._setBackground(inst.name);
        } else if (inst.showType === 'cg') {
          await this._setBackground(inst.name);
        } else {
          this._showStand(inst.name, inst.transform);
        }
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'hide':
        this._hideStand(inst.name);
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'dialogue':
        this._showDialogue(inst.speaker, inst.text);
        this.currentIdx++;
        // Schedule auto advance if in auto mode or skip mode
        if (this.autoMode) {
          this._scheduleAutoAdvance(inst.text);
        }
        break;

      case 'voice':
        this.pendingVoice = inst.path;
        this.currentIdx++;
        await this.next(true);
        break;

      case 'play_music':
        this._playBGM(inst.path, inst.fadein, inst.fadeout);
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'stop_music':
        this._stopBGM(inst.fadeout);
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'stop_voice':
        this._stopVoice();
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'play_sound':
        this._playSound(inst.path);
        this.currentIdx++;
        this._autoAdvance();
        break;

      case 'jump':
        this._jumpToLabel(inst.target);
        break;

      case 'jump_expression':
        this._clearScene();
        this.dialogEl.classList.add('visible');
        this.speakerEl.style.display = 'none';
        this.textEl.textContent = '— 场景结束 —';
        this.waitingForReturn = true;
        this.isRunning = true;
        break;

      case 'call':
        this.callStack.push({ idx: this.currentIdx + 1, scriptPath: this.currentScriptPath });
        this._jumpToLabel(inst.target);
        break;

      case 'call_screen':
        this.currentIdx++;
        await this.next(true);
        break;

      case 'return':
        if (this.callStack.length > 0) {
          const ret = this.callStack.pop();
          this.currentIdx = ret.idx;
        } else {
          this.currentIdx++;
        }
        await this.next(true);
        break;

      case 'menu':
        this._showMenu(inst.items);
        this.currentIdx++;
        break;

      case 'pause':
        this._showNotification('...');
        setTimeout(() => {
          this.currentIdx++;
          this.next();
        }, inst.duration * 1000);
        break;

      default:
        this.currentIdx++;
        await this.next(true);
        break;
    }
  }

  _autoAdvance() {
    // Skip mode handles its own advancement — don't double-trigger
    if (this._skipMode) return;
    this._advanceTimer = setTimeout(() => {
      this._advanceTimer = null;
      this.next();
    }, 5);
  }

  /** Schedule auto-advance for dialogue based on voice or text length */
  _scheduleAutoAdvance(text) {
    this._clearTimers();

    const voice = this.currentVoice;
    if (voice && voice.duration && isFinite(voice.duration) && voice.duration > 0) {
      // Has voice with known duration
      const delay = voice.duration * 1000 + 116;
      this.autoTimer = setTimeout(() => {
        this.autoTimer = null;
        if (this.autoMode) this.next();
      }, delay);
    } else if (voice && this._lastVoicePath) {
      // Voice just triggered, duration metadata not yet loaded
      // Listen for loadedmetadata to reschedule with correct timing
      voice.addEventListener('loadedmetadata', () => {
        if (!this.autoMode) return;
        this._clearTimers();
        this._scheduleAutoAdvance(text);
      }, { once: true });
      // Fallback: if metadata never loads, advance after 116ms
      this.autoTimer = setTimeout(() => {
        this.autoTimer = null;
        if (this.autoMode) this.next();
      }, 116);
    } else {
      // No voice: calculate by text byte length (exclude punctuation) + 116ms buffer
      const cleanText = text.replace(/[，。！？、,.!?「」『』\s\n\r]/g, '');
      const byteLen = new TextEncoder().encode(cleanText).length;
      const delay = byteLen * 15 + 116;
      this.autoTimer = setTimeout(() => {
        this.autoTimer = null;
        if (this.autoMode) this.next();
      }, delay);
    }
  }

  async _setBackground(name) {
    if (!name || name === 'black') {
      this._removeCGVideo();
      this.bgEl.style.backgroundImage = 'none';
      this.bgEl.style.backgroundColor = '#000';
      return;
    }

    if (/^BA\d+/i.test(name)) {
      this._removeCGVideo();
      this.bgEl.style.backgroundImage = `url(/bg/${name.toUpperCase()}.jpg)`;
      this.bgEl.style.backgroundColor = 'transparent';
      return;
    }

    try {
      const resp = await fetch(`/api/resolve-cg?name=${encodeURIComponent(name)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.type === 'video') {
          this._showCGVideo(data.url);
        } else {
          this._removeCGVideo();
          this.bgEl.style.backgroundImage = `url(${data.url})`;
          this.bgEl.style.backgroundColor = 'transparent';
        }
        return;
      }
    } catch (e) {
    }

    this._removeCGVideo();
    const url = this._resolveImageUrl(name);
    if (url) {
      this.bgEl.style.backgroundImage = url;
      this.bgEl.style.backgroundColor = 'transparent';
    } else {
      this.bgEl.style.backgroundImage = 'none';
      this.bgEl.style.backgroundColor = '#111';
    }
  }

  _showCGVideo(url) {
    this._removeCGVideo();
    this.bgEl.style.backgroundImage = 'none';
    this.bgEl.style.backgroundColor = '#000';
    const video = document.createElement('video');
    video.className = 'reader-cg-video';
    video.src = url;
    video.autoplay = true;
    video.loop = true;
    video.muted = false;
    video.playsInline = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    this.bgEl.parentNode.insertBefore(video, this.bgEl.nextSibling);
    video.play().catch(e => console.warn('Video play failed:', e));
    this.cgVideoEl = video;
  }

  _removeCGVideo() {
    if (this.cgVideoEl) {
      this.cgVideoEl.pause();
      this.cgVideoEl.remove();
      this.cgVideoEl = null;
    }
  }

  _resolveImageUrl(name) {
    const upper = name.toUpperCase();
    if (/^BA\d+/i.test(name)) {
      return `url(/bg/${upper}.jpg)`;
    }
    if (name.length >= 4) {
      const prefix = upper.substring(0, 4);
      return `url(/resources/${prefix}/image/${upper}.jpg)`;
    }
    return null;
  }

  _showStand(name, transform) {
    const parts = name.split(/\s+/);
    const charId = parts[0].toUpperCase();
    const expr = parts[1] || '01';

    const transformAttrs = {};
    if (transform) {
      const yposMatch = transform.match(/ypos\s+(-?[\d.]+)/);
      if (yposMatch) transformAttrs.ypos = parseFloat(yposMatch[1]);
      const xalignMatch = transform.match(/xalign\s+([\d.]+)/);
      if (xalignMatch) transformAttrs.xalign = parseFloat(xalignMatch[1]);
      const zoomMatch = transform.match(/zoom\s+([\d.]+)/);
      if (zoomMatch) transformAttrs.zoom = parseFloat(zoomMatch[1]);
    }

    let el = this.activeStands[charId];
    if (!el) {
      el = document.createElement('div');
      el.className = 'reader-stand';
      el.dataset.charId = charId;
      this.standLayer.appendChild(el);
      this.activeStands[charId] = el;
    }

    const exprPadded = expr.padStart(2, '0');
    const bodyUrl = `/stand/${charId}/${charId}_st_s_99.png`;
    const exprUrl = `/stand/${charId}/${charId}_st_s_${exprPadded}.png`;
    if (exprPadded === '99') {
      el.style.backgroundImage = `url(${bodyUrl})`;
    } else {
      el.style.backgroundImage = `url(${exprUrl}), url(${bodyUrl})`;
    }
    el.style.backgroundSize = 'contain, contain';
    el.style.backgroundPosition = 'center bottom, center bottom';
    el.style.backgroundRepeat = 'no-repeat, no-repeat';
    el.style.display = 'block';

    const SCALE_CORR = -0.8;
    const correctedZoom = transformAttrs.zoom ? Math.max(0.1, transformAttrs.zoom + SCALE_CORR) : null;

    if (transformAttrs.ypos !== undefined) el.style.bottom = (transformAttrs.ypos + 180) + 'px';
    if (transformAttrs.xalign !== undefined) {
      el.style.left = (transformAttrs.xalign * 100) + '%';
      el.style.transform = `translateX(-${transformAttrs.xalign * 100}%)` + (correctedZoom ? ` scale(${correctedZoom})` : '');
    } else if (correctedZoom) {
      el.style.transform = `scale(${correctedZoom})`;
    }
  }

  _hideStand(name) {
    const parts = name.split(/\s+/);
    const charId = parts[0].toUpperCase();
    const el = this.activeStands[charId];
    if (el) {
      el.style.display = 'none';
    }
  }

  _showDialogue(speaker, text) {
    // Play pending voice and capture duration
    if (this.pendingVoice) {
      this._playVoice(this.pendingVoice);
      this.pendingVoice = null;
    }

    if (speaker) {
      this.speakerEl.textContent = speaker;
      this.speakerEl.style.display = 'block';
    } else {
      this.speakerEl.style.display = 'none';
    }

    const htmlText = text.replace(/\\n/g, '<br>');
    this.textEl.innerHTML = htmlText;
    this.dialogEl.classList.add('visible');

    this.dialogHistory.push({
      speaker: speaker || '(旁白)',
      text,
      voice: this._lastVoicePath || null,
      lineIdx: this.currentIdx - 1
    });
    this._updateHistoryUI();
  }

  _playVoice(path) {
    this._lastVoicePath = path;
    if (this.currentVoice) {
      this.currentVoice.pause();
      this.currentVoice = null;
    }
    const audio = new Audio('/' + path.replace(/\\/g, '/'));
    audio.volume = 1.0;

    // Capture duration for auto-advance scheduling
    audio.addEventListener('loadedmetadata', () => {
      this._voiceDuration = audio.duration;
    });
    // Fallback: if metadata doesn't fire, try on first play
    audio.addEventListener('playing', () => {
      if (!this._voiceDuration && audio.duration && isFinite(audio.duration)) {
        this._voiceDuration = audio.duration;
      }
    });

    audio.play().catch(e => console.warn('Voice play failed:', e));
    this.currentVoice = audio;
  }

  _stopVoice() {
    if (this.currentVoice) {
      this.currentVoice.pause();
      this.currentVoice = null;
    }
    this._lastVoicePath = null;
    this.pendingVoice = null;
    this._voiceDuration = null;
  }

  _playBGM(path, fadein, fadeout) {
    this._stopBGM(fadeout || 0);

    const audio = new Audio('/' + path.replace(/\\/g, '/'));
    audio.loop = true;
    audio.volume = 0.5;
    audio.dataset.targetVolume = '0.5';

    if (fadein && fadein > 0) {
      audio.volume = 0;
      audio.dataset.fadeInterval = fadein;
      this._fadeAudio(audio, 0, parseFloat(audio.dataset.targetVolume), fadein);
    }

    audio.play().catch(e => console.warn('BGM play failed:', e));
    this.currentBGM = audio;
  }

  _stopBGM(fadeout) {
    if (!this.currentBGM) return;
    if (fadeout && fadeout > 0) {
      const audio = this.currentBGM;
      this.currentBGM = null;
      this._fadeAudio(audio, audio.volume, 0, fadeout, () => {
        audio.pause();
      });
    } else {
      this.currentBGM.pause();
      this.currentBGM = null;
    }
  }

  _fadeAudio(audio, startVol, endVol, duration, onComplete) {
    const steps = Math.max(Math.floor(duration * 20), 1);
    const stepVol = (endVol - startVol) / steps;
    let currentStep = 0;
    audio.volume = startVol;
    const timer = setInterval(() => {
      currentStep++;
      if (currentStep >= steps) {
        clearInterval(timer);
        audio.volume = endVol;
        if (onComplete) onComplete();
      } else {
        audio.volume = Math.max(0, Math.min(1, audio.volume + stepVol));
      }
    }, duration * 1000 / steps);
  }

  _playSound(path) {
    const audio = new Audio('/' + path.replace(/\\/g, '/'));
    audio.volume = 1.0;
    audio.play().catch(e => console.warn('Sound play failed:', e));
  }

  async _jumpToLabel(target) {
    if (this.labels[target]) {
      const labelIdx = this._findLabelIndex(target);
      this.currentIdx = labelIdx > 0 ? labelIdx - 1 : 0;
      await this.next(true);
      return;
    }

    try {
      const resp = await fetch('/api/labels');
      const data = await resp.json();
      if (data.labels && data.labels[target]) {
        const scriptPath = data.labels[target];
        this.currentScriptPath = scriptPath;
        await this.loadScript(scriptPath, target);
        return;
      }
    } catch (e) {
      console.error('Label lookup failed:', e);
    }

    this._showNotification(`找不到目标: ${target}`);
    this.isRunning = false;
  }

  _showMenu(items) {
    if (!items || items.length === 0) return;
    this._renderChoices(items);
  }

  _renderChoices(items) {
    this.choiceContainer.innerHTML = '';
    if (!items) {
      this.choiceContainer.style.display = 'none';
      return;
    }

    this.choiceContainer.style.display = 'flex';
    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectChoice(item);
      });
      this.choiceContainer.appendChild(btn);
    });
  }

  async _selectChoice(item) {
    this._renderChoices(null);
    if (item.action === 'jump' || item.action === 'Jump') {
      this._jumpToLabel(item.target);
    } else if (item.action === 'call') {
      this.callStack.push({ idx: this.currentIdx, scriptPath: this.currentScriptPath });
      this._jumpToLabel(item.target);
    }
  }

  _clearScene() {
    this._clearDisplayables();
    this._stopVoice();
    this._stopBGM();
  }

  _clearDisplayables() {
    this.bgEl.style.backgroundImage = 'none';
    this.bgEl.style.backgroundColor = '#000';
    this._removeCGVideo();
    this.standLayer.innerHTML = '';
    this.activeStands = {};
    this.dialogEl.classList.remove('visible');
    this.speakerEl.textContent = '';
    this.textEl.textContent = '';
  }

  _showNotification(msg) {
    this.textEl.textContent = msg;
    this.speakerEl.style.display = 'none';
    this.dialogEl.classList.add('visible');
  }

  _updateHistoryUI() {
    const event = new CustomEvent('history-update', { detail: this.dialogHistory });
    document.dispatchEvent(event);
  }

  // ===== Public API =====

  replayVoice() {
    if (this._lastVoicePath) {
      this._playVoice(this._lastVoicePath);
    }
  }

  jumpToLine(lineIdx) {
    const truncateAt = this.dialogHistory.findIndex(h => h.lineIdx >= lineIdx);
    if (truncateAt >= 0) {
      this.dialogHistory = this.dialogHistory.slice(0, truncateAt);
    }
    this._updateHistoryUI();
    this.currentIdx = lineIdx;
    this._clearScene();
    this.next();
  }

  toggleAuto() {
    // Cannot toggle auto during skip mode
    if (this._skipMode) return;

    this.autoMode = !this.autoMode;
    if (this.autoMode) {
      this.autoBtn.classList.add('active');
      this.autoBtn.textContent = '自動';
      // If currently at a dialogue, schedule advance
      if (this.dialogEl.classList.contains('visible') && this.currentIdx > 0) {
        const prevInst = this.instructions[this.currentIdx - 1];
        if (prevInst && prevInst.type === 'dialogue') {
          this._scheduleAutoAdvance(prevInst.text);
        }
      }
    } else {
      this.autoBtn.classList.remove('active');
      this.autoBtn.textContent = '自動';
      this._clearTimers();
    }
  }

  /** Start skip mode — auto-advance at 100ms intervals */
  startSkip() {
    if (this.autoMode) return; // Cannot skip during auto mode
    if (this._skipMode) return;

    this._skipMode = true;
    this.skipBtn.classList.add('active');
    this.skipBtn.textContent = '>>';
    this._skipTick();
  }

  _stopSkip() {
    this._skipMode = false;
    if (this._skipTimer) {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
    }
    this.skipBtn.classList.remove('active');
    this.skipBtn.textContent = '>>';
  }

  async _skipTick() {
    if (!this._skipMode) return;
    await this.next();
    if (this._skipMode) {
      this._skipTimer = setTimeout(() => this._skipTick(), 100);
    }
  }

  _stopAuto() {
    this.autoMode = false;
    this.autoBtn.classList.remove('active');
    this.autoBtn.textContent = '自動';
    this._clearTimers();
  }

  getHistory() {
    return this.dialogHistory;
  }
}

// Export for browser
window.NovelReader = NovelReader;
