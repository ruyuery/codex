'use strict';

function bindExamMode({el, api, state, save, account, checking, selectPrivatePaper}) {
  const letters = 'ABCDEF';
  let scope = account()?.id ?? 'guest';
  let attempt = null;
  let view = 'lobby';
  let selected = null;
  let report = null;
  let busy = false;

  const draftKey = () => 'jingkao-exam-draft-' + scope;
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(draftKey())); }
    catch { return null; }
  }
  function storeDraft(value) {
    attempt = value;
    try {
      if (value) localStorage.setItem(draftKey(), JSON.stringify(value));
      else localStorage.removeItem(draftKey());
    } catch {}
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function show(screen) {
    view = screen;
    el('examLobby').hidden = screen !== 'lobby';
    el('examWorkspace').hidden = screen === 'lobby';
    el('examWorking').hidden = screen !== 'working';
    el('examResult').hidden = screen !== 'result';
  }
  function readPack(paper) {
    if (paper.questions) return Promise.resolve(paper);
    return api('exams/' + encodeURIComponent(paper.id) + '/practice').then(({questions}) => ({
      id: paper.id, title: paperTitle(paper), minutes: paper.minutes, questions
    }));
  }
  function paperTitle(paper) {
    return paper.title ?? (paper.year ? paper.year + ' 年北京公务员考试 · ' + paper.subject : '原创行测模拟 · 8 题');
  }
  function paperList() {
    if (!account()) return [];
    return Object.values(state().examPrivatePapers ?? {}).filter(paper => paper?.id && Array.isArray(paper.questions));
  }
  function setSelection(paper) {
    selected = paper;
    if (!paper) { updateControls(); return; }
    el('examSelectedTitle').textContent = paperTitle(paper);
    const count = paper.questions?.length ?? paper.items.length;
    const ready = paper.ready || !!paper.questions;
    el('examSelectedTitle').hidden = !ready;
    el('examSelectedInfo').textContent = ready ? count + ' 道客观题 · ' + paper.minutes + ' 分钟' :
      '本卷可对照原卷作答。导入含题干、选项、答案和解析的试卷后可限时练习。';
    updateControls();
  }
  function updateControls() {
    el('examControls').hidden = !selected && !attempt;
    el('examStart').hidden = !selected || !(selected.ready || selected.questions) || !!attempt;
    el('examStart').disabled = checking() || busy;
    el('examResume').hidden = !attempt;
    el('examResume').textContent = attempt?.pack.id === selected?.id ? '继续答题' : '继续上次答题';
    el('examUpload').disabled = checking() || !account();
  }
  function onState() {
    const newScope = account()?.id ?? 'guest';
    if (newScope !== scope) {
      scope = newScope;
      attempt = readDraft();
      report = null;
      el('examUploadStatus').textContent = '';
      if (el('examConfirm').open) el('examConfirm').close('cancel');
      show('lobby');
    }
    updateControls();
    renderHistory();
  }
  function renderHistory() {
    const list = el('examHistoryList');
    const recent = Object.values(state().examResults ?? {}).filter(result => result?.id && result?.scores)
      .sort((a, b) => b.closedAt - a.closedAt).slice(0, 8);
    el('examHistory').hidden = !recent.length;
    list.replaceChildren();
    for (const item of recent) {
      const button = node('button', item.title + ' · 错 ' + item.scores.wrong + ' / ' + item.scores.total + ' 题 · ' +
        new Date(item.closedAt).toLocaleString('zh-CN', {dateStyle: 'short', timeStyle: 'short'}), 'ghost-button');
      button.type = 'button';
      button.onclick = async () => {
        const source = paperList().find(paper => paper.id === item.paperId) ??
          {id: item.paperId, title: item.title};
        const owner = scope;
        try {
          const pack = await readPack(source);
          if (owner === scope) showResults(item, pack);
        } catch {
          el('examFeedback').textContent = '暂时无法载入这份试卷的解析。';
        }
      };
      list.append(button);
    }
  }
  async function start() {
    if (!selected || checking() || attempt || busy) return;
    const owner = scope;
    const paper = selected;
    busy = true;
    updateControls();
    el('examFeedback').textContent = '';
    try {
      const pack = await readPack(paper);
      if (owner !== scope || paper !== selected || el('examScreen').hidden) return;
      const started = Date.now();
      storeDraft({id: 'attempt-' + started + '-' + Math.random().toString(36).slice(2),
        pack, deadline: started + pack.minutes * 60000, index: 0, answers: []});
      resume();
    } catch {
      el('examFeedback').textContent = '暂时无法载入题目。请重试。';
    } finally {
      busy = false;
      updateControls();
    }
  }
  function resume() {
    if (!attempt || checking()) return;
    show('working');
    el('examWorkspaceTitle').textContent = attempt.pack.title;
    renderQuestion(true);
    tick();
  }
  function move(index) {
    if (!attempt || !tick()) return;
    const last = attempt.pack.questions.length - 1;
    attempt.index = Math.max(0, Math.min(index, last));
    storeDraft(attempt);
    renderQuestion(true);
  }
  function drawPrompt(container, question, index) {
    container.replaceChildren();
    container.append(node('p', '第 ' + (index + 1) + ' 题 · ' + question.section +
      (question.kind === 'multiple' ? ' · 多选' : ' · 单选'), 'exam-meta'));
    if (question.material) container.append(node('p', question.material, 'exam-material'));
    const heading = node('h3', question.stem);
    heading.tabIndex = -1;
    container.append(heading);
    if (question.image) {
      const image = node('img', '', 'exam-figure');
      image.src = question.image;
      image.alt = question.imageAlt || '题目附图';
      container.append(image);
    }
    return heading;
  }
  function renderQuestion(focus) {
    const {pack, index, answers} = attempt;
    const question = pack.questions[index];
    const area = el('examQuestion');
    const heading = drawPrompt(area, question, index);
    const choices = node('div', '', 'exam-choice-list');
    if (question.kind === 'multiple') {
      choices.append(node('p', '选好后点击下一题，最后一题可直接交卷。', 'exam-meta'));
    }
    for (const [letter, option] of Object.entries(question.options)) {
      const button = node('button', '', 'exam-choice');
      button.type = 'button';
      button.dataset.option = letter;
      button.setAttribute('aria-pressed', String((answers[index] ?? '').includes(letter)));
      button.append(node('span', letter, 'exam-letter'), node('span', option));
      button.onclick = () => answer(index, letter);
      choices.append(button);
    }
    area.append(choices);
    el('examPrevious').disabled = index === 0;
    el('examNext').disabled = index === pack.questions.length - 1;
    updateQuestionCount();
    if (focus) heading.focus({preventScroll: true});
  }
  function updateQuestionCount() {
    const answered = attempt.answers.filter(Boolean).length;
    el('examCount').textContent = '第 ' + (attempt.index + 1) + ' / ' + attempt.pack.questions.length + ' 题 · 已答 ' + answered + ' 题';
  }
  function answer(index, letter) {
    if (!attempt || attempt.index !== index || !tick()) return;
    const previous = attempt.answers[index] ?? '';
    const multiple = attempt.pack.questions[index].kind === 'multiple';
    attempt.answers[index] = multiple ?
      (previous.includes(letter) ? previous.replace(letter, '') : [...previous, letter].sort().join('')) : letter;
    storeDraft(attempt);
    if (!multiple && index < attempt.pack.questions.length - 1) move(index + 1);
    else {
      for (const option of el('examQuestion').querySelectorAll('[data-option]')) {
        option.setAttribute('aria-pressed', String(attempt.answers[index].includes(option.dataset.option)));
      }
      updateQuestionCount();
      if (!multiple) el('examSubmit').focus({preventScroll: true});
    }
  }
  function tick() {
    if (!attempt || checking()) return false;
    const remaining = Math.ceil((attempt.deadline - Date.now()) / 1000);
    const seconds = Math.max(0, remaining);
    el('examClock').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    el('examClock').classList.toggle('urgent', seconds <= 60);
    if (remaining > 0) return true;
    finish(true);
    return false;
  }
  function status(answered, correct) {
    if (!answered) return 'blank';
    return answered === correct ? 'correct' : 'wrong';
  }
  function finish(timedOut) {
    if (!attempt) return;
    const {id, pack, answers} = attempt;
    const results = pack.questions.map((question, index) => status(answers[index], question.answer));
    const scores = {total: results.length, correct: 0, wrong: 0, blank: 0};
    for (const key of results) scores[key] += 1;
    const submitted = {id, title: pack.title, paperId: pack.id, closedAt: Date.now(), answers, scores, timedOut};
    const open = view === 'working';
    storeDraft(null);
    if (el('examConfirm').open) el('examConfirm').close('cancel');
    void save({examResults: {[id]: submitted}});
    if (open) showResults(submitted, pack);
    else el('examFeedback').textContent = '答题时间已到，成绩可在最近交卷查看。';
  }
  function showResults(submitted, pack) {
    report = {submitted, pack};
    show('result');
    el('examWorkspaceTitle').textContent = submitted.title;
    const {total, wrong, correct, blank} = submitted.scores;
    el('examScore').textContent = '错题 ' + wrong + ' / ' + total + ' 题';
    el('examBreakdown').textContent = (submitted.timedOut ? '到时自动交卷 · ' : '') + '正确 ' + correct + ' · 错误 ' + wrong + ' · 未答 ' + blank;
    const names = {correct: '正确', wrong: '错误', blank: '未答'};
    const marks = {correct: '✓', wrong: '×', blank: '–'};
    const grid = el('examResultGrid');
    grid.replaceChildren();
    el('examExplanation').hidden = true;
    for (const [index, item] of pack.questions.entries()) {
      const result = status(submitted.answers[index], item.answer);
      const button = node('button', String(index + 1) + ' ' + marks[result]);
      button.type = 'button';
      button.dataset.status = result;
      button.setAttribute('aria-label', '第 ' + (index + 1) + ' 题，' + names[result]);
      button.setAttribute('aria-pressed', 'false');
      button.onclick = () => showAnalysis(index, button);
      grid.append(button);
    }
  }
  function showAnalysis(index, button) {
    const {submitted, pack} = report;
    const item = pack.questions[index];
    const panel = el('examExplanation');
    panel.hidden = false;
    drawPrompt(panel, item, index);
    el('examResultGrid').querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    const options = node('ul', '', 'exam-review-options');
    for (const [letter, text] of Object.entries(item.options)) {
      options.append(node('li', letter + '. ' + text));
    }
    panel.append(options, node('p', '你的作答：' + (submitted.answers[index] || '未答') + '　正确答案：' + item.answer, 'exam-meta'),
      node('p', '解析', 'exam-meta'), node('p', item.analysis, 'exam-analysis'));
    panel.scrollIntoView({block: 'nearest'});
  }

  function validatePaper(raw) {
    function field(value, limit) {
      return typeof value === 'string' && value.trim().length <= limit ? value.trim() : '';
    }
    const title = field(raw?.title, 100);
    const minutes = raw?.minutes;
    if (!title || !Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw new Error('请填写试卷名称和 1–240 分钟的考试时长。');
    }
    if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 200) {
      throw new Error('一份试卷需要包含 1–200 道客观题。');
    }
    const questions = raw.questions.map((question, index) => {
      const stem = field(question?.stem, 5000);
      const analysis = field(question?.analysis, 4000);
      const rawOptions = question?.options;
      const options = Object.fromEntries(Object.entries(rawOptions ?? {}).sort()
        .map(([letter, option]) => [letter, field(option, 2000)]));
      const keys = Object.keys(options).join('');
      const answer = [...new Set(field(question?.answer, 15).toUpperCase().replace(/[ ,，]+/g, ''))].sort().join('');
      const kind = question?.kind ?? (answer.length > 1 ? 'multiple' : 'single');
      const material = field(question?.material, 10000);
      const image = typeof question?.image === 'string' ? question.image : '';
      if (!stem || !analysis || keys.length < 2 || keys !== letters.slice(0, keys.length) ||
          Object.values(options).some(option => !option) || !answer || [...answer].some(letter => !keys.includes(letter)) ||
          !['single', 'multiple'].includes(kind) || (kind === 'single' && answer.length !== 1) ||
          (question.material && !material) ||
          (image && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image))) {
        throw new Error('第 ' + (index + 1) + ' 题的题干、选项、答案、解析或附图格式有误。请对照模板检查。');
      }
      return {section: field(question.section, 48) || '客观题', stem, options, answer, kind, analysis, material, image,
        imageAlt: field(question.imageAlt, 200)};
    });
    return {title, minutes, questions};
  }
  el('examTemplate').onclick = () => {
    const sample = {title: '我的试卷', minutes: 15, questions: [{
      section: '数量关系', stem: '12 的一半是多少？', kind: 'single',
      options: {A: '4', B: '6', C: '8', D: '10'}, answer: 'B', analysis: '12 ÷ 2 = 6。'
    }]};
    const url = URL.createObjectURL(new Blob([JSON.stringify(sample, null, 2)], {type: 'application/json'}));
    const link = node('a');
    link.href = url;
    link.download = 'exam-template.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  el('examUpload').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || !account()) return;
    const owner = scope;
    const feedback = el('examUploadStatus');
    feedback.textContent = '';
    try {
      if (file.size > 700000) throw new Error('试卷文件需小于 700 KB，附图可压缩后重试。');
      const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      const paper = validatePaper(raw);
      if (owner !== scope) return;
      const id = 'private-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const saved = save({examPrivatePapers: {[id]: {...paper, id}}});
      selectPrivatePaper(id);
      const synced = await saved;
      if (owner === scope) feedback.textContent = synced ? '试卷已导入并同步到服务器。' : '试卷已导入本机，等待同步。';
    } catch (error) {
      if (owner === scope) {
        feedback.textContent = error instanceof SyntaxError ? '文件不是有效的 JSON。请对照模板填写。' : error.message;
      }
    }
  };
  el('examStart').onclick = start;
  el('examResume').onclick = resume;
  el('examBack').onclick = () => { show('lobby'); updateControls(); };
  el('examPrevious').onclick = () => { if (attempt) move(attempt.index - 1); };
  el('examNext').onclick = () => { if (attempt) move(attempt.index + 1); };
  el('examSubmit').onclick = () => {
    if (!tick()) return;
    const blank = attempt.pack.questions.length - attempt.answers.filter(Boolean).length;
    el('examConfirmMessage').textContent = blank ? '还有 ' + blank + ' 道题未作答。交卷后将判分。' : '全部题目已作答。交卷后将判分。';
    el('examConfirm').returnValue = 'cancel';
    el('examConfirm').showModal();
  };
  el('examConfirm').addEventListener('close', () => {
    if (el('examConfirm').returnValue === 'submit' && tick()) finish(false);
  });
  attempt = readDraft();
  setInterval(tick, 250);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return {setSelection, onState, paperList};
}
