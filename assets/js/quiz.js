/* ===== 全局状态 ===== */
let allQuestions = [];      // 全部题目
let questionPool = [];      // 当前抽题池
let currentIndex = 0;       // 当前题号
let userAnswers = {};       // 用户答案 {idx: answer}
let questionAnswered = {};  // 是否已判卷 {idx: true}
let multiSelectState = {};  // 多选题暂存 {idx: {label: 1}}
let practiceMode = 'normal'; // normal：普通练习；wrong：错题练习
let answerNotes = {};       // 本次判题后显示的错题本提示

const PROGRESS_KEY_PREFIX = 'study_station_progress_v1:';
const WRONG_BOOK_KEY = 'study_station_wrong_book_v1';

/* ===== 加载数据 ===== */
const params = new URLSearchParams(window.location.search);
const subject = params.get('subject');

function showLoadMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'em';
  const text = document.createElement('p');
  text.textContent = message;
  wrapper.appendChild(text);
  getEl('qa').replaceChildren(wrapper);
}

function loadSubject() {
  if (!subject) {
    showLoadMessage('请通过导航页选择科目');
    return;
  }

  fetch('data/subjects.json')
    .then(r => {
      if (!r.ok) throw new Error('科目配置加载失败');
      return r.json();
    })
    .then(subjects => {
      // 白名单：只允许加载配置文件中明确登记的题库。
      const config = subjects.find(item => item.id === subject);
      if (!config) throw new Error('未知科目');
      return fetch(config.file).then(r => {
        if (!r.ok) throw new Error('题库加载失败');
        return r.json();
      }).then(data => ({ config, data }));
    })
    .then(({ config, data }) => {
      const keyCounts = {};
      allQuestions = data.map(q => {
        const copy = cloneQuestion(q);
        const baseKey = getQuestionKey(copy);
        keyCounts[baseKey] = (keyCounts[baseKey] || 0) + 1;
        copy._questionKey = baseKey + (keyCounts[baseKey] > 1 ? '-' + keyCounts[baseKey] : '');
        return copy;
      });
      getEl('quizTitle').textContent = config.title;
      getEl('pageTitle').textContent = config.title + ' - 题库练习';
      getEl('quizSubtitle').textContent = config.subtitle;
      getEl('totalInfo').textContent = '题库共 ' + allQuestions.length + ' 题';
      buildChapterUI();
      cleanStaleWrongQuestions();
      updateWrongBookUI();
      restoreProgress();
    })
    .catch(() => {
      showLoadMessage('题库加载失败或科目不存在');
    });
}

loadSubject();

function getEl(id) { return document.getElementById(id); }

/* ===== 本地保存与题目标识 ===== */
function cloneQuestion(q) {
  return JSON.parse(JSON.stringify(q));
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getQuestionKey(q) {
  const optionText = Array.isArray(q.options)
    ? q.options.map(o => o.label + ':' + o.text).join('|')
    : '';
  const source = [subject, q.chapter, q.chapter_title, q.type, q.stem, q.answer, optionText].join('\n');
  return String(subject) + '-' + hashText(source);
}

function readLocalJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeLocalJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    getEl('saveStatus').textContent = '浏览器存储空间不足，当前进度未保存';
    return false;
  }
}

function removeLocalItem(key) {
  try { localStorage.removeItem(key); } catch (error) { /* 浏览器禁用存储时忽略 */ }
}

function getProgressKey() {
  return PROGRESS_KEY_PREFIX + subject;
}

function getWrongBook() {
  const book = readLocalJSON(WRONG_BOOK_KEY, { version: 1, subjects: {} });
  if (!book || typeof book !== 'object') return { version: 1, subjects: {} };
  if (!book.subjects || typeof book.subjects !== 'object') book.subjects = {};
  return book;
}

function getSubjectWrongEntries(book) {
  const data = book || getWrongBook();
  if (!data.subjects[subject] || typeof data.subjects[subject] !== 'object') {
    data.subjects[subject] = {};
  }
  return data.subjects[subject];
}

function cleanStaleWrongQuestions() {
  const book = getWrongBook();
  const entries = getSubjectWrongEntries(book);
  const validKeys = new Set(allQuestions.map(q => q._questionKey));
  let changed = false;
  Object.keys(entries).forEach(key => {
    if (!validKeys.has(key)) {
      delete entries[key];
      changed = true;
    }
  });
  if (changed) writeLocalJSON(WRONG_BOOK_KEY, book);
}

