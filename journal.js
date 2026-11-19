  'use strict';

  const el = id => document.getElementById(id);
  const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const labelFormat = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', dateStyle: 'full'});
  function beijingDate(date) {
    const parts = Object.fromEntries(dayFormat.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function makeDay(date, phase, index = -1) {
    // Earlier versions used the UTC date of Beijing midnight as the storage key.
    return {
      ...phase, index, iso: beijingDate(date), label: labelFormat.format(date),
      key: new Date(date.getTime() - 86400000).toISOString().slice(0, 10)
    };
  }
  const dates = phases.map((phase, index) => makeDay(new Date(Date.UTC(2026, 10, 18 + index)), phase, index));
  const dateMap = new Map(dates.map(day => [day.iso, day]));
  const moduleNames = ['资料分析', '言语理解', '判断推理', '图形推理', '逻辑判断', '定义判断', '类比推理', '科学推理', '数量关系', '常识判断', '常识时政', '政治理论', '申论', '申论大作文', '行测', '错题复盘'];
  // Practice topics organized around the Beijing public-subject exam outline.
  const examTopics = {
    data: ['统计表与图形读数', '现期与基期', '同比与环比', '增长率与增长量', '比重与比重变化', '平均数及其变化', '倍数与百分点', '截位直除与估算', '综合判断'],
    words: ['主旨概括', '细节理解', '词句理解', '隐含信息推断', '逻辑填空', '语句排序与衔接', '篇章阅读'],
    numbers: ['数字推理', '工程问题', '行程问题', '利润与折扣', '排列组合与概率', '容斥原理', '几何计算', '比例与浓度'],
    logic: ['图形推理', '演绎推理', '削弱与加强', '定义判断', '类比推理', '事件排序', '科学推理'],
    shapes: ['位置变化', '样式规律', '数量规律', '属性规律', '立体图形与折纸盒'],
    science: ['受力与运动', '浮力与压强', '光学与电路', '实验图表与变量控制'],
    general: ['法律基础', '经济与民生', '历史文化', '科技与生活', '地理与生态'],
    politics: ['党的创新理论', '中国式现代化', '高质量发展', '重要会议与政策', '时政专题'],
    essay: ['材料阅读与找点', '归纳概括', '综合分析', '提出对策', '应用文写作', '文章审题立意', '分论点与论证'],
    writing: ['审题与立意', '拟标题与列提纲', '开头与结尾', '分论点与论证', '完整文章限时写作'],
    verbal: ['必要与充分条件', '削弱与加强', '前提假设', '结论推断', '真假推理'],
    analogy: ['种属与组成', '并列与交叉', '功能与用途', '语义与语法关系'],
    test: ['京考真题', '模拟套题', '模块限时训练', '作答顺序与时间分配'],
    review: ['错题归因', '易错考点回顾', '错题二刷', '限时练习复盘', '下一阶段学习安排'],
    examDay: ['准考证与证件', '文具与物品清单', '考点路线与到场时间', '考试日流程预演']
  };
  const topicRules = [
    [/考试|考前|早睡/, ['examDay']],
    [/^图形推理/, ['shapes']],
    [/^科学推理/, ['science']],
    [/^逻辑判断/, ['verbal']],
    [/^定义判断/, ['logic']],
    [/^类比推理/, ['analogy']],
    [/^资料/, ['data']],
    [/^数量/, ['numbers']],
    [/^言语/, ['words']],
    [/^判断与言语/, ['logic','words']],
    [/^判断/, ['logic','science']],
    [/大作文/, ['writing']],
    [/^申论/, ['essay']],
    [/^政治|^时政/, ['politics']],
    [/^常识/, ['general','politics']],
    [/^下午/, ['test','essay']],
    [/^上午/, ['test']],
    [/^(行测|补弱)/, ['test','words','logic','data','numbers']]
  ];
  const fields = ['tasks', 'topics', 'planItems', 'planOrder', 'actual', 'notes', 'mood', 'focusSessions'];
  function localRead(key, fallback = {}) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function localWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  const guestKey = 'jingkao-journal-v1';
  const accountKey = id => `jingkao-account-${id}`;
  let data = localRead(guestKey);
  let pending = {};
  let user = null;
  let checking = true;
  let sending = null;
  let today = beijingDate(new Date());
  let selected = null;
  let currentView = 'today';
  let editing = false;
  let sorting = false;
  function findDay(iso) {
    return dateMap.get(iso) ?? makeDay(new Date(`${iso}T00:00:00Z`), {focus: '自定义计划', tasks: []});
  }
  function planDays() {
    const extra = Object.keys(data.planOrder ?? {}).filter(iso => !dateMap.has(iso) && /^\d{4}-\d{2}-\d{2}$/.test(iso));
    return [...dates, ...extra.map(findDay)].sort((a,b) => a.iso.localeCompare(b.iso));
  }
  function activeDay() {
    const iso = selected ?? today;
    return dateMap.has(iso) || Object.hasOwn(data.planOrder ?? {}, iso) ? findDay(iso) : null;
  }
  const taskKey = (day, id) => `${day.key}-${id}`;
  const defaultStarts = [540, 645, 810, 915, 1140, 1230];
  function planTasks(day) {
    const items = new Map();
    let previousEnd = 0;
    day.tasks.forEach(([title,,minutes], id) => {
      const separator = title.indexOf('：');
      const module = separator < 0 ? title : title.slice(0, separator);
      const original = separator < 0 ? '' : title.slice(separator + 1);
      const start = Math.max(defaultStarts[id] ?? 540, previousEnd + 15);
      const end = previousEnd = start + minutes;
      items.set(id, {id, module, original, start, end, ...data.planItems?.[taskKey(day,id)]});
    });
    const prefix = `${day.key}-p`;
    for (const [key, record] of Object.entries(data.planItems ?? {})) {
      if (!key.startsWith(prefix) || !record) continue;
      const id = key.slice(day.key.length + 1);
      items.set(id, {id, ...record});
    }
    const order = new Set([...(data.planOrder?.[day.iso] ?? []), ...items.keys()]);
    return [...order].map(id => items.get(id)).filter(item => item && !item.removed)
      .map(item => ({...item, topic: data.topics?.[taskKey(day,item.id)] ?? item.original}));
  }
  function taskTitle({module, topic}) {
    return topic ? `${module}：${topic}` : module;
  }
  const completed = (day, index) => !!data.tasks?.[taskKey(day, index)];
  const duration = minutes => `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  const secondsFor = (day, task) => Object.values(data.focusSessions ?? {})
    .filter(entry => entry?.day === day.iso && (task === undefined || task === entry.task))
    .reduce((sum, entry) => sum + (Number(entry.seconds) || 0), 0);
  const actualSeconds = day => (Number(data.actual?.[day.key]) || 0) * 60 + secondsFor(day);
  function studyDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${duration(minutes)} ${remainder} 秒` : duration(minutes);
  }

  async function api(path, method = 'GET', body) {
    const options = {method, credentials: 'same-origin', cache: 'no-store'};
    if (body !== undefined) {
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`/api/${path}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || '服务器暂时不可用，请重试');
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  function applyChanges(target, changes) {
    for (const field of fields) {
      for (const [key, value] of Object.entries(changes[field] ?? {})) {
        const entries = target[field] ??= {};
        if (value === null) delete entries[key];
        else entries[key] = value;
      }
    }
  }
  function persist() {
    if (user) localWrite(accountKey(user.id), {data, pending});
    else localWrite(guestKey, data);
  }
  function updateAuth() {
    el('authLabel').textContent = checking ? '检查登录状态…' : user?.username ?? '登录同步';
    el('authBtn').disabled = checking || !!user;
    el('authDot').classList.toggle('online', !!user);
    el('logoutBtn').hidden = !user;
  }
  function clearSession() {
    el('focusDialog').close();
    el('topicDialog').close();
    el('planDialog').close();
    user = null;
    pending = {};
    data = localRead(guestKey);
    updateAuth();
    render(true);
  }
  function sync() {
    if (sending) return sending;
    if (!user || !Object.keys(pending).length) return Promise.resolve(true);
    const changes = JSON.parse(JSON.stringify(pending));
    sending = api('state', 'PUT', {user_id: user.id, changes}).then(result => {
      for (const [field, entries] of Object.entries(changes)) {
        for (const [key, value] of Object.entries(entries)) {
          if (JSON.stringify(pending[field]?.[key]) === JSON.stringify(value)) delete pending[field][key];
        }
        if (!Object.keys(pending[field]).length) delete pending[field];
      }
      data = result.state;
      applyChanges(data, pending);
      persist();
      render();
      el('saveHint').textContent = '已同步到服务器';
      return true;
    }).catch(error => {
      if (error.status === 401 || error.status === 409) {
        clearSession();
        el('saveHint').textContent = '会话已变更，重新登录后继续同步';
      } else {
        el('saveHint').textContent = '已保存到本机，等待同步';
      }
      return false;
    }).finally(() => { sending = null; }).then(success => {
      if (success && Object.keys(pending).length) return sync();
      return success;
    });
    return sending;
  }
  function save(changes) {
    applyChanges(data, changes);
    if (user) {
      for (const [field, entries] of Object.entries(changes)) Object.assign(pending[field] ??= {}, entries);
    }
    persist();
    el('saveHint').textContent = user ? '已保存，正在同步…' : '已保存到本机，登录后可同步';
    render();
    return sync();
  }
  async function loadAccount(account) {
    const result = await api('state');
    const cached = localRead(accountKey(account.id));
    el('focusDialog').close();
    el('topicDialog').close();
    el('planDialog').close();
    user = account;
    data = result.state ?? {};
    pending = cached.pending ?? {};
    if (result.updated_at === null) {
      for (const field of fields) {
        const entries = localRead(guestKey)[field];
        if (entries && Object.keys(entries).length) pending[field] = {...entries, ...pending[field]};
      }
    }
    applyChanges(data, pending);
    persist();
    render(true);
    el('saveHint').textContent = '已载入服务器记录';
    void sync();
  }
  async function restoreLogin() {
    try {
      const {user: account} = await api('me');
      await loadAccount(account);
    } catch (error) {
      if (error.status !== 401) el('saveHint').textContent = '暂时无法连接服务器';
    } finally {
      checking = false;
      updateAuth();
      render();
      tickFocus();
    }
  }
  function closeAuth() { el('authModal').classList.remove('open'); }
  el('authBtn').onclick = () => {
    el('authModal').classList.add('open');
    el('authMessage').textContent = '';
    el('usernameInput').value = localRead('jingkao-login-name', '');
    el('usernameInput').focus();
  };
  el('authClose').onclick = closeAuth;
  el('authModal').onclick = event => { if (event.target === el('authModal')) closeAuth(); };
  el('authForm').onsubmit = async event => {
    event.preventDefault();
    const remember = el('rememberInput').checked;
    el('authSubmit').disabled = true;
    el('authMessage').textContent = '';
    try {
      const {user: account} = await api('auth/login', 'POST', {
        username: el('usernameInput').value.trim(), password: el('passwordInput').value, remember
      });
      localWrite('jingkao-login-name', remember ? account.username : '');
      await loadAccount(account);
      updateAuth();
      closeAuth();
      tickFocus();
    } catch (error) {
      el('authMessage').textContent = error.status ? error.message : '服务器暂时不可用，请重试';
    } finally {
      el('passwordInput').value = '';
      el('authSubmit').disabled = false;
    }
  };
  el('logoutBtn').onclick = async () => {
    el('logoutBtn').disabled = true;
    try {
      if (!await sync()) return;
      await api('auth/logout', 'POST');
      clearSession();
      el('saveHint').textContent = '已退出登录';
    } catch {
      el('saveHint').textContent = '退出失败，请重试';
    } finally {
      el('logoutBtn').disabled = false;
    }
  };

  function refreshDate() {
    const time = new Date();
    const date = beijingDate(time);
    el('dateChip').textContent = labelFormat.format(time);
    if (date === today) return;
    today = date;
    if (selected === today) selected = null;
    render(!selected);
  }
  function openView(view, day = null) {
    const changed = day !== selected;
    if (changed || currentView !== view) sorting = false;
    selected = day;
    currentView = view;
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
    render(changed);
  }
  function openDay(day) {
    refreshDate();
    if (day.iso > today) {
      el('dateDialogMessage').textContent = `${day.label}开放学习记录。`;
      el('dateDialog').showModal();
      return;
    }
    openView('today', day.iso === today ? null : day.iso);
    el('todayView').scrollIntoView({block: 'start'});
  }
  let editingTopic = null;
  function saveTaskPatch(day, item, patch) {
    const key = taskKey(day, item.id);
    return save({planItems: {[key]: {...data.planItems?.[key], ...patch}}});
  }
  function titleSelect(day, item, field) {
    const {id, module, original, topic} = item;
    const isModule = field === 'module';
    const current = item[field];
    const label = isModule ? '模块' : '考点';
    const select = document.createElement('select');
    select.className = 'topic-select';
    select.id = `${field}-${day.iso}-${id}`;
    select.setAttribute('aria-label', `${module}${label}`);
    select.disabled = checking;
    const groups = topicRules.find(([pattern]) => pattern.test(module))?.[1] ?? ['review'];
    const choices = new Set(isModule
      ? [module, ...moduleNames]
      : [original, topic, ...groups.flatMap(group => examTopics[group]), '']);
    for (const value of choices) select.add(new Option(value || '不填考点', value));
    const custom = new Option('自定义…', '__custom__');
    select.add(custom);
    select.value = current;
    select.onchange = () => {
      if (select.selectedOptions[0] === custom) {
        select.value = current;
        editingTopic = {day, item, field, control: select.id};
        el('topicDialogTitle').textContent = `自定义${label}`;
        el('topicInputLabel').textContent = `${label}名称`;
        el('topicTaskName').textContent = taskTitle(item);
        el('topicInput').setCustomValidity('');
        el('topicInput').value = current;
        el('topicDialog').showModal();
        el('topicInput').select();
      } else {
        saveTitle(day, item, field, select.value);
        el(select.id)?.focus();
      }
    };
    return select;
  }
  function saveTitle(day, item, field, value) {
    if (field === 'module') return saveTaskPatch(day, item, {module:value});
    const key = taskKey(day, item.id);
    return save({topics: {[key]:value === item.original ? null : value}});
  }
  el('topicForm').onsubmit = event => {
    event.preventDefault();
    if (!editingTopic) return;
    const input = el('topicInput');
    const value = input.value.trim();
    input.setCustomValidity(value ? '' : '请输入名称');
    if (!input.reportValidity()) return;
    const {day, item, field} = editingTopic;
    void saveTitle(day, item, field, value);
    el('topicDialog').close();
  };
  el('topicInput').oninput = event => event.target.setCustomValidity('');
  el('topicCancel').onclick = () => el('topicDialog').close();
  el('topicDialog').addEventListener('close', () => {
    if (editingTopic) el(editingTopic.control)?.focus();
    editingTopic = null;
  });

  const timeText = minutes => `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
  const timeValue = input => { const [hours, minutes] = input.value.split(':').map(Number); return hours * 60 + minutes; };
  const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
  let editingPlan = null;
  function openPlanEditor(day, item = null) {
    editingPlan = {day, item};
    const endOfDay = Math.max(525, ...planTasks(day).map(task => task.end));
    const suggested = endOfDay + 60 < 1440 ? endOfDay + 15 : 540;
    el('planDialogTitle').textContent = item ? '设置起止时间' : '添加计划';
    el('planModuleLabel').hidden = el('planTopicLabel').hidden = !!item;
    el('planModule').disabled = el('planTopic').disabled = !!item;
    el('planModule').value = '';
    el('planTopic').value = '';
    el('planModule').setCustomValidity('');
    el('planEnd').setCustomValidity('');
    el('planStart').value = timeText(item?.start ?? suggested);
    el('planEnd').value = timeText(item?.end ?? suggested + 45);
    el('planDialog').showModal();
  }
  function moveTask(day, tasks, index, step) {
    const order = tasks.map(item => item.id);
    const other = index + step;
    [order[index], order[other]] = [order[other], order[index]];
    return save({planOrder:{[day.iso]:order}});
  }
  el('moduleOptions').append(...moduleNames.map(name => new Option(name)));
  el('planCancel').onclick = () => el('planDialog').close();
  el('planStart').oninput = el('planEnd').oninput = () => el('planEnd').setCustomValidity('');
  el('planModule').oninput = () => el('planModule').setCustomValidity('');
  el('addPlan').onclick = el('outsideAdd').onclick = () => openPlanEditor(activeDay() ?? findDay(today));
  el('sortPlan').onclick = () => { sorting = !sorting; renderToday(false); };
  el('planForm').onsubmit = event => {
    event.preventDefault();
    const {day,item} = editingPlan;
    const start = timeValue(el('planStart'));
    const end = timeValue(el('planEnd'));
    el('planEnd').setCustomValidity(end > start ? '' : '结束时间须晚于开始时间');
    if (!el('planEnd').reportValidity()) return;
    if (item) {
      void saveTaskPatch(day,item,{start,end});
    } else {
      const module = el('planModule').value.trim();
      el('planModule').setCustomValidity(module ? '' : '请输入模块名称');
      if (!el('planModule').reportValidity()) return;
      const id = `p${newId()}`;
      void save({
        planItems: {[taskKey(day,id)]:{module, original:el('planTopic').value.trim(), start,end}},
        planOrder: {[day.iso]:[...planTasks(day).map(task => task.id),id]}
      });
    }
    el('planDialog').close();
  };

  function renderToday(resetForm) {
    const day = activeDay();
    el('dayContent').hidden = !day;
    el('outsidePlan').hidden = !!day;
    el('outsidePlanText').textContent = today < dates[0].iso ? `计划从 ${dates[0].label}开始。` : '18 天计划已结束，可在计划列表中查看以往记录。';
    el('dayTitle').textContent = day?.focus ?? '京考冲刺计划';
    el('dayTag').textContent = day && day.index >= 0 ? `第 ${day.index + 1} / ${dates.length} 天` : '';
    el('unplannedFocus').hidden = !!selected;
    el('unplannedFocus').disabled = el('outsideFocus').disabled = el('addPlan').disabled = el('outsideAdd').disabled = checking;
    renderUnplanned(day?.iso ?? today);
    if (!day) {
      el('outsideActual').textContent = `今日实际学习 ${studyDuration(secondsFor({iso:today}))}`;
      return;
    }
    el('dayHeading').textContent = selected ? '当天学习任务' : '今天要做的事';
    el('dayLabel').textContent = day.label;
    const tasks = planTasks(day);
    el('sortPlan').hidden = !tasks.length;
    el('sortPlan').disabled = checking;
    el('sortPlan').textContent = sorting ? '完成排序' : '排序与删除';
    el('sortPlan').setAttribute('aria-pressed',sorting);
    el('todayDone').textContent = `${tasks.filter(item => completed(day, item.id)).length} / ${tasks.length}`;
    el('plannedHours').textContent = duration(tasks.reduce((sum, item) => sum + item.end - item.start, 0));
    el('plannedSlots').textContent = `${tasks.length} 个学习时段`;
    el('actualHours').textContent = studyDuration(actualSeconds(day));
    const list = el('todayTasks');
    list.replaceChildren();
    tasks.forEach((item, index) => {
      const row = document.createElement('div');
      const done = completed(day, item.id);
      const seconds = secondsFor(day, item.id);
      row.className = `task${done ? ' done' : ''}`;
      row.innerHTML = `<button class="check" aria-label="${done ? '取消完成' : '标记完成'}" aria-pressed="${done}">✓</button>
        <div class="task-title"></div>
        <div class="task-actions"><span class="task-duration">${item.end - item.start} 分钟</span><button class="focus-button">${seconds ? `已专注 ${clock(seconds)}` : '专注'}</button></div>`;
      row.querySelector('.task-title').append(titleSelect(day,item,'module'),'：',titleSelect(day,item,'topic'));
      row.querySelector('.check').disabled = checking;
      row.querySelector('.focus-button').disabled = checking;
      row.querySelector('.check').onclick = () => save({tasks: {[taskKey(day,item.id)]: done ? null : true}});
      row.querySelector('.focus-button').onclick = () => openFocus(day,item.id);
      if (sorting) {
        const controls = document.createElement('div');
        controls.className = 'plan-edit-group';
        controls.innerHTML = '<button type="button" class="plan-edit" aria-label="上移">↑</button><button type="button" class="plan-edit" aria-label="下移">↓</button><button type="button" class="plan-edit danger">删除</button>';
        const [up,down,remove] = controls.children;
        up.disabled = index === 0 || checking;
        down.disabled = index === tasks.length - 1 || checking;
        remove.disabled = checking;
        up.onclick = () => moveTask(day,tasks,index,-1);
        down.onclick = () => moveTask(day,tasks,index,1);
        remove.onclick = () => {
          if (confirm(`删除「${taskTitle(item)}」这条计划？`)) void saveTaskPatch(day,item,{removed:true});
        };
        row.querySelector('.task-actions').append(controls);
      }
      list.append(row);
    });
    const timeline = el('timeline');
    timeline.replaceChildren();
    for (const item of tasks) {
      const row = document.createElement('div');
      row.className = 'timeline-item';
      row.innerHTML = '<i class="timeline-dot"></i><div><button type="button" class="plan-edit timeline-time"></button><span></span></div>';
      const button = row.querySelector('button');
      button.textContent = `${timeText(item.start)}–${timeText(item.end)} · ${item.end - item.start} 分钟`;
      button.disabled = checking;
      button.onclick = () => openPlanEditor(day,item);
      row.querySelector('span').textContent = taskTitle(item);
      timeline.append(row);
    }
    if (!tasks.length) timeline.textContent = '当天暂无计划。';
    if (resetForm) editing = false;
    if (!editing) {
      el('minutesInput').value = data.actual?.[day.key] ?? '';
      el('noteInput').value = data.notes?.[day.key] ?? '';
    }
    el('saveBtn').disabled = el('resetBtn').disabled = checking;
    document.querySelectorAll('.mood').forEach(button => {
      const active = button.dataset.mood === data.mood?.[day.key];
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', active);
      button.disabled = checking;
    });
  }
  function renderUnplanned(iso) {
    const entries = Object.values(data.focusSessions ?? {})
      .filter(entry => entry?.day === iso && entry.task === null);
    el('unplannedCard').hidden = !entries.length;
    const list = el('unplannedList');
    list.replaceChildren();
    for (const entry of entries.reverse()) {
      const item = document.createElement('li');
      const content = document.createElement('span');
      content.textContent = entry.content || '无计划专注';
      const time = document.createElement('time');
      time.dateTime = `PT${entry.seconds}S`;
      time.textContent = clock(entry.seconds);
      item.append(content, time);
      list.append(item);
    }
  }
  function renderPlan() {
    const query = el('planSearch').value.trim().toLowerCase();
    const filter = document.querySelector('.filter.active').dataset.filter;
    const list = el('planList');
    list.replaceChildren();
    for (const day of planDays()) {
      const tasks = planTasks(day);
      const done = tasks.filter(item => completed(day,item.id)).length;
      const finished = tasks.length > 0 && done === tasks.length;
      const titles = tasks.map(taskTitle);
      if (!`${day.focus} ${titles.join(' ')}`.toLowerCase().includes(query)) continue;
      if (filter !== 'all' && (filter === '已完成') !== finished) continue;
      const button = document.createElement('button');
      button.className = 'day-row';
      button.type = 'button';
      const status = day.iso > today ? ' · 未开始' : day.iso === today ? ' · 今天' : '';
      button.innerHTML = `<span class="day-date">${day.index >= 0 ? `第 ${day.index + 1} 天` : '自定义'}<small>${day.label}</small></span>
        <span class="day-focus">${day.focus}<span class="day-topics"></span></span>
        <span class="day-progress"><span class="mini-progress"><i style="width:${tasks.length ? done / tasks.length * 100 : 0}%"></i></span><small>${done}/${tasks.length}${status}</small></span>`;
      button.onclick = () => openDay(day);
      button.querySelector('.day-topics').textContent = titles.slice(0,3).join(' · ');
      list.append(button);
    }
    if (!list.childElementCount) list.innerHTML = '<p class="plan-empty">没有符合条件的计划。</p>';
  }
  const groups = [
    ['资料分析', /资料/], ['数量关系', /数量/], ['言语理解', /言语/],
    ['判断推理', /判断|推理|图形|图推/], ['申论', /申论|作文/],
    ['常识时政', /常识|时政|政治/], ['综合与复盘', /./]
  ];
  function renderSummary() {
    const counts = groups.map(() => [0, 0]);
    let streak = 0;
    let seconds = 0;
    const days = planDays();
    const planDates = new Set(days.map(day => day.iso));
    for (const entry of Object.values(data.focusSessions ?? {})) {
      if (entry?.task === null && !planDates.has(entry.day)) seconds += Number(entry.seconds) || 0;
    }
    for (const day of days) {
      const dailySeconds = actualSeconds(day);
      let tracked = dailySeconds > 0 || !!data.notes?.[day.key];
      planTasks(day).forEach(item => {
        const count = counts[groups.findIndex(([, pattern]) => pattern.test(item.module))];
        count[1]++;
        if (completed(day,item.id)) { count[0]++; tracked = true; }
      });
      seconds += dailySeconds;
      if (day.iso < today || (day.iso === today && tracked)) streak = tracked ? streak + 1 : 0;
    }
    const done = counts.reduce((sum, count) => sum + count[0], 0);
    const planned = counts.reduce((sum, count) => sum + count[1], 0);
    const percent = planned ? Math.round(done / planned * 100) : 0;
    el('overallScore').textContent = `${percent}%`;
    el('overallBar').style.width = `${percent}%`;
    el('scoreNote').textContent = `已完成 ${done} / ${planned} 项`;
    el('moduleBars').innerHTML = counts.map(([finished, total], i) => {
      const value = total ? Math.round(finished / total * 100) : 0;
      return `<div class="bar-row"><span>${groups[i][0]}</span><div class="bar"><i style="width:${value}%"></i></div><b>${value}%</b></div>`;
    }).join('');
    el('reviewHours').textContent = studyDuration(seconds);
    el('streak').textContent = `${streak} 天`;
    el('insightText').textContent = `已完成 ${done} 项任务，累计学习 ${studyDuration(seconds)}。`;
  }
  function render(resetForm = false) {
    renderToday(resetForm);
    if (currentView === 'plan') renderPlan();
    renderSummary();
    updateFocusEntry();
  }

  const timerKey = () => `jingkao-focus-${user?.id ?? 'guest'}`;
  function timerForAccount() {
    const timer = localRead(timerKey(),null);
    if (!timer || typeof timer.elapsedMs === 'number') return timer;
    // Preserve elapsed time on countdowns that were open before the update.
    const {endsAt, remainingMs, durationMs, ...session} = timer;
    const time = Date.now();
    const left = endsAt === null ? remainingMs : Math.max(0,endsAt - time);
    const migrated = {...session, elapsedMs:Math.max(0,durationMs - left), startedAt:endsAt !== null && left > 0 ? time : null};
    localWrite(timerKey(),migrated);
    return migrated;
  }
  let focusTask = null;
  let pauseRequest = null;
  const elapsed = timer => timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, Date.now() - timer.startedAt));
  function clock(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function updateFocusEntry(timer = timerForAccount()) {
    el('resumeFocus').hidden = !timer || checking;
    el('resumeFocus').textContent = timer?.finished ? '完成专注记录' : '返回专注';
  }
  function renderFocus(timer) {
    const finished = !!timer?.finished;
    const seconds = Math.floor((timer ? elapsed(timer) : 0) / 1000);
    const paused = timer?.startedAt === null;
    const confirmingPause = !!timer && pauseRequest === timer.id && !paused && !finished;
    el('focusClock').textContent = clock(seconds);
    el('focusControls').hidden = confirmingPause;
    el('focusPausePrompt').hidden = !confirmingPause;
    el('focusFinish').hidden = !timer || finished;
    el('focusToggle').hidden = finished;
    el('focusToggle').textContent = !timer ? '开始专注' : paused ? '继续' : '暂停';
    el('focusNoteLabel').hidden = el('focusNote').disabled = el('focusSave').hidden = !finished;
    if (finished && el('focusNote').value !== (timer.content ?? '')) el('focusNote').value = timer.content ?? '';
  }
  function tickFocus() {
    if (checking) return;
    const timer = timerForAccount();
    updateFocusEntry(timer);
    if (timer && el('focusDialog').open) renderFocus(timer);
  }
  function openFocus(day, task) {
    const timer = timerForAccount();
    pauseRequest = null;
    const anotherTask = timer && (timer.day !== day.iso || timer.task !== task);
    focusTask = timer ? {day: timer.day, task: timer.task} : {day: day.iso, task};
    const plannedDay = findDay(focusTask.day);
    const item = planTasks(plannedDay).find(entry => entry.id === focusTask.task);
    const title = focusTask.task === null ? '无计划专注' : item ? taskTitle(item) : timer?.title ?? '计划专注';
    el('focusTitle').textContent = title;
    focusTask.title = title;
    el('focusStatus').textContent = timer?.finished ? '本次计时已结束。'
      : anotherTask ? '已有专注计时，请先结束这次专注。'
      : timer ? (timer.startedAt === null ? '已暂停' : '专注中') : '';
    renderFocus(timer);
    el('focusDialog').showModal();
    tickFocus();
  }
  function finishFocus(timer) {
    const seconds = Math.floor(elapsed(timer) / 1000);
    if (seconds > 0 && !data.focusSessions?.[timer.id]) {
      void save({focusSessions: {[timer.id]: {day: timer.day, task: timer.task, seconds}}});
    }
    localWrite(timerKey(), null);
    updateFocusEntry(null);
    el('focusClock').textContent = clock(seconds);
    el('focusStatus').textContent = seconds ? `已记录 ${clock(seconds)} 专注时间。` : '本次专注不足 1 秒。';
    el('focusToggle').hidden = true;
    el('focusFinish').hidden = true;
    if (el('focusDialog').open) el('focusClose').focus();
  }
  function stopUnplanned(timer) {
    timer.elapsedMs = elapsed(timer);
    timer.startedAt = null;
    timer.finished = true;
    localWrite(timerKey(), timer);
    updateFocusEntry(timer);
    renderFocus(timer);
    el('focusStatus').textContent = '本次计时已结束。';
    el('focusNote').focus();
  }
  function saveUnplanned(timer) {
    const seconds = Math.floor(timer.elapsedMs / 1000);
    if (!data.focusSessions?.[timer.id]) {
      void save({focusSessions: {[timer.id]: {
        day: timer.day, task: null, seconds, content: el('focusNote').value.trim()
      }}});
    }
    localWrite(timerKey(), null);
    updateFocusEntry(null);
    el('focusDialog').close();
  }
  el('focusForm').onsubmit = event => {
    event.preventDefault();
    const timer = timerForAccount();
    if (timer?.finished) {
      saveUnplanned(timer);
      return;
    }
    if (el('focusToggle').hidden) return;
    if (timer && timer.startedAt !== null) {
      pauseRequest = timer.id;
      renderFocus(timer);
      el('focusPauseCancel').focus();
      return;
    }
    const running = {...(timer ?? {...focusTask,id:newId(),elapsedMs:0}), startedAt:Date.now()};
    localWrite(timerKey(), running);
    el('focusStatus').textContent = '专注中';
    renderFocus(running);
    tickFocus();
  };
  function answerPause(confirmed) {
    const timer = timerForAccount();
    if (confirmed && timer && timer.id === pauseRequest && timer.startedAt !== null && !timer.finished) {
      timer.elapsedMs = elapsed(timer);
      timer.startedAt = null;
      localWrite(timerKey(), timer);
      el('focusStatus').textContent = '已暂停';
    }
    pauseRequest = null;
    renderFocus(timer);
    el(timer?.finished ? 'focusSave' : 'focusToggle').focus();
  }
  el('focusPauseCancel').onclick = () => answerPause(false);
  el('focusPauseConfirm').onclick = () => answerPause(true);
  el('focusDialog').addEventListener('cancel', event => {
    if (el('focusPausePrompt').hidden) return;
    event.preventDefault();
    answerPause(false);
  });
  el('focusNote').oninput = event => {
    const timer = timerForAccount();
    if (timer?.finished) localWrite(timerKey(), {...timer, content: event.target.value});
  };
  el('focusFinish').onclick = () => {
    const timer = timerForAccount();
    if (!timer) return;
    if (timer.task === null) stopUnplanned(timer);
    else finishFocus(timer);
  };
  el('focusClose').onclick = () => el('focusDialog').close();
  el('resumeFocus').onclick = () => {
    const timer = timerForAccount();
    if (timer) openFocus({iso:timer.day}, timer.task);
  };
  el('unplannedFocus').onclick = el('outsideFocus').onclick = () => {
    refreshDate();
    openFocus({iso:today}, null);
  };

  document.querySelectorAll('.tab').forEach(button => {
    button.onclick = () => { refreshDate(); openView(button.dataset.view); };
  });
  document.querySelectorAll('.filter').forEach(button => {
    button.onclick = () => {
      document.querySelector('.filter.active').classList.remove('active');
      button.classList.add('active');
      renderPlan();
    };
  });
  el('planSearch').oninput = renderPlan;
  document.querySelectorAll('.mood').forEach(button => {
    button.onclick = () => save({mood: {[activeDay().key]: button.dataset.mood}});
  });
  el('minutesInput').oninput = el('noteInput').oninput = () => { editing = true; };
  el('saveBtn').onclick = () => {
    const input = el('minutesInput');
    if (!input.reportValidity()) return;
    const key = activeDay().key;
    editing = false;
    return save({actual: {[key]: input.value === '' ? null : Number(input.value)}, notes: {[key]: el('noteInput').value || null}});
  };
  el('resetBtn').onclick = () => {
    const day = activeDay();
    if (!confirm(`清空 ${day.label}的任务、专注和复盘记录？`)) return;
    editing = false;
    if (timerForAccount()?.day === day.iso) localWrite(timerKey(), null);
    return save({
      tasks: Object.fromEntries(Object.keys(data.tasks ?? {}).filter(key => key.startsWith(`${day.key}-`)).map(key => [key,null])),
      actual: {[day.key]: null}, mood: {[day.key]: null}, notes: {[day.key]: null},
      focusSessions: Object.fromEntries(Object.entries(data.focusSessions ?? {}).filter(([, record]) => record?.day === day.iso).map(([id]) => [id, null]))
    });
  };
  function refresh() {
    refreshDate();
    tickFocus();
    if (navigator.onLine) void sync();
  }
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  updateAuth();
  refreshDate();
  render(true);
  void restoreLogin();
  setInterval(tickFocus, 250);
  setInterval(refresh, 15000);
