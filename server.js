const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ── Per-file translation loading ──
function loadFileTranslation(scriptPath) {
  // Given "hscene/001J1U4O63.rpy", look for "data/script/hscene/001J1U4O63_zh.json"
  const zhPath = path.join(DATA_DIR, 'script', scriptPath.replace(/\.rpy$/i, '_zh.json'));
  if (!fs.existsSync(zhPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(zhPath, 'utf-8'));
    if (!raw.entries) return null;
    const map = {};
    for (const [key, val] of Object.entries(raw.entries)) {
      if (val.translation && val.translation.trim()) {
        map[key] = val.translation.trim();
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch (e) {
    console.warn('Failed to load translation:', zhPath, e.message);
    return null;
  }
}

function applyTranslations(instructions, transMap) {
  if (!transMap) return;
  for (const inst of instructions) {
    if (inst.type === 'dialogue') {
      const tk = 'd:t:' + inst.text;
      if (transMap[tk]) inst.text = transMap[tk];
      const sk = 'd:s:' + inst.speaker;
      if (inst.speaker && transMap[sk]) inst.speaker = transMap[sk];
    }
    if (inst.type === 'menu' && inst.items) {
      for (const item of inst.items) {
        const lk = 'm:l:' + item.label;
        if (transMap[lk]) item.label = transMap[lk];
      }
    }
  }
}

// ── End Translation loading ──

// ── Multilingual translation middleware ──
// Uses Multilingual/jp + Multilingual/zh files as primary translation source,
// with _zh.json and character_names.json as fallbacks for speakers and menu labels.

let _charNameMap = null;
function loadCharNameMap() {
  if (_charNameMap) return _charNameMap;
  const cnPath = path.join(DATA_DIR, 'character_names.json');
  const map = {};
  if (fs.existsSync(cnPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cnPath, 'utf-8'));
      for (const [, info] of Object.entries(raw)) {
        if (info.japanese && info.chinese) {
          map[info.japanese] = info.chinese;
        }
      }
    } catch (e) { /* ignore */ }
  }
  // Common speaker names not in character_names.json
  if (!map['あなた']) map['あなた'] = '你';
  if (!map['？？？']) map['？？？'] = '？？？';
  _charNameMap = map;
  return map;
}

function loadMultilingualTranslation(scriptPath) {
  const baseName = path.basename(scriptPath).replace(/\.rpy$/i, '');
  const mlDir = path.join(DATA_DIR, 'script', 'Multilingual');
  const jpPath = path.join(mlDir, 'jp', baseName + '.txt');
  const zhPath = path.join(mlDir, 'zh', baseName + '.txt');

  if (!fs.existsSync(jpPath) || !fs.existsSync(zhPath)) return null;

  try {
    const jpContent = fs.readFileSync(jpPath, 'utf-8');
    const zhContent = fs.readFileSync(zhPath, 'utf-8');

    const jpLines = jpContent.split('\n').filter(l => l.trim().length > 0).map(l => l.replace(/\r$/, ''));
    const zhLines = zhContent.split('\n').filter(l => l.trim().length > 0).map(l => l.replace(/\r$/, ''));

    const charMap = loadCharNameMap();
    const textMap = {};
    const speakerMap = {};

    const minLen = Math.min(jpLines.length, zhLines.length);
    for (let i = 0; i < minLen; i++) {
      const jpLine = jpLines[i];
      const zhLine = zhLines[i];

      // Parse jp line: split by first ':' (half-width)
      const jpColonIdx = jpLine.indexOf(':');
      if (jpColonIdx < 0) continue;

      const jpSpeaker = jpLine.substring(0, jpColonIdx);
      const jpText = jpLine.substring(jpColonIdx + 1);

      // Parse zh line based on jp speaker
      let zhSpeaker = '';
      let zhText = '';

      if (jpSpeaker === '') {
        // Narration: zh line might start with ':' or just text
        if (zhLine.startsWith(':') || zhLine.startsWith('：')) {
          zhText = zhLine.substring(1);
        } else {
          zhText = zhLine;
        }
      } else {
        // Dialogue: try to find the Chinese speaker prefix
        const expectedZhSpeaker = charMap[jpSpeaker];
        if (expectedZhSpeaker && (zhLine.startsWith(expectedZhSpeaker + ':') || zhLine.startsWith(expectedZhSpeaker + '：'))) {
          zhSpeaker = expectedZhSpeaker;
          zhText = zhLine.substring(expectedZhSpeaker.length + 1);
        } else {
          // Try to find any colon separator in the first 20 chars
          const colonMatch = zhLine.match(/^([^:：]{1,20})[:：](.+)/);
          if (colonMatch && !/[。！？\.\!\?]/.test(colonMatch[1])) {
            zhSpeaker = colonMatch[1];
            zhText = colonMatch[2];
          } else {
            zhText = zhLine;
          }
        }
      }

      if (jpText && zhText) textMap[jpText] = zhText;
      if (jpSpeaker && zhSpeaker) speakerMap[jpSpeaker] = zhSpeaker;
    }

    return { textMap, speakerMap, lineCount: minLen };
  } catch (e) {
    console.warn('Failed to load Multilingual translation:', baseName, e.message);
    return null;
  }
}

// Apply Chinese translations: Multilingual (primary) + _zh.json + character_names (fallbacks)
function applyChineseTranslations(instructions, scriptPath) {
  const mlData = loadMultilingualTranslation(scriptPath);
  const zhJsonMap = loadFileTranslation(scriptPath);
  const charMap = loadCharNameMap();

  // Build combined speaker map (priority: _zh.json > character_names > Multilingual)
  const speakerMap = {};
  if (mlData) Object.assign(speakerMap, mlData.speakerMap);
  Object.assign(speakerMap, charMap);
  if (zhJsonMap) {
    for (const [key, val] of Object.entries(zhJsonMap)) {
      if (key.startsWith('d:s:')) speakerMap[key.substring(4)] = val;
    }
  }

  // Build combined text map (priority: Multilingual > _zh.json)
  const textMap = {};
  if (zhJsonMap) {
    for (const [key, val] of Object.entries(zhJsonMap)) {
      if (key.startsWith('d:t:')) textMap[key.substring(4)] = val;
    }
  }
  if (mlData) Object.assign(textMap, mlData.textMap);

  // Apply translations
  let translated = 0;
  let unmatched = 0;

  for (const inst of instructions) {
    if (inst.type === 'dialogue') {
      if (textMap[inst.text]) {
        inst.text = textMap[inst.text];
        translated++;
      } else {
        unmatched++;
      }
      if (inst.speaker && speakerMap[inst.speaker]) {
        inst.speaker = speakerMap[inst.speaker];
      }
    }
    if (inst.type === 'menu' && inst.items) {
      for (const item of inst.items) {
        if (textMap[item.label]) {
          item.label = textMap[item.label];
        } else if (zhJsonMap) {
          const lk = 'm:l:' + item.label;
          if (zhJsonMap[lk]) item.label = zhJsonMap[lk];
        }
      }
    }
  }

  return { translated, unmatched, total: translated + unmatched };
}
// ── End Multilingual translation middleware ──

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Serve game assets
app.use('/bg', express.static(path.join(DATA_DIR, 'images', 'bg')));
app.use('/stand', express.static(path.join(DATA_DIR, 'images', 'stand')));
app.use('/thumbnail', express.static(path.join(DATA_DIR, 'images', 'thumbnail')));
app.use('/shome', express.static(path.join(DATA_DIR, 'images', 'shome')));
app.use('/gui', express.static(path.join(DATA_DIR, 'images', 'gui')));
app.use('/bgm', express.static(path.join(DATA_DIR, 'audio', 'bgm')));
app.use('/resources', express.static(path.join(DATA_DIR, 'resources')));
app.use('/ext_voice', express.static(path.join(DATA_DIR, 'audio', 'ext_voice')));

// Image path resolution API: resolve any CG/background image by name
app.get('/api/resolve-image', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'missing name' });

  const upper = name.toUpperCase();
  const resourcesDir = path.join(DATA_DIR, 'resources');

  // Shared transition CG images - scan all resource dirs
  const sharedNames = ['sccatch1', 'scmascot', 'scmainch'];
  if (sharedNames.includes(name.toLowerCase()) && fs.existsSync(resourcesDir)) {
    const dirs = fs.readdirSync(resourcesDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const dir of dirs) {
      const candidate = path.join(resourcesDir, dir.name, 'image', upper + '.jpg');
      if (fs.existsSync(candidate)) {
        return res.json({ url: `/resources/${dir.name}/image/${upper}.jpg` });
      }
    }
    return res.status(404).json({ error: 'not found', name });
  }

  // Regular CG: first 4 chars = resource prefix
  if (name.length >= 4) {
    const prefix = upper.substring(0, 4);
    // Check image (.jpg) in /image/ directory
    const exactImgPath = path.join(resourcesDir, prefix, 'image', upper + '.jpg');
    if (fs.existsSync(exactImgPath)) {
      return res.json({ type: 'image', url: `/resources/${prefix}/image/${upper}.jpg` });
    }
    // Check video (.webm) in /movie/ directory
    const exactMovPath = path.join(resourcesDir, prefix, 'movie', upper + '.webm');
    if (fs.existsSync(exactMovPath)) {
      return res.json({ type: 'video', url: `/resources/${prefix}/movie/${upper}.webm` });
    }
    // Fallback: strip last character (variant suffix like "q2" → "q")
    const fallbackName = upper.slice(0, -1);
    if (fallbackName.length >= 4) {
      const fbPrefix = fallbackName.substring(0, 4);
      const fbImgPath = path.join(resourcesDir, fbPrefix, 'image', fallbackName + '.jpg');
      if (fs.existsSync(fbImgPath)) {
        return res.json({ type: 'image', url: `/resources/${fbPrefix}/image/${fallbackName}.jpg` });
      }
      const fbMovPath = path.join(resourcesDir, fbPrefix, 'movie', fallbackName + '.webm');
      if (fs.existsSync(fbMovPath)) {
        return res.json({ type: 'video', url: `/resources/${fbPrefix}/movie/${fallbackName}.webm` });
      }
    }
  }

  // Try generic locations
  const candidates = [
    path.join(DATA_DIR, 'images', 'bg', upper + '.jpg'),
    path.join(DATA_DIR, 'images', 'bg', upper + '.png'),
    path.join(DATA_DIR, 'images', 'stand', upper + '.png'),
    path.join(DATA_DIR, 'resources', upper + '.jpg'),
    path.join(DATA_DIR, 'resources', upper + '.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const rel = path.relative(DATA_DIR, candidate).replace(/\\/g, '/');
      return res.json({ type: 'image', url: '/' + rel });
    }
  }

  res.status(404).json({ error: 'not found', name });
});