function updateWrongBookUI() {
  const entries = getSubjectWrongEntries(getWrongBook());
  const count = Object.keys(entries).length;
  getEl('wrongBookButton').textContent = '错题本（' + count + '）';
  getEl('clearWrongButton').disabled = count === 0;
}

function getSelectedChapterValues() {
  return Array.from(document.querySelectorAll('.chi.ck')).map(c => c.textContent);
}

function saveProgress(message) {
  if (!subject || !questionPool.length) return;
  const progress = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mode: practiceMode,
    settings: {
      chapter: getEl('cf').value,
      type: getEl('tf').value,
      count: getEl('ci').value,
      shuffleOptions: getEl('sfCb').checked,
      selectedChapters: getSelectedChapterValues()
    },
    questionKeys: questionPool.map(q => q._questionKey),
    optionOrders: questionPool.map(q => q._optionOrder || null),
    currentIndex,
    userAnswers,
    questionAnswered,
    multiSelectState
  };
  if (writeLocalJSON(getProgressKey(), progress)) {
    getEl('saveStatus').textContent = message ||
      (practiceMode === 'wrong' ? '错题练习进度已自动保存' : '答题进度已自动保存');
  }
}

function applyOptionOrder(q, order) {
  if (!Array.isArray(order) || !Array.isArray(q.options) || order.length !== q.options.length) return q;
  const originalOptions = new Map(q.options.map(o => [o.label, o]));
  const displayLabels = q.options.map(o => o.label);
  if (order.some(label => !originalOptions.has(label))) return q;
  q.options = order.map((originalLabel, index) => {
    const original = originalOptions.get(originalLabel);
    return { label: displayLabels[index], text: original.text, note: original.note || '' };
  });
  const correctOriginalLabels = String(q.answer).split('');
  q.answer = order.reduce((labels, originalLabel, index) => {
    if (correctOriginalLabels.includes(originalLabel)) labels.push(displayLabels[index]);
    return labels;
  }, []).sort().join('');
  q._optionOrder = order.slice();
  return q;
}

function restoreControls(settings) {
  if (!settings) return;
  if (Array.from(getEl('cf').options).some(o => o.value === settings.chapter)) getEl('cf').value = settings.chapter;
  if (Array.from(getEl('tf').options).some(o => o.value === settings.type)) getEl('tf').value = settings.type;
  getEl('ci').value = settings.count || 10;
  getEl('sfCb').checked = Boolean(settings.shuffleOptions);
  const selected = new Set(settings.selectedChapters || []);
  document.querySelectorAll('.chi').forEach(chip => chip.classList.toggle('ck', selected.has(chip.textContent)));
  updateChapterLabel();
}

function restoreProgress() {
  const progress = readLocalJSON(getProgressKey(), null);
  if (!progress || !Array.isArray(progress.questionKeys) || !progress.questionKeys.length) return;
  const byKey = new Map(allQuestions.map(q => [q._questionKey, q]));
  if (progress.questionKeys.some(key => !byKey.has(key))) {
    removeLocalItem(getProgressKey());
    getEl('saveStatus').textContent = '题库已更新，旧进度已清除';
    return;
  }

  questionPool = progress.questionKeys.map((key, index) => {
    const q = cloneQuestion(byKey.get(key));
    return applyOptionOrder(q, progress.optionOrders && progress.optionOrders[index]);
  });
  currentIndex = Math.max(0, Math.min(Number(progress.currentIndex) || 0, questionPool.length - 1));
  userAnswers = progress.userAnswers || {};
  questionAnswered = progress.questionAnswered || {};
  multiSelectState = progress.multiSelectState || {};
  practiceMode = progress.mode === 'wrong' ? 'wrong' : 'normal';
  answerNotes = {};
  restoreControls(progress.settings);
  renderQuestion();
  getEl('ab').style.display = 'flex';
  getEl('saveStatus').textContent = practiceMode === 'wrong' ? '已恢复上次错题练习' : '已恢复上次答题进度';
}

/* ===== 获取题目的分组键：Python 按知识点，其他科目按章节编号 ===== */
function getChapterKey(q) {
  return (subject === 'Python题库') ? (q.chapter_title || q.chapter) : q.chapter;
}

