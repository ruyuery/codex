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
  const dates = phases.map((phase, index) => {
    const date = new Date(Date.UTC(2026, 10, 18 + index));
    // Earlier versions used the UTC date of Beijing midnight as the storage key.
    return {
      ...phase, index, iso: beijingDate(date), label: labelFormat.format(date),
      key: new Date(date.getTime() - 86400000).toISOString().slice(0, 10)
    };
  });
  const fields = ['tasks', 'actual', 'notes', 'mood', 'focusSessions'];
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
  const activeDay = () => dates.find(day => day.iso === (selected ?? today));
  const taskKey = (day, index) => `${day.key}-${index}`;
  const completed = (day, index) => !!data.tasks?.[taskKey(day, index)];
  const duration = minutes => `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  const secondsFor = (day, task) => Object.values(data.focusSessions ?? {})
    .filter(entry => entry?.day === day.iso && (task === undefined || task === entry.task))
    .reduce((sum, entry) => sum + (Number(entry.seconds) || 0), 0);
  const actual = day => (Number(data.actual?.[day.key]) || 0) + Math.floor(secondsFor(day) / 60);

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
  function renderToday(resetForm) {
    const day = activeDay();
    el('dayContent').hidden = !day;
    el('outsidePlan').hidden = !!day;
    el('outsidePlan').textContent = today < dates[0].iso ? `计划从 ${dates[0].label}开始。` : '18 天计划已结束，可在计划列表中查看以往记录。';
    el('dayTitle').textContent = day?.focus ?? '京考冲刺计划';
    el('dayTag').textContent = day ? `第 ${day.index + 1} / ${dates.length} 天` : '';
    if (!day) return;
    el('dayHeading').textContent = selected ? '当天学习任务' : '今天要做的事';
    el('dayLabel').textContent = day.label;
    el('todayDone').textContent = `${day.tasks.filter((_, i) => completed(day, i)).length} / ${day.tasks.length}`;
    el('plannedHours').textContent = duration(day.tasks.reduce((sum, task) => sum + task[2], 0));
    el('actualHours').textContent = duration(actual(day));
    const list = el('todayTasks');
    list.replaceChildren();
    day.tasks.forEach(([title, description, minutes], i) => {
      const row = document.createElement('div');
      const done = completed(day, i);
      const seconds = secondsFor(day, i);
      row.className = `task${done ? ' done' : ''}`;
      row.innerHTML = `<button class="check" aria-label="${done ? '取消完成' : '标记完成'}" aria-pressed="${done}">✓</button>
        <div><div class="task-title">${title}</div><div class="task-meta">${description}${seconds ? ` · 已专注 ${clock(seconds)}` : ''}</div></div>
        <div class="task-actions"><span class="task-duration">${minutes} 分钟</span><button class="focus-button">专注</button></div>`;
      row.querySelector('.check').disabled = checking;
      row.querySelector('.focus-button').disabled = checking;
      row.querySelector('.check').onclick = () => save({tasks: {[taskKey(day, i)]: done ? null : true}});
      row.querySelector('.focus-button').onclick = () => openFocus(day, i);
      list.append(row);
    });
    const starts = [540, 645, 810, 915, 1140, 1230];
    const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
    let end = 0;
    el('timeline').innerHTML = day.tasks.map(([title,,minutes], i) => {
      const start = Math.max(starts[i], end + 15);
      end = start + minutes;
      return `<div class="timeline-item"><i class="timeline-dot"></i><div><strong>${time(start)}–${time(end)} · ${minutes} 分钟</strong><span>${title}</span></div></div>`;
    }).join('');
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
  function renderPlan() {
    const query = el('planSearch').value.trim().toLowerCase();
    const filter = document.querySelector('.filter.active').dataset.filter;
    const list = el('planList');
    list.replaceChildren();
    for (const day of dates) {
      const done = day.tasks.filter((_, i) => completed(day, i)).length;
      const finished = done === day.tasks.length;
      if (!(day.focus + day.tasks.flat().join(' ')).toLowerCase().includes(query)) continue;
      if (filter !== 'all' && (filter === '已完成') !== finished) continue;
      const button = document.createElement('button');
      button.className = 'day-row';
      button.type = 'button';
      const status = day.iso > today ? ' · 未开始' : day.iso === today ? ' · 今天' : '';
      button.innerHTML = `<span class="day-date">第 ${day.index + 1} 天<small>${day.label}</small></span>
        <span class="day-focus">${day.focus}<span>${day.tasks.slice(0,3).map(task => task[0]).join(' · ')}</span></span>
        <span class="day-progress"><span class="mini-progress"><i style="width:${done / day.tasks.length * 100}%"></i></span><small>${done}/${day.tasks.length}${status}</small></span>`;
      button.onclick = () => openDay(day);
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
    let minutes = 0;
    for (const day of dates) {
      const dailyMinutes = actual(day);
      let tracked = dailyMinutes > 0 || !!data.notes?.[day.key];
      day.tasks.forEach(([title], i) => {
        const count = counts[groups.findIndex(([, pattern]) => pattern.test(title))];
        count[1]++;
        if (completed(day, i)) { count[0]++; tracked = true; }
      });
      minutes += dailyMinutes;
      if (day.iso < today || (day.iso === today && tracked)) streak = tracked ? streak + 1 : 0;
    }
    const done = counts.reduce((sum, count) => sum + count[0], 0);
    const planned = counts.reduce((sum, count) => sum + count[1], 0);
    const percent = Math.round(done / planned * 100);
    el('overallScore').textContent = `${percent}%`;
    el('overallBar').style.width = `${percent}%`;
    el('scoreNote').textContent = `已完成 ${done} / ${planned} 项`;
    el('moduleBars').innerHTML = counts.map(([finished, total], i) => {
      const value = total ? Math.round(finished / total * 100) : 0;
      return `<div class="bar-row"><span>${groups[i][0]}</span><div class="bar"><i style="width:${value}%"></i></div><b>${value}%</b></div>`;
    }).join('');
    el('reviewHours').textContent = duration(minutes);
    el('streak').textContent = `${streak} 天`;
    el('insightText').textContent = `已完成 ${done} 项任务，累计学习 ${duration(minutes)}。`;
  }
  function render(resetForm = false) {
    renderToday(resetForm);
    if (currentView === 'plan') renderPlan();
    renderSummary();
    updateFocusEntry();
  }

  const timerKey = () => `jingkao-focus-${user?.id ?? 'guest'}`;
  const timerForAccount = () => localRead(timerKey(), null);
  let focusTask = null;
  const remaining = timer => Math.max(0, timer.endsAt === null ? timer.remainingMs : timer.endsAt - Date.now());
  function clock(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function updateFocusEntry(timer = timerForAccount()) {
    el('resumeFocus').hidden = !timer || checking;
  }
  function renderFocus(timer) {
    const left = timer ? remaining(timer) : (Number(el('focusMinutes').value) || 0) * 60000;
    el('focusClock').textContent = clock(Math.ceil(left / 1000));
    el('focusProgress').value = timer ? 1 - left / timer.durationMs : 0;
    el('focusDurationLabel').hidden = !!timer;
    el('focusMinutes').disabled = !!timer;
    el('focusFinish').hidden = !timer;
    el('focusToggle').hidden = false;
    el('focusToggle').textContent = !timer ? '开始专注' : timer.endsAt === null ? '继续' : '暂停';
  }
  function tickFocus() {
    if (checking) return;
    const timer = timerForAccount();
    if (timer && remaining(timer) === 0) {
      finishFocus(timer);
      return;
    }
    updateFocusEntry(timer);
    if (timer && el('focusDialog').open) renderFocus(timer);
  }
  function openFocus(day, task) {
    const timer = timerForAccount();
    const anotherTask = timer && (timer.day !== day.iso || timer.task !== task);
    focusTask = timer ? {day: timer.day, task: timer.task} : {day: day.iso, task};
    const [title,,minutes] = dates.find(date => date.iso === focusTask.day).tasks[focusTask.task];
    el('focusTitle').textContent = title;
    el('focusMinutes').value = minutes;
    el('focusStatus').textContent = anotherTask ? '已有专注计时，请先结束这次专注。' : '';
    renderFocus(timer);
    el('focusDialog').showModal();
    tickFocus();
  }
  function finishFocus(timer) {
    const seconds = Math.floor((timer.durationMs - remaining(timer)) / 1000);
    if (seconds > 0 && !data.focusSessions?.[timer.id]) {
      void save({focusSessions: {[timer.id]: {day: timer.day, task: timer.task, seconds}}});
    }
    localWrite(timerKey(), null);
    updateFocusEntry(null);
    el('focusClock').textContent = clock(seconds);
    el('focusProgress').value = 1;
    el('focusStatus').textContent = seconds ? `已记录 ${clock(seconds)} 专注时间。` : '本次专注不足 1 秒。';
    el('focusToggle').hidden = true;
    el('focusFinish').hidden = true;
    if (el('focusDialog').open) el('focusClose').focus();
  }
  el('focusForm').onsubmit = event => {
    event.preventDefault();
    if (el('focusToggle').hidden) return;
    let timer = timerForAccount();
    if (!timer) {
      const durationMs = Number(el('focusMinutes').value) * 60000;
      timer = {
        ...focusTask, durationMs, remainingMs: durationMs, endsAt: Date.now() + durationMs,
        id: Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')
      };
    } else if (timer.endsAt === null) {
      timer.endsAt = Date.now() + timer.remainingMs;
    } else {
      timer.remainingMs = remaining(timer);
      timer.endsAt = null;
    }
    localWrite(timerKey(), timer);
    el('focusStatus').textContent = timer.endsAt === null ? '已暂停' : '专注中';
    renderFocus(timer);
    tickFocus();
  };
  el('focusMinutes').oninput = () => renderFocus(null);
  el('focusFinish').onclick = () => { const timer = timerForAccount(); if (timer) finishFocus(timer); };
  el('focusClose').onclick = () => el('focusDialog').close();
  el('resumeFocus').onclick = () => {
    const timer = timerForAccount();
    if (timer) openFocus(dates.find(day => day.iso === timer.day), timer.task);
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
      tasks: Object.fromEntries(day.tasks.map((_, i) => [taskKey(day, i), null])),
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