// CG resolution API: prefer video (webm) over static image (jpg)
app.get('/api/resolve-cg', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'missing name' });
  const upper = name.toUpperCase();
  const resourcesDir = path.join(DATA_DIR, 'resources');

  // Shared CG scan (sccatch1, scmascot, scmainch)
  const sharedNames = ['sccatch1', 'scmascot', 'scmainch'];
  if (sharedNames.includes(name.toLowerCase()) && fs.existsSync(resourcesDir)) {
    const dirs = fs.readdirSync(resourcesDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const webmPath = path.join(resourcesDir, dir.name, 'movie', upper + '.webm');
      if (fs.existsSync(webmPath)) return res.json({ type: 'video', url: `/resources/${dir.name}/movie/${upper}.webm` });
      const imgPath = path.join(resourcesDir, dir.name, 'image', upper + '.jpg');
      if (fs.existsSync(imgPath)) return res.json({ type: 'image', url: `/resources/${dir.name}/image/${upper}.jpg` });
    }
    return res.status(404).json({ error: 'not found', name });
  }

  if (name.length >= 4) {
    const prefix = upper.substring(0, 4);
    // Exact match: prefer video
    const exactWebm = path.join(resourcesDir, prefix, 'movie', upper + '.webm');
    if (fs.existsSync(exactWebm)) return res.json({ type: 'video', url: `/resources/${prefix}/movie/${upper}.webm` });
    const exactImg = path.join(resourcesDir, prefix, 'image', upper + '.jpg');
    if (fs.existsSync(exactImg)) return res.json({ type: 'image', url: `/resources/${prefix}/image/${upper}.jpg` });
    // Fallback (strip last char)
    const fbName = upper.slice(0, -1);
    if (fbName.length >= 4) {
      const fbPrefix = fbName.substring(0, 4);
      const fbWebm = path.join(resourcesDir, fbPrefix, 'movie', fbName + '.webm');
      if (fs.existsSync(fbWebm)) return res.json({ type: 'video', url: `/resources/${fbPrefix}/movie/${fbName}.webm` });
      const fbImg = path.join(resourcesDir, fbPrefix, 'image', fbName + '.jpg');
      if (fs.existsSync(fbImg)) return res.json({ type: 'image', url: `/resources/${fbPrefix}/image/${fbName}.jpg` });
    }
  }
  res.status(404).json({ error: 'not found', name });
});