/* ===== 章节 UI ===== */
function buildChapterUI() {
  const isPython = subject === 'Python题库';
  const chapters = [...new Set(allQuestions.map(q => getChapterKey(q)))]
      .sort((a, b) => {
        const aTest = String(a).includes('自测'), bTest = String(b).includes('自测');
        if (aTest && !bTest) return 1;
        if (!aTest && bTest) return -1;
        return String(a).localeCompare(String(b), undefined, {numeric: true});
      });

  const cf = getEl('cf'), cml = getEl('cml');
  chapters.forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch;
    const count = allQuestions.filter(q => getChapterKey(q) === ch).length;
    const q = allQuestions.find(q => getChapterKey(q) === ch);
    const display = isPython
      ? ch + ' (' + count + '题)'
      : ch + (q && q.chapter_title ? ' ' + q.chapter_title : '') + ' (' + count + '题)';
    opt.textContent = display;
    cf.appendChild(opt);

    const chip = document.createElement('span');
    chip.className = 'chi';
    chip.textContent = ch;
    chip.title = display;
    chip.onclick = function() { this.classList.toggle('ck'); updateChapterLabel(); };
    cml.appendChild(chip);
  });

  // 动态生成题型选项
  const types = [...new Set(allQuestions.map(q => q.type))];
  const tf = getEl('tf');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    tf.appendChild(opt);
  });
}

/* ===== 章节多选 ===== */
function toggleChapterPanel() {
  const panel = getEl('cmp');
  const toggle = document.querySelector('.cmt');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  toggle.innerHTML = isOpen ? '📋 多选章节 ▸' : '📋 多选章节 ▾';
}

function selectAllChapters() {
  document.querySelectorAll('.chi').forEach(c => c.classList.add('ck'));
  updateChapterLabel();
}

function deselectAllChapters() {
  document.querySelectorAll('.chi').forEach(c => c.classList.remove('ck'));
  updateChapterLabel();
}

function updateChapterLabel() {
  const n = document.querySelectorAll('.chi.ck').length;
  const toggle = document.querySelector('.cmt');
  toggle.innerHTML = n > 0 ? '📋 多选章节 (' + n + '个) ▸' : '📋 多选章节 ▸';
}

function getSelectedChapters() {
  const chips = document.querySelectorAll('.chi.ck');
  if (chips.length === 0) return null;
  return Array.from(chips).map(c => c.textContent);
}

/* ===== Fisher-Yates 洗牌 ===== */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===== 乱序选项 ===== */
function shuffleOptions(questions) {
  for (const q of questions) {
    if (q.type === '判断题' || q.type === '填空题') continue;
    const originalOptions = q.options.map(o => ({ ...o }));
    const order = originalOptions.map(o => o.label);
    // 保存“显示位置对应的原选项标签”，恢复进度时可还原同一顺序。
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    applyOptionOrder(q, order);
  }
  return questions;
}

/* ===== 抽题 ===== */
function drawQuestions() {
  const chapter = getEl('cf').value;
  const type = getEl('tf').value;
  const count = parseInt(getEl('ci').value) || 10;

  let pool = allQuestions.slice();
  const selChapters = getSelectedChapters();
  if (selChapters) {
    pool = pool.filter(q => selChapters.includes(getChapterKey(q)));
  } else if (chapter !== 'all') {
    pool = pool.filter(q => getChapterKey(q) === chapter);
  }
  if (type !== 'all') pool = pool.filter(q => q.type === type);

  if (!pool.length) { alert('无符合条件题目'); return; }

  const n = Math.min(count, pool.length);
  questionPool = shuffle(pool).slice(0, n).map(cloneQuestion);

  if (getEl('sfCb').checked) shuffleOptions(questionPool);

  practiceMode = 'normal';
  currentIndex = 0;
  userAnswers = {};
  questionAnswered = {};
  multiSelectState = {};
  answerNotes = {};
  updateStats();
  renderQuestion();
  getEl('ab').style.display = 'flex';
  saveProgress('已开始新的普通练习，进度会自动保存');
}

/* ===== 重置 ===== */
function resetQuiz() {
  questionPool = [];
  currentIndex = 0;
  userAnswers = {};
  questionAnswered = {};
  multiSelectState = {};
  answerNotes = {};
  practiceMode = 'normal';
  getEl('qa').innerHTML = '<div class="em"><p>👆 选择条件，点击「抽题」开始</p><p class="ec">题库共 ' + allQuestions.length + ' 题</p></div>';
  getEl('ab').style.display = 'none';
  removeLocalItem(getProgressKey());
  getEl('saveStatus').textContent = '当前答题进度已清除';
  updateStats();
}