// List script files
app.get('/api/scripts', (req, res) => {
  const scriptDir = path.join(DATA_DIR, 'script');
  const results = [];

  function scan(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith('.rpyc')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, prefix ? prefix + '/' + entry.name : entry.name);
      } else if (entry.name.endsWith('.rpy')) {
        results.push(prefix ? prefix + '/' + entry.name : entry.name);
      }
    }
  }

  scan(scriptDir, '');
  // Also include root script.rpy
  const rootScript = path.join(DATA_DIR, 'script.rpy');
  if (fs.existsSync(rootScript)) results.unshift('script.rpy');

  res.json({ scripts: results });
});

// Get script content
app.get('/api/script', (req, res) => {
  const scriptPath = req.query.path;
  if (!scriptPath) return res.status(400).json({ error: 'missing path' });

  // Sanitize: prevent path traversal
  const safePath = path.normalize(scriptPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(DATA_DIR, 'script', safePath);

  // Also try root
  const rootFullPath = path.join(DATA_DIR, safePath);

  let target = fullPath;
  if (fs.existsSync(fullPath)) target = fullPath;
  else if (fs.existsSync(rootFullPath)) target = rootFullPath;
  else return res.status(404).json({ error: 'script not found', path: safePath });

  try {
    const content = fs.readFileSync(target, 'utf-8');
    res.json({ content, path: safePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Parse script into instruction list
app.get('/api/parse-script', (req, res) => {
  const scriptPath = req.query.path;
  if (!scriptPath) return res.status(400).json({ error: 'missing path' });

  const safePath = path.normalize(scriptPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const dirPath = path.join(DATA_DIR, 'script', safePath);
  const rootPath = path.join(DATA_DIR, safePath);

  let target = dirPath;
  if (!fs.existsSync(dirPath) && fs.existsSync(rootPath)) target = rootPath;

  try {
    const content = fs.readFileSync(target, 'utf-8');
    const instructions = parseRenPyScript(content, { scriptDir: safePath.substring(0, safePath.lastIndexOf('/')) });
    // Chinese localization middleware: Multilingual/zh (primary) + _zh.json + character_names (fallbacks)
    const lang = req.query.lang;
    if (lang === 'zh-CN') {
      applyChineseTranslations(instructions, safePath);
    }
    res.json({ instructions, labels: extractLabels(instructions) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List available labels across all scripts
app.get('/api/labels', (req, res) => {
  const scriptDir = path.join(DATA_DIR, 'script');
  const labels = {};

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.rpy') && !entry.name.endsWith('.rpyc')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const scriptPath = path.relative(path.join(DATA_DIR, 'script'), fullPath).replace(/\\/g, '/');
          // Extract labels
          const labelRegex = /^\s*label\s+(\w+)/gm;
          let match;
          while ((match = labelRegex.exec(content)) !== null) {
            labels[match[1]] = scriptPath;
          }
        } catch (e) {}
      }
    }
  }

  scanDir(scriptDir);
  // Also scan root script.rpy
  const rootScript = path.join(DATA_DIR, 'script.rpy');
  if (fs.existsSync(rootScript)) {
    try {
      const content = fs.readFileSync(rootScript, 'utf-8');
      const labelRegex = /^\s*label\s+(\w+)/gm;
      let match;
      while ((match = labelRegex.exec(content)) !== null) {
        labels[match[1]] = 'script.rpy';
      }
    } catch (e) {}
  }

  res.json({ labels });
});

// Scan sub_nav scripts → character → scenes mapping
app.get('/api/character-scenes', (req, res) => {
  const subDir = path.join(DATA_DIR, 'script', 'sub_nav');
  const characters = [];

  if (!fs.existsSync(subDir)) return res.json({ characters });

  const files = fs.readdirSync(subDir);
  for (const file of files) {
    if (!file.endsWith('.rpy') || file.endsWith('.rpyc')) continue;
    // sub_001IUX.rpy → 001IUX
    const charId = file.replace(/^sub_/, '').replace(/\.rpy$/, '');
    const fullPath = path.join(subDir, file);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      let bg = 'ba103';
      const stands = [];
      const scenes = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Background: add "ba103"
        const bgMatch = line.match(/^add\s+"(\w+)"/);
        if (bgMatch && bgMatch[1].startsWith('ba')) {
          bg = bgMatch[1];
          continue;
        }

        // Character stand: add "001iux_st_s_99" ...
        const standMatch = line.match(/^add\s+"(\w+_st_s_\w+)"\s/);
        if (standMatch) {
          stands.push(standMatch[1]);
          continue;
        }

        // Scene thumbnail button: imagebutton auto "001j_%s":
        const thumbMatch = line.match(/^imagebutton\s+auto\s+"(\w+)_%s"/);
        if (thumbMatch) {
          const thumbId = thumbMatch[1];
          // Find the Jump target in subsequent lines
          let j = i;
          let targetLabel = null;
          while (j < lines.length && j < i + 10) {
            const jumpMatch = lines[j].match(/Jump\s*\(\s*"(\w+)"\s*\)/);
            if (jumpMatch) {
              targetLabel = jumpMatch[1];
              break;
            }
            j++;
          }
          scenes.push({ thumb: thumbId, label: targetLabel || ('H' + charId) });
          continue;
        }
      }

      characters.push({
        id: charId,
        bg: bg,
        stands: stands.length > 0 ? stands : [charId.toLowerCase() + '_st_s_99', charId.toLowerCase() + '_st_s_07'],
        scenes: scenes
      });
    } catch (e) {
      // skip invalid files
    }
  }

  res.json({ characters });
});

// Character name mapping (for grid display)
app.get('/api/character-names', (req, res) => {
  const namePath = path.join(DATA_DIR, 'character_names.json');
  if (!fs.existsSync(namePath)) return res.json({ names: {} });
  try {
    const data = JSON.parse(fs.readFileSync(namePath, 'utf-8'));
    const names = {};
    for (const [id, val] of Object.entries(data)) {
      names[id] = val.chinese || val.japanese || id;
    }
    res.json({ names });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List voice files for a character
app.get('/api/character-voices', (req, res) => {
  const charId = req.query.charId;
  if (!charId) return res.status(400).json({ error: 'missing charId' });

  const voiceDir = path.join(DATA_DIR, 'audio', 'ext_voice', charId.toUpperCase());
  if (!fs.existsSync(voiceDir)) return res.json({ voices: [] });

  try {
    const files = fs.readdirSync(voiceDir)
      .filter(f => f.endsWith('.mp3'))
      .sort();
    res.json({ voices: files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List available translation locales
app.get('/api/locales', (req, res) => {
  const i18nDir = path.join(DATA_DIR, 'script');
  if (!fs.existsSync(i18nDir)) return res.json({ locales: [], hasTranslation: false });

  // Count _zh.json files as a heuristic
  let zhCount = 0;
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) scanDir(path.join(dir, item.name));
      else if (item.name.endsWith('_zh.json')) zhCount++;
    }
  }
  scanDir(i18nDir);
  res.json({ locales: zhCount > 0 ? ['zh-CN'] : [], hasTranslation: zhCount > 0 });
});

// List expression stand files for a character (exclude body _st_s_99)
app.get('/api/character-stands', (req, res) => {
  const charId = req.query.charId;
  if (!charId) return res.status(400).json({ error: 'missing charId' });

  const standDir = path.join(DATA_DIR, 'images', 'stand', charId.toUpperCase());
  if (!fs.existsSync(standDir)) return res.json({ stands: [] });

  try {
    const files = fs.readdirSync(standDir)
      .filter(f => f.endsWith('.png') && /_st_s_\d+\.png$/i.test(f))
      .sort();
    res.json({ stands: files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Ren'Py Script Parser =====
function extractLabels(instructions) {
  const labels = {};
  for (const inst of instructions) {
    if (inst.type === 'label') {
      labels[inst.name] = inst;
    }
  }
  return labels;
}

function parseRenPyScript(content, options) {
  const lines = content.split('\n');
  const instru = [];
  const scriptDir = options?.scriptDir || '';

  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trimEnd();
    i++;

    // Skip comments and empty lines
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const trimmed = line.trim();

    // Multi-line string handling (strings that continue on next lines)
    // Ren'Py dialogue can span lines
    // Label
    const labelMatch = trimmed.match(/^label\s+(\w+)/);
    if (labelMatch) {
      instru.push({ type: 'label', name: labelMatch[1], line: i });
      continue;
    }

    // return
    if (trimmed === 'return') {
      instru.push({ type: 'return', line: i });
      continue;
    }

    // jump expression <variable> (e.g. "jump expression current_sub")
    const jumpExprMatch = trimmed.match(/^jump\s+expression\s+(\w+)/i);
    if (jumpExprMatch) {
      instru.push({ type: 'jump_expression', variable: jumpExprMatch[1], line: i });
      continue;
    }

    // jump
    const jumpMatch = trimmed.match(/^jump\s+(\w+)/i);
    if (jumpMatch) {
      instru.push({ type: 'jump', target: jumpMatch[1], line: i });
      continue;
    }

    // call screen [name] (display UI screen)
    const callScreenMatch = trimmed.match(/^call\s+screen\s+(\w+)/i);
    if (callScreenMatch) {
      instru.push({ type: 'call_screen', target: callScreenMatch[1], line: i });
      continue;
    }

    // call [label] or call expression [expr]
    const callMatch = trimmed.match(/^call\s+(?:(?:expression\s+)?)(\w[\w]*)\s*(?:\(([^)]*)\))?/i);
    if (callMatch) {
      instru.push({ type: 'call', target: callMatch[1], args: callMatch[2] || '', line: i });
      continue;
    }

    // scene [name]
    const sceneMatch = trimmed.match(/^scene\s+(\w+)/i);
    if (sceneMatch) {
      instru.push({ type: 'scene', name: sceneMatch[1], line: i });
      continue;
    }

    // show [name] [expression]: (with optional transform block)
    const showMatch = trimmed.match(/^show\s+(.+)$/i);
    if (showMatch) {
      let showArgs = showMatch[1].trim();
      // Separate name+expression from "with" clause
      let withClause = '';
      const withIdx = showArgs.search(/\s+with\s+/i);
      if (withIdx >= 0) {
        withClause = showArgs.substring(withIdx);
        showArgs = showArgs.substring(0, withIdx).trim();
      }
      // Remove trailing colon (transform block indicator)
      let namePart = showArgs;
      let hasTransform = false;
      if (namePart.endsWith(':')) {
        namePart = namePart.slice(0, -1).trimEnd();
        hasTransform = true;
      }
      // Collect multi-line transform block
      let transformBlock = '';
      if (hasTransform) {
        let j = i;
        while (j < lines.length) {
          const rawLine = lines[j];
          const tl = rawLine.replace(/\s+$/, '');
          if (tl.trim() === '' || tl.trim().startsWith('#')) { j++; continue; }
          // Transform lines start with whitespace followed by property keyword
          if (tl.match(/^\s+(at|ypos|xpos|zoom|xalign|yalign|alpha)\s/i)) {
            transformBlock += tl + '\n';
            j++;
          } else {
            break;
          }
        }
        i = j;
      }
      // Classify show subtype: bg / cg / stand
      // (same classification logic as debug page's isCGShow + getTypeInfo)
      let showType = 'stand'; // default: character stand
      const lowerName = namePart.toLowerCase();
      if (lowerName.startsWith('ba')) {
        showType = 'bg';
      } else if (withClause.trim().length > 0 || namePart.includes('with')) {
        showType = 'cg';
      } else if (!namePart.includes(' ')) {
        // Single-word name that doesn't start with "ba" → CG image
        showType = 'cg';
      }
      instru.push({ type: 'show', showType: showType, name: namePart, rest: withClause, transform: transformBlock.trim(), line: i });
      continue;
    }

    // hide [name]
    const hideMatch = trimmed.match(/^hide\s+(\S+)/i);
    if (hideMatch) {
      instru.push({ type: 'hide', name: hideMatch[1], line: i });
      continue;
    }

    // play music
    const playMatch = trimmed.match(/^play\s+music\s+"([^"]+)"(?:\s+fadein\s+([\d.]+))?(?:\s+fadeout\s+([\d.]+))?/i);
    if (playMatch) {
      instru.push({ type: 'play_music', path: playMatch[1], fadein: parseFloat(playMatch[2]) || 0, fadeout: parseFloat(playMatch[3]) || 0, line: i });
      continue;
    }

    // stop music
    if (/^stop\s+music/i.test(trimmed)) {
      const fadeMatch = trimmed.match(/fadeout\s+([\d.]+)/i);
      instru.push({ type: 'stop_music', fadeout: parseFloat(fadeMatch?.[1]) || 0, line: i });
      continue;
    }

    // stop voice
    if (/^stop\s+voice/i.test(trimmed)) {
      instru.push({ type: 'stop_voice', line: i });
      continue;
    }

    // voice
    const voiceMatch = trimmed.match(/^voice\s+"([^"]+)"/i);
    if (voiceMatch) {
      instru.push({ type: 'voice', path: voiceMatch[1], line: i });
      continue;
    }

    // play "path"
    const playVoiceMatch = trimmed.match(/^play\s+"([^"]+)"/i);
    if (playVoiceMatch) {
      instru.push({ type: 'play_sound', path: playVoiceMatch[1], line: i });
      continue;
    }

    // Dialogue: "speaker" "text" or "" "text"
    const diagMatch = trimmed.match(/^"([^"]*)"\s*"(.+)"(\s*)$/);
    if (diagMatch) {
      instru.push({ type: 'dialogue', speaker: diagMatch[1], text: diagMatch[2], line: i });
      continue;
    }

    // with (transition effect)
    const withMatch = trimmed.match(/^with\s+(.+)/i);
    if (withMatch) {
      instru.push({ type: 'with', effect: withMatch[1], line: i });
      continue;
    }

    // pause
    if (/^pause\s+([\d.]+)/i.test(trimmed)) {
      const pMatch = trimmed.match(/^pause\s+([\d.]+)/i);
      instru.push({ type: 'pause', duration: parseFloat(pMatch[1]), line: i });
      continue;
    }

    // menu
    if (/^menu:/i.test(trimmed)) {
      const menuItems = [];
      let j = i;
      while (j < lines.length) {
        const ml = lines[j].trimEnd();
        const menuLineMatch = ml.match(/^\s+"([^"]+)":/);
        if (menuLineMatch) {
          const label = menuLineMatch[1];
          j++;
          // Find the jump/call inside
          while (j < lines.length) {
            const actionLine = lines[j].trim();
            if (actionLine === '') { j++; continue; }
            const actMatch = actionLine.match(/^\s+(jump|call)\s+(\w+)/i);
            if (actMatch) {
              menuItems.push({ label, action: actMatch[1], target: actMatch[2] });
              j++;
              break;
            }
            break;
          }
        } else if (ml.trim() === '' || ml.trim().startsWith('#')) {
          j++;
          continue;
        } else {
          break;
        }
      }
      i = j;
      instru.push({ type: 'menu', items: menuItems, line: i });
      continue;
    }

    // screen definition (simplified: skip entire screen block)
    if (/^screen\s+\w+\(\):/i.test(trimmed)) {
      let j = i;
      let depth = 1;
      while (j < lines.length) {
        const sl = lines[j];
        if (sl.trim() !== '' && !sl.trim().startsWith('#') && sl.search(/\S/) <= 0) {
          depth++;
        } else if (sl.trim() !== '' && sl.search(/\S/) <= 0) {
          depth--;
          if (depth <= 0) { j++; break; }
        }
        j++;
      }
      i = j;
      continue;
    }

    // image definition (image [name] = ...)
    if (/^image\s+.+?=\s*/i.test(trimmed)) {
      // Check for multi-line Composite definition
      if (/Composite\s*\(/i.test(trimmed) && !/\)\s*$/.test(trimmed.trim())) {
        // Collect multi-line Composite block
        let rawLines = [trimmed];
        let j = i;
        let depth = 1;
        while (j < lines.length) {
          const cl = lines[j];
          rawLines.push(cl.replace(/\s+$/, ''));
          // Count opening/closing parentheses
          for (const ch of cl) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
          }
          j++;
          if (depth <= 0) break;
        }
        i = j;

        // Parse Composite layers from the collected block
        const fullRaw = rawLines.join('\n');
        // Extract image name: "image 001iux 01 = Composite("
        const nameMatch = trimmed.match(/^image\s+(.+?)\s*=\s*Composite/i);
        // Extract layer filenames: (0,0), "filename"
        const layerMatches = fullRaw.match(/"([^"]+)"/g) || [];
        const layers = layerMatches.map(m => m.replace(/"/g, ''));

        instru.push({
          type: 'image_def',
          raw: trimmed,
          rawFull: fullRaw,
          composite: {
            name: nameMatch ? nameMatch[1] : trimmed.replace(/^image\s+/i, '').replace(/\s*=.*$/, ''),
            layers: layers
          },
          line: i
        });
      } else {
        instru.push({ type: 'image_def', raw: trimmed, line: i });
      }
      continue;
    }

    // $ python statement
    if (/^\$\s/.test(trimmed)) {
      instru.push({ type: 'python', raw: trimmed.substring(1).trim(), line: i });
      continue;
    }
  }

  return instru;
}

app.listen(PORT, () => {
  console.log(`Angelic Py Web Reader running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