/* ===== 错题本 ===== */
function startWrongPractice() {
  const book = getWrongBook();
  const entries = getSubjectWrongEntries(book);
  const wrongKeys = Object.keys(entries);
  if (!wrongKeys.length) {
    alert('当前科目还没有错题');
    return;
  }

  const byKey = new Map(allQuestions.map(q => [q._questionKey, q]));
  const available = wrongKeys.filter(key => byKey.has(key)).map(key => byKey.get(key));
  if (!available.length) {
    cleanStaleWrongQuestions();
    updateWrongBookUI();
    alert('题库已更新，旧错题记录已清理');
    return;
  }

  const requested = Math.max(1, parseInt(getEl('ci').value) || available.length);
  questionPool = shuffle(available).slice(0, requested).map(cloneQuestion);
  if (getEl('sfCb').checked) shuffleOptions(questionPool);
  practiceMode = 'wrong';
  currentIndex = 0;
  userAnswers = {};
  questionAnswered = {};
  multiSelectState = {};
  answerNotes = {};
  renderQuestion();
  getEl('ab').style.display = 'flex';
  saveProgress('已进入错题练习；连续答对 2 次会移出错题本');
}

function recordAnswerResult(i) {
  const q = questionPool[i];
  if (!q) return;
  const correct = checkAnswer(i);
  const book = getWrongBook();
  const entries = getSubjectWrongEntries(book);
  const key = q._questionKey;

  if (!correct) {
    const old = entries[key] || { wrongCount: 0, correctStreak: 0 };
    entries[key] = {
      wrongCount: (Number(old.wrongCount) || 0) + 1,
      correctStreak: 0,
      lastWrongAt: new Date().toISOString(),
      lastUserAnswer: userAnswers[i] || ''
    };
    answerNotes[i] = '已加入错题本（累计答错 ' + entries[key].wrongCount + ' 次）';
  } else if (practiceMode === 'wrong' && entries[key]) {
    entries[key].correctStreak = (Number(entries[key].correctStreak) || 0) + 1;
    if (entries[key].correctStreak >= 2) {
      delete entries[key];
      answerNotes[i] = '已连续答对 2 次，这道题已移出错题本';
    } else {
      answerNotes[i] = '错题巩固：已连续答对 1/2 次';
    }
  }

  writeLocalJSON(WRONG_BOOK_KEY, book);
  updateWrongBookUI();
}

function clearSavedProgress() {
  if (!subject || !confirm('确定清除当前科目的答题进度吗？错题本不会受影响。')) return;
  resetQuiz();
}

function clearWrongBook() {
  if (!subject || !confirm('确定清空当前科目的全部错题吗？此操作无法撤销。')) return;
  const book = getWrongBook();
  book.subjects[subject] = {};
  writeLocalJSON(WRONG_BOOK_KEY, book);
  updateWrongBookUI();
  if (practiceMode === 'wrong') resetQuiz();
  getEl('saveStatus').textContent = '当前科目的错题本已清空';
}

/* ===== 判题逻辑 ===== */
function checkAnswer(idx) {
  const ua = userAnswers[idx];
  const q = questionPool[idx];
  if (!ua || !q) return false;
  if (q.type === '多选题') {
    return ua.split('').sort().join('') === q.answer.split('').sort().join('');
  }
  if (q.type === '填空题') {
    // 统一分隔符：| → ; 再去空白比较
    return ua.toLowerCase().replace(/\s/g, '').replace(/\|/g, ';') === q.answer.toLowerCase().replace(/\s/g, '').replace(/\|/g, ';');
  }
  return ua === q.answer;
}

/* ===== 更新统计 ===== */
function updateStats() {
  const total = questionPool.length;
  const done = Object.keys(userAnswers).length;
  let correct = 0;
  Object.keys(userAnswers).forEach(i => {
    if (checkAnswer(parseInt(i))) correct++;
  });
  getEl('st').textContent = total;
  getEl('sd').textContent = done;
  getEl('sc').textContent = correct;
  getEl('sa').textContent = done > 0 ? Math.round(correct / done * 100) + '%' : '-';
  getEl('sr').textContent = total - done;
}

/* ===== 答题 ===== */
function answerQuestion(i, value) {
  if (i in questionAnswered) return;
  const q = questionPool[i];

  if (q.type === '多选题') {
    if (!multiSelectState[i]) multiSelectState[i] = {};
    if (multiSelectState[i][value]) {
      delete multiSelectState[i][value];
    } else {
      multiSelectState[i][value] = 1;
    }
    renderQuestion();
    saveProgress();
    return;
  }

  userAnswers[i] = value;
  questionAnswered[i] = true;
  recordAnswerResult(i);
  renderQuestion();
  updateStats();
  saveProgress();
}

function submitFillIn(i) {
  if (i in questionAnswered) return;
  const q = questionPool[i];
  const blankCount = getFillInBlankCount(q);
  const vals = [];
  for (let j = 0; j < blankCount; j++) {
    const el = getEl('fb' + i + '_' + j);
    vals.push(el ? el.value.trim() : '');
  }
  userAnswers[i] = vals.join('|');
  questionAnswered[i] = true;
  recordAnswerResult(i);
  renderQuestion();
  updateStats();
  saveProgress();
}

function submitMulti(i) {
  if (i in questionAnswered) return;
  const sel = multiSelectState[i] || {};
  const keys = Object.keys(sel).sort();
  userAnswers[i] = keys.join('');
  questionAnswered[i] = true;
  recordAnswerResult(i);
  renderQuestion();
  updateStats();
  saveProgress();
}

/* ===== 填空题辅助 ===== */
function getFillInBlankCount(q) {
  const blankSet = new Set();
  q.stem.replace(/【(\d+)】/g, (m, n) => { blankSet.add(parseInt(n)); return m; });
  return blankSet.size || (q.answer ? q.answer.split('|').length : 1);
}

/* ===== 渲染题目 ===== */
function renderQuestion() {
  if (!questionPool.length) return;
  const q = questionPool[currentIndex];
  const i = currentIndex;
  const answered = i in questionAnswered;

  // 题型 badge 颜色
  const typeClass = q.type === '单选题' ? 'bs' : q.type === '多选题' ? 'bm' : q.type === '填空题' ? 'bf' : 'bj';

  // 渲染选项区域
  let stemHTML = '';
  let optionHTML = '';
  if (q.type === '判断题') {
    optionHTML = renderTrueFalse(i, answered);
  } else if (q.type === '填空题') {
    const fi = renderFillIn(i, answered);
    stemHTML = fi.stem;
    optionHTML = fi.inputs;
  } else {
    optionHTML = renderOptions(i, answered);
  }

  // 多选提交按钮
  if (q.type === '多选题' && !answered) {
    const sel = multiSelectState[i] || {};
    const keys = Object.keys(sel);
    optionHTML += '<div class="sb"><button type="button" class="bt bt-s" onclick="submitMulti(' + i + ')"' +
      (keys.length === 0 ? ' disabled style="opacity:.5"' : '') +
      '>💬 提交答案</button></div>';
  }

  // 填空题提交按钮
  if (q.type === '填空题' && !answered) {
    optionHTML += '<div class="sb"><button type="button" class="bt bt-s" onclick="submitFillIn(' + i + ')">✉ 提交答案</button></div>';
  }

  // 反馈区域
  let feedbackHTML = '';
  if (answered) {
    const ua = userAnswers[i] || '';
    const ok = checkAnswer(i);
    const fbClass = ok ? 'fc' : 'fi';
    const icon = ok ? '✅ 回答正确！' : '❌ 回答错误';

    if (q.type === '填空题') {
      const correctParts = q.answer.split('|');
      const userParts = ua.split('|');
      feedbackHTML = '<div class="fb sh ' + fbClass + '"><strong>' + icon + '</strong>';

      // 错误时显示你的答案 vs 正确答案 逐空对比
      if (!ok) {
        feedbackHTML += '<div class="fi-fb-user">';
        feedbackHTML += '<div class="fi-fb-label">你的答案</div>';
        correctParts.forEach((cv, j) => {
          const uv = userParts[j] || '(未填)';
          const eq = uv.toLowerCase().replace(/\s/g, '') === cv.toLowerCase().replace(/\s/g, '');
          feedbackHTML += '<div class="fi-fb-item"><span class="fi-fb-n">第' + (j + 1) + '空</span>' +
            '<span class="fi-fb-v ' + (eq ? 'ok' : 'er') + '">' + escapeHTML(uv) + '</span>' +
            (eq ? ' ✅' : ' ❌ → ' + escapeHTML(cv)) +
            '</div>';
        });
        feedbackHTML += '</div>';
      }

      // 正确答案（始终显示）
      feedbackHTML += '<div class="fi-fb-correct">';
      feedbackHTML += '<div class="fi-fb-label" style="color:#52c41a">正确答案</div>';
      correctParts.forEach((cv, j) => {
        feedbackHTML += '<div class="fi-fb-item"><span class="fi-fb-n">第' + (j + 1) + '空</span>' +
          '<span class="fi-fb-v ok">' + escapeHTML(cv) + '</span></div>';
      });
      feedbackHTML += '</div>';
    } else {
      const yourAnswer = ok ? '' : '你的答案：<b>' + escapeHTML(ua) + '</b><br>';
      feedbackHTML = '<div class="fb sh ' + fbClass + '"><strong>' + icon + '</strong><br>' +
        yourAnswer + '正确答案：<b>' + escapeHTML(q.answer) + '</b>';
    }

    if (q.type === '判断题') {
      feedbackHTML += ' (' + (q.answer === '√' ? '正确' : '错误') + ')';
    }
    if (q.trans) {
      feedbackHTML += '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e8e8e8;color:#666;font-size:.95em"><strong>🌍 整句翻译：</strong>' + escapeHTML(q.trans) + '</div>';
    }
    if (q.explanation) {
      feedbackHTML += '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e8e8e8"><div style="font-weight:600;color:#667eea;margin-bottom:4px;font-size:.9em">📖 解析</div><div style="color:#555;line-height:1.7;font-size:.92em;white-space:pre-wrap">' + escapeHTML(q.explanation) + '</div></div>';
    }
    if (answerNotes[i]) {
      feedbackHTML += '<div class="wrong-note">' + escapeHTML(answerNotes[i]) + '</div>';
    }
    feedbackHTML += '</div>';
  }

  getEl('qa').innerHTML =
    '<div class="qc">' +
    '<div class="qh">' +
    '<span class="qb ' + typeClass + '">' + q.type + '</span>' +
    '<span class="qp">' + q.chapter + ' ' + q.chapter_title + ' · 第 ' + (i + 1) + '/' + questionPool.length + ' 题</span>' +
    '</div>' +
    (q.type === '填空题' ? stemHTML : '<div class="qs">' + renderStem(q.stem) + '</div>') +
    optionHTML + feedbackHTML +
    '</div>';

  updateStats();
}

/* ===== 判断题渲染 ===== */
function renderTrueFalse(i, answered) {
  const ua = userAnswers[i];
  const ca = questionPool[i].answer;
  const btnClass = v => {
    if (!answered) return ua === v ? 'sel' : '';
    if (v === ca) return 'ok';
    if (v === ua && ua !== ca) return 'er';
    return '';
  };
  const disabled = answered ? 'di' : '';
  return '<div class="jo">' +
    '<div class="jb ' + btnClass('√') + ' ' + disabled + '" onclick="answerQuestion(' + i + ',\'√\')">✅ 正确</div>' +
    '<div class="jb ' + btnClass('X') + ' ' + disabled + '" onclick="answerQuestion(' + i + ',\'X\')">❌ 错误</div>' +
    '</div>';
}

/* ===== 填空题渲染（题干+代码块 → 底部统一输入框） ===== */
function renderFillIn(i, answered) {
  const q = questionPool[i];
  const ua = userAnswers[i] || '';
  const parts = ua ? ua.split('|') : [];
  const stem = q.stem;

  // 确定空数量（去重【数字】编号）
  const blankCount = getFillInBlankCount(q);

  //【数字】→ 视觉占位标记
  const marker = (n) => '<span class="fi-mk">（' + n + '）</span>';

  // 检测代码块
  const hasCode = stem.includes('\n');
  let descHTML = '';
  let codeHTML = '';

  if (hasCode) {
    const lines = stem.split('\n');
    const rawDesc = lines[0];
    const rawCode = lines.slice(1).join('\n');

    descHTML = escapeHTML(rawDesc).replace(/【(\d+)】/g, (m, n) => marker(n));

    const indented = autoIndentPython(rawCode);
    const codeLines = indented.split('\n').map(l => {
      // 保护 【N】 占位符，防止数字高亮误匹配
      let line = l.replace(/【(\d+)】/g, '\x00B$1\x00');
      line = highlightPython(line);  // 内部已含 escapeHTML
      line = line.replace(/\x00B(\d+)\x00/g, (m, n) => marker(n));
      return line;
    }).join('\n');

    codeHTML = '<div class="code-block">' + codeLines + '</div>';
  } else {
    descHTML = escapeHTML(stem).replace(/【(\d+)】/g, (m, n) => marker(n));
  }

  // 题干区域
  const stemHTML = '<div class="qs">' + descHTML + codeHTML + '</div>';

  // 底部统一输入框
  let inputsHTML = '<div class="fi-row">';
  inputsHTML += '<div class="fi-row-tip">📝 作答区（共 ' + blankCount + ' 空）</div>';
  for (let j = 0; j < blankCount; j++) {
    const val = parts[j] || '';
    const dis = answered ? 'disabled' : '';
    inputsHTML += '<div class="fi-row-item">' +
      '<span class="fi-row-label">第' + (j + 1) + '空</span>' +
      '<input type="text" class="fi-inp" id="fb' + i + '_' + j +
      '" value="' + escapeAttr(val) + '" ' + dis + ' placeholder="请输入答案">' +
      '</div>';
  }
  inputsHTML += '</div>';

  return { stem: stemHTML, inputs: inputsHTML };
}

/* ===== 单选/多选渲染 ===== */
/* 选项文本渲染：检测 ; 分隔的代码并格式化 */
var PY_CODE_RE = /\b(def|for|while|if|print|open|import|return|class|with|try|except)\s*[:(]/;
function renderOptionText(text) {
  if (subject !== 'Python题库') return escapeHTML(text || '');
  if (!text) return escapeHTML(String(text));

  // \n 换行格式（预嵌缩进，跳过 autoIndentPython）
  if (text.includes('\n') && PY_CODE_RE.test(text)) {
    return '<div class="oc">' + text.split('\n').map(function(l) {
      return '<code>' + highlightPython(l) + '</code>';
    }).join('\n') + '</div>';
  }

  // ; 分隔格式（旧格式，需 autoIndentPython 推断缩进）
  if (!text.includes(';')) return escapeHTML(text);
  var parts = text.split(';');
  var hasCode = parts.some(function(p) { return PY_CODE_RE.test(p); });
  if (!hasCode) return escapeHTML(text);
  var rawCode = parts.map(function(l) { return l.trim(); }).join('\n');
  return '<div class="oc">' + autoIndentPython(rawCode).split('\n').map(function(l) {
    return '<code>' + highlightPython(l) + '</code>';
  }).join('\n') + '</div>';
}

function renderOptions(i, answered) {
  const q = questionPool[i];
  const ua = userAnswers[i] || '';
  const multiSel = multiSelectState[i] || {};
  const ca = q.answer;

  let html = '<div class="op">';
  q.options.forEach(o => {
    let cls = '';
    if (!answered) {
      if (q.type === '多选题') {
        if (multiSel[o.label]) cls = 'sel';
      } else {
        if (ua === o.label) cls = 'sel';
      }
    } else {
      if (q.type === '多选题') {
        if (ca.includes(o.label)) cls = 'ok';
        if (ua.includes(o.label) && !ca.includes(o.label)) cls = 'er';
      } else {
        if (o.label === ca) cls = 'ok';
        if (o.label === ua && o.label !== ca) cls = 'er';
      }
    }
    if (answered) cls += ' di';

    const click = answered ? '' : 'onclick="answerQuestion(' + i + ',\'' + o.label + '\')"';
    html += '<div class="oi ' + cls + '" ' + click + '>' +
      '<div class="ol">' + o.label + '</div>' +
      '<div class="ot">' + renderOptionText(o.text) +
      (answered && o.note ? ' <span style="color:#999;font-size:.9em">（' + escapeHTML(o.note) + '）</span>' : '') +
      '</div></div>';
  });
  html += '</div>';
  return html;
}

/* ===== 题干渲染（支持代码块） ===== */
function renderStem(stem) {
  if (subject !== 'Python题库') return escapeHTML(stem || '');
  if (!stem || typeof stem !== 'string') return escapeHTML(String(stem));

  // 用 ; 分隔的代码题模式：描述。; code1; code2
  const parts = stem.split(';');
  if (parts.length <= 1) {
    // 没有 ;，检查是否有 \n 实际换行（填空题代码块）
    if (stem.includes('\n')) {
      const segments = stem.split('\n');
      const desc = escapeHTML(segments[0]);
      const rawCode = segments.slice(1).join('\n');
      const code = autoIndentPython(rawCode).split('\n').map(l => highlightPython(l)).join('\n');
      if (code.trim()) {
        return desc + '<div class="code-block">' + code + '</div>';
      }
    }
    return escapeHTML(stem);
  }

  // 有 ; 分隔：第一段是描述，后面是代码行
  const desc = escapeHTML(parts[0].trim());
  const rawCode = parts.slice(1).map(l => l.trim()).join('\n');
  const codeLines = autoIndentPython(rawCode).split('\n').map(l => highlightPython(l)).join('\n');
  if (codeLines.trim()) {
    return desc + '<div class="code-block">' + codeLines + '</div>';
  }
  return escapeHTML(stem);
}

/* ===== 简单 Python 语法高亮（占位符架构：先标记→转义→替换，不交叉污染） ===== */
function highlightPython(code) {
  // 使用不可见控制字符作为占位符，避免和代码内容冲突
  const M = { kw: '\x01', fn: '\x02', str: '\x03', num: '\x04', cm: '\x05' };

  let result = code;

  // 1. 注释（#开头到行尾）
  result = result.replace(/(#.*)$/gm, (m, c) => M.cm + c + M.cm);

  // 2. 字符串（必须在其他模式之前，防止内部内容被误匹配）
  result = result.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, (m) => M.str + m + M.str);

  // 3. 关键字（优先于函数调用，真正的 Python 关键字）
  result = result.replace(/\b(def|class|if|else|elif|for|while|in|import|from|return|and|or|not|as|with|try|except|finally|raise|lambda|yield|pass|break|continue|is|global|nonlocal|del|assert|True|False|None)\b/g, (m) => M.kw + m + M.kw);

  // 4. 函数调用 identifier(（print/range/len 等内置函数）
  result = result.replace(/\b([a-zA-Z_]\w*)(?=\()/g, (m, n) => M.fn + n + M.fn);

  // 5. 数字
  result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => M.num + m + M.num);

  // 6. HTML 转义（此时没有 HTML 标签，安全）
  result = escapeHTML(result);

  // 7. 替换占位符为实际 <span> 标签
  result = result
    .replace(new RegExp(M.kw + '(.*?)' + M.kw, 'g'), '<span class="kw">$1</span>')
    .replace(new RegExp(M.fn + '(.*?)' + M.fn, 'g'), '<span class="fn">$1</span>')
    .replace(new RegExp(M.str + '(.*?)' + M.str, 'g'), '<span class="str">$1</span>')
    .replace(new RegExp(M.num + '(.*?)' + M.num, 'g'), '<span class="num">$1</span>')
    .replace(new RegExp(M.cm + '(.*?)' + M.cm, 'g'), '<span class="cm">$1</span>');

  return result;
}

/* ===== Python 代码自动缩进（修复数据源缩进丢失） ===== */
function autoIndentPython(codeText) {
  if (!codeText || !codeText.trim()) return codeText;
  const lines = codeText.split('\n');
  // 有任意行已有缩进则跳过
  const hasIndent = lines.some(l => l.length > 0 && (l[0] === ' ' || l[0] === '\t'));
  if (hasIndent) return codeText;

  let indent = 0;
  const INDENT = 4;
  return lines.map(line => {
    const t = line.trim();
    if (!t) return '';
    // else/elif/except/finally 回退到同级
    if (/^(else|elif|except|finally)\b/.test(t)) indent = Math.max(0, indent - 1);
    const out = ' '.repeat(indent * INDENT) + t;
    // : 结尾的块开头（排除切片和字符串）
    if (t.endsWith(':') && !/^\d+:/.test(t)) indent++;
    return out;
  }).join('\n');
}

/* ===== HTML 转义 ===== */
function escapeHTML(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ===== 导航 ===== */
function nextQuestion() {
  if (currentIndex < questionPool.length - 1) {
    currentIndex++;
    renderQuestion();
    saveProgress();
    const qc = document.querySelector('.qc');
    if (qc) qc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function prevQuestion() {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
    saveProgress();
    const qc = document.querySelector('.qc');
    if (qc) qc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ===== 快速点击（移动端 300ms 延迟优化） ===== */
(function() {
  let target = null, startX = 0, startY = 0;
  const CLICKABLE = ['BUTTON', 'A'];
  document.addEventListener('touchstart', e => {
    target = e.target;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, true);
  document.addEventListener('touchend', e => {
    if (!target) return;
    const tag = target.tagName;
    const cls = target.className || '';
    const isClickable = CLICKABLE.includes(tag) ||
      cls.includes('oi') || cls.includes('jb') || cls.includes('chi');
    if (isClickable) {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        e.preventDefault();
        target.click();
      }
    }
    target = null;
  }, true);
})();

/* ===== 键盘快捷键 ===== */
document.addEventListener('keydown', e => {
  if (!questionPool.length) return;
  // 输入框聚焦时禁用所有快捷键
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
  const i = currentIndex;
  const q = questionPool[i];
  const answered = i in questionAnswered;

  if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); nextQuestion(); }
  if (e.key === 'ArrowLeft' || e.key === 'p') { e.preventDefault(); prevQuestion(); }

  if (!answered) {
    const k = e.key.toUpperCase();
    if ('ABCDE'.includes(k) && (q.type === '单选题' || q.type === '多选题')) { e.preventDefault(); answerQuestion(i, k); }
    if (e.key === 'Enter' && q.type === '多选题') { e.preventDefault(); submitMulti(i); }
    if (q.type === '判断题') {
      if (k === 'A' || e.key === '1') { e.preventDefault(); answerQuestion(i, '√'); }
      if (k === 'B' || e.key === '0') { e.preventDefault(); answerQuestion(i, 'X'); }
    }
  }
});
