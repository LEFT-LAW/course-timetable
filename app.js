/* 纯净课表 — 应用主逻辑（无框架） */
(function () {
  'use strict';

  var ImportLib = window.ImportLib;
  var XlsxLib = window.XlsxLib;

  var KEY = 'pureTimetable.v1';
  var WEEKDAY_CN = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  var PALETTE = [
    '#4f7cff', '#0fae7a', '#e0784f', '#9d6cf5', '#e0a020', '#12a5c8',
    '#e05a93', '#6c8a2f', '#e0605f', '#4a9bd8', '#7a6cf0', '#cf4f9e',
    '#2f8f5b', '#e0873a', '#3aa3a0', '#8f7ae0'
  ];

  var DEFAULT_PERIODS = [
    { s: '08:00', e: '08:45' }, { s: '08:55', e: '09:40' }, { s: '10:00', e: '10:45' },
    { s: '10:55', e: '11:40' }, { s: '14:00', e: '14:45' }, { s: '14:55', e: '15:40' },
    { s: '15:50', e: '16:35' }, { s: '16:55', e: '17:40' }, { s: '17:50', e: '18:35' },
    { s: '19:30', e: '20:15' }, { s: '20:25', e: '21:10' }, { s: '21:20', e: '22:05' }
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultState() {
    return {
      v: 1,
      termName: '',
      week1Monday: '',          // 'YYYY-MM-DD'
      totalWeeks: 18,
      periods: clone(DEFAULT_PERIODS),
      nextColor: 0,
      entries: []               // { id, code, name, teacher, credit, campus, day, start, end, weeks:[], location, color }
    };
  }

  var st = load();
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.entries)) return defaultState();
      if (!Array.isArray(o.periods) || !o.periods.length) o.periods = clone(DEFAULT_PERIODS);
      if (!o.totalWeeks) o.totalWeeks = 18;
      if (typeof o.nextColor !== 'number') o.nextColor = 0;
      o.v = 1;
      return o;
    } catch (e) { return defaultState(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 空间满等忽略 */ }
  }

  /* ---------------- 工具 ---------------- */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); }, ms || 2200);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayLocalISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayNumOfISO(iso) {
    var p = iso.split('-').map(Number);
    return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }
  function isoFromDays(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function termWeek1Days() {
    return st.week1Monday ? dayNumOfISO(st.week1Monday) : dayNumOfISO(mondayOfISO(todayLocalISO()));
  }
  function mondayOfISO(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    var wd = d.getUTCDay() || 7;
    var n = dayNumOfISO(iso) - (wd - 1);
    return isoFromDays(n);
  }
  function currentWeekNum() {
    return Math.floor((dayNumOfISO(todayLocalISO()) - termWeek1Days()) / 7) + 1;
  }
  function weekMondayDays(w) { return termWeek1Days() + (w - 1) * 7; }
  function mdCN(iso) {
    var p = iso.split('-');
    return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  }
  function entriesOfWeek(w) {
    return st.entries.filter(function (e) { return e.weeks.indexOf(w) >= 0; });
  }
  function sortEntries(list) {
    return list.slice().sort(function (a, b) { return (a.day - b.day) || (a.start - b.start) || (a.name < b.name ? -1 : 1); });
  }
  function nextColor() {
    var c = PALETTE[st.nextColor % PALETTE.length];
    st.nextColor = (st.nextColor + 1) % PALETTE.length;
    return c;
  }
  function genId() {
    return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function periodTime(idx) { var p = st.periods[idx - 1]; return p ? (p.s + '-' + p.e) : ''; }
  function periodStart(idx) { var p = st.periods[idx - 1]; return p ? p.s : ''; }

  function parseWeeksInput(text) {
    var w = ImportLib.expandWeeks(String(text || ''));
    return w;
  }
  function fmtWeekRange(w) { return ImportLib.compressWeeks(w); }

  /* 同一天内课程排布：计算每个卡片的列/宽度，避免完全重叠 */
  function layoutDay(dayEntries) {
    var items = dayEntries.slice().sort(function (a, b) { return (a.start - b.start) || (b.end - a.end); });
    var groups = [];            // 连通的重叠分量
    var actives = [];           // 当前分量内活跃条目
    items.forEach(function (e) {
      actives = actives.filter(function (x) { return x.end >= e.start; });
      if (!actives.length) { actives = [e]; groups.push([e]); }
      else { actives.push(e); groups[groups.length - 1].push(e); }
    });
    var out = {};
    groups.forEach(function (g) {
      var arr = g.slice().sort(function (a, b) { return (a.start - b.start) || (a.end - b.end); });
      var colEnds = [];
      var maxCon = 0;
      arr.forEach(function (e) {
        var c = 0;
        while (c < colEnds.length && colEnds[c] > e.start) c++;
        colEnds[c] = e.end;
        e._col = c;
        if (c + 1 > maxCon) maxCon = c + 1;
      });
      g.forEach(function (e) { out[e.id] = { n: maxCon, i: e._col }; });
    });
    return out;
  }

  /* ---------------- 状态变量 ---------------- */
  var TAB = 'week';
  var WEEK = clampWeek(currentWeekNum());
  var editingId = null;
  var draft = {};

  function clampWeek(w) {
    if (!w || w < 1) w = 1;
    if (w > Math.max(1, st.totalWeeks)) w = st.totalWeeks;
    return w;
  }

  /* ---------------- 渲染框架 ---------------- */
  var main = $('#main');

  function render() {
    if (TAB === 'week') renderWeek();
    else if (TAB === 'today') renderToday();
    else if (TAB === 'courses') renderCourses();
    else renderSettings();
    var tabs = document.querySelectorAll('#tabbar .tab');
    tabs.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === TAB);
    });
    $('#topAddBtn').classList.toggle('hidden', TAB === 'settings');
  }

  function switchTab(t) {
    TAB = t;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------------- 课表视图 ---------------- */
  var ROW_H = 42;
  var GAP_H = 30;                       // 大课间空隙高度（午/晚）
  var BREAKS = { 4: true, 9: true };    // 第4、9节后插入空隙
  // 第 p 节课顶部的 y 坐标（含前面所有空隙）
  function yStart(p) {
    var y = 0, i;
    for (i = 1; i < p; i++) {
      y += ROW_H;
      if (BREAKS[i]) y += GAP_H;
    }
    return y;
  }
  function gridTotalH(n) { return yStart(n) + ROW_H; }
  // 依据当前列宽自适应字体：让每行尽量容纳 4~5 个汉字，减少行数与错乱折行
  function measureFontSize() {
    var mw = main.clientWidth - 28;      // main 左右各 14px padding
    var colW = Math.max(30, (mw - 42) / 7); // 42px = 节次栏宽
    var fs = (colW - 6) / 4.8;
    return Math.max(8.5, Math.min(12, fs));
  }

  function renderWeek() {
    var today = todayLocalISO();
    var curWeek = currentWeekNum();
    var w1 = termWeek1Days();
    var monday = weekMondayDays(WEEK);
    var inTerm = (dayNumOfISO(today) - w1) >= 0;
    var html = '';
    var N = st.periods.length;

    if (!st.entries.length) {
      html += firstRunHTML();
      main.innerHTML = html;
      return;
    }

    var fs = measureFontSize();
    var nLH = +(fs * 1.28).toFixed(2);          // 课名行高
    var locF = Math.max(7.5, fs - 1.6);         // 地址字号略小
    var locLH = +(locF * 1.25).toFixed(2);      // 地址行高
    var locHpx = Math.ceil(locLH);

    html += '<div class="week-toolbar">'
      + '<div class="wk-nav"><button id="wkPrev" aria-label="上一周">‹</button><button id="wkNext" aria-label="下一周">›</button></div>'
      + '<div class="wk-label">第 ' + WEEK + ' 周<small>' + mdCN(isoFromDays(monday)) + ' – ' + mdCN(isoFromDays(monday + 6)) + '</small></div>'
      + '<button id="wkToday" class="chip-today' + (WEEK === curWeek ? ' active' : '') + '">本周</button>'
      + '</div>';

    html += '<div class="wk-wrap"><div class="days-hdr">';
    html += '<div class="gutter"></div>';
    for (var d = 1; d <= 7; d++) {
      var iso = isoFromDays(monday + d - 1);
      var isToday = inTerm && WEEK === curWeek && iso === today;
      var cls = (d === 6 || d === 7) ? 'sun' : '';
      html += '<div class="day-h ' + cls + (isToday ? ' today' : '') + '"><b>' + (isToday ? '今天' : WEEKDAY_CN[d]) + '</b>' + mdCN(iso) + '</div>';
    }
    html += '</div>';

    var weekEntries = entriesOfWeek(WEEK);
    html += '<div style="display:flex;align-items:stretch">';
    // 节次栏：每节显示 上课/下课 两行时间
    html += '<div class="grid-gutter">';
    for (var p = 1; p <= N; p++) {
      var pr = st.periods[p - 1];
      html += '<div class="gblk" style="top:' + yStart(p) + 'px;height:' + ROW_H + 'px">'
        + '<span class="t-up">' + esc(pr.s) + '</span>'
        + '<span class="t-dn">' + esc(pr.e) + '</span>'
        + '</div>';
    }
    html += '</div>';

    var todayCol = new Date().getDay() || 7;
    for (var d2 = 1; d2 <= 7; d2++) {
      var dayList = weekEntries.filter(function (e) { return e.day === d2; });
      var layout = layoutDay(dayList);
      html += '<div class="grid-col" style="height:' + gridTotalH(N) + 'px">';
      // 空格点击添加
      for (var p2 = 1; p2 <= N; p2++) {
        html += '<button class="gcell' + (WEEK === curWeek && d2 === todayCol ? ' is-today-col' : '') + '"'
          + ' data-add="' + d2 + ',' + p2 + '"'
          + ' style="top:' + yStart(p2) + 'px"' + ' aria-label="添加课程"></button>';
      }
      // 课程卡片：名称按“整行”裁切，地址独占最下一行，绝不与课名重叠
      dayList.forEach(function (e) {
        var pos = layout[e.id] || { n: 1, i: 0 };
        var leftPct = (100 / pos.n) * pos.i;
        var widthPct = 100 / pos.n;
        var top = yStart(e.start) + 2;
        var chipH = yStart(e.end) + ROW_H - yStart(e.start) - 4;
        var inner = chipH - 4;                    // 上下各 2px 内边距
        var budget = inner - (locHpx + 1);        // 留给课名的高度
        var showLoc = !!(e.location && budget >= nLH);
        if (!showLoc) budget = inner;
        var lines = Math.max(1, Math.floor(budget / nLH));
        var maxNameH = +(lines * nLH).toFixed(2);
        html += '<button class="course-chip" data-chip="' + e.id + '"'
          + ' style="background:' + e.color + ';color:#fff;top:' + top + 'px;height:' + chipH + 'px;left:' + leftPct.toFixed(3) + '%;width:' + widthPct.toFixed(3) + '%;padding:2px 3px">'
          + '<span class="c-name" style="font-size:' + fs.toFixed(2) + 'px;line-height:' + nLH + 'px;max-height:' + maxNameH + 'px;overflow:hidden;overflow-wrap:anywhere">' + esc(e.name) + '</span>'
          + (showLoc ? '<span class="c-loc" style="font-size:' + locF.toFixed(2) + 'px;line-height:' + locLH + 'px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(e.location) + '</span>' : '')
          + '</button>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    main.innerHTML = html;

    // 为每个“节”画行分隔线；大课间空隙的两侧各留一条线，间隙区不画线
    main.querySelectorAll('.grid-col').forEach(function (col) {
      var bounds = [];
      for (var p3 = 1; p3 <= N; p3++) {
        bounds.push(yStart(p3) + ROW_H - 1);            // 每节底部
        if (BREAKS[p3]) bounds.push(yStart(p3 + 1));    // 空隙结束处的下一节顶线
      }
      bounds.forEach(function (y) {
        var d = document.createElement('div');
        d.className = 'lsep';
        d.style.top = y + 'px';
        col.appendChild(d);
      });
    });

    // 课程名下若有空余，允许地址换行完整显示（绝不与课名重叠）
    main.querySelectorAll('.course-chip').forEach(function (chip) {
      var loc = chip.querySelector('.c-loc');
      if (!loc) return;
      if (loc.scrollWidth <= loc.clientWidth + 1) return;  // 单行放得下就不用换行
      var cs = window.getComputedStyle(loc);
      var lh = parseFloat(cs.lineHeight);
      var chipR = chip.getBoundingClientRect();
      var lR = loc.getBoundingClientRect();
      var locBottom = lR.bottom - chipR.top;              // 相对卡片顶部
      var spareLines = Math.floor((chipR.height - 2 - locBottom) / lh);
      if (spareLines > 0) {
        loc.style.whiteSpace = 'normal';
        loc.style.overflow = 'hidden';
        loc.style.textOverflow = 'clip';
        loc.style.maxHeight = ((spareLines + 1) * lh) + 'px';
      }
    });

    $('#wkPrev').addEventListener('click', function () { WEEK = clampWeek(WEEK - 1); render(); });
    $('#wkNext').addEventListener('click', function () { WEEK = clampWeek(WEEK + 1); render(); });
    $('#wkToday').addEventListener('click', function () {
      WEEK = clampWeek(currentWeekNum());
      render();
    });
  }

  function firstRunHTML() {
    return '<div class="panel lead">'
      + '<h3>还没有课程</h3>'
      + '<p>导入教务系统「选课导出」的 .xlsx 文件，或手动添加课程。</p>'
      + '<button id="frImport" class="btn" style="margin-bottom:10px">导入选课 .xlsx</button>'
      + '<button id="frAdd" class="btn secondary">手动添加课程</button>'
      + '</div>';
  }

  /* ---------------- 今日视图 ---------------- */
  function renderToday() {
    var today = todayLocalISO();
    var wk = currentWeekNum();
    var inTerm = (dayNumOfISO(today) - termWeek1Days()) >= 0;
    var html = '';
    if (!inTerm) {
      html += '<div class="panel lead"><p>本学期尚未开始或已结束（第 1 周周一 = ' + (st.week1Monday || '未设置') + '）。</p></div>';
      main.innerHTML = html; return;
    }
    var list = entriesOfWeek(wk).filter(function (e) { return e.day === (new Date().getDay() || 7); });
    html += '<div class="panel lead" style="padding:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span class="subtle">第 ' + wk + ' 周</span><b>' + mdCN(today) + '</b></div></div>';
    list = sortEntries(list);
    if (!list.length) {
      html += '<div class="empty-tip">今天没有课，好好休息 ✨</div>';
    } else {
      html += '<div>';
      list.forEach(function (e) {
        html += '<div class="course-item"><div class="bar" style="background:' + e.color + '"></div>'
          + '<div class="body"><div class="name">' + esc(e.name) + '</div>'
          + '<div class="meta">' + esc(e.location || '') + (e.teacher ? ' · ' + esc(e.teacher) : '') + '</div></div>'
          + '<div class="time">' + fmtWeekRange(e.weeks).replace('周', '') + '周<br>第' + e.start + '-' + e.end + '节 ' + periodTime(e.start).split('-')[0] + '</div>'
          + '</div>';
      });
      html += '</div>';
    }
    main.innerHTML = html;
  }

  /* ---------------- 课程列表 ---------------- */
  function renderCourses() {
    var all = sortEntries(st.entries);
    var html = '';
    if (!all.length) {
      html += '<div class="empty-tip">还没有课程。<br><br><button class="btn" id="emptyAdd" style="max-width:240px">手动添加</button></div>';
      main.innerHTML = html;
      $('#emptyAdd').addEventListener('click', function () { openCourseModal(null); });
      return;
    }
    html += '<div>';
    all.forEach(function (e) {
      html += '<button class="course-item" data-chip="' + e.id + '" style="width:100%;border:none;background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:8px;text-align:left">'
        + '<div class="bar" style="background:' + e.color + '"></div>'
        + '<div class="body"><div class="name">' + esc(e.name)
        + (e.code ? ' <span class="subtle">' + esc(e.code) + '</span>' : '') + '</div>'
        + '<div class="meta">' + WEEKDAY_CN[e.day] + ' · 第' + e.start + '-' + e.end + '节 · ' + fmtWeekRange(e.weeks)
        + (e.location ? ' · ' + esc(e.location) : '') + '</div></div></button>';
    });
    html += '</div>';
    main.innerHTML = html;
  }

  /* ---------------- 设置视图 ---------------- */
  function renderSettings() {
    var html = '<div class="panel"><h2>学期</h2>';
    html += '<div class="field"><label>学期名称</label><input type="text" id="sName" value="' + esc(st.termName) + '" placeholder="如 2026-2027-1"></div>';
    html += '<div class="row2">'
      + '<div class="field"><label>第 1 周周一</label><input type="date" id="sMonday" value="' + esc(st.week1Monday) + '"></div>'
      + '<div class="field"><label>总周数</label><input type="number" id="sWeeks" min="1" max="40" value="' + st.totalWeeks + '"></div>'
      + '</div>';
    html += '<button id="sSave" class="btn">保存学期设置</button></div>';

    html += '<div class="panel"><h2>课时表（节次起止时间）</h2>';
    for (var i = 0; i < st.periods.length; i++) {
      var p = st.periods[i];
      html += '<div class="period-line"><span>第 ' + (i + 1) + ' 节</span>'
        + '<input type="time" data-p="' + i + '" class="perStart" value="' + esc(p.s) + '">'
        + '<span class="subtle">至</span>'
        + '<input type="time" data-p="' + i + '" class="perEnd" value="' + esc(p.e) + '">'
        + '</div>';
    }
    html += '<div style="height:8px"></div><button id="perReset" class="btn secondary">恢复默认时间</button></div>';

    html += '<div class="panel"><h2>数据</h2>';
    html += '<button id="impXlsx" class="btn" style="margin-bottom:8px">导入选课 .xlsx</button>';
    html += '<button id="expJson" class="btn secondary" style="margin-bottom:8px">导出备份 (.json)</button>';
    html += '<button id="impJson" class="btn secondary" style="margin-bottom:8px">导入备份 (.json)</button>';
    html += '<button id="clearAll" class="btn danger">清空全部数据</button>';
    html += '<div class="tagline">共 ' + st.entries.length + ' 条课程记录 · 数据仅保存在本机浏览器，可导出备份。</div>'
      + '</div>';

    html += '<div class="panel"><h2>关于</h2>'
      + '<div class="subtle">纯净课表 · 离线 PWA。iPhone 用 Safari 打开部署地址后，通过「分享 → 添加到主屏幕」安装。导入文件需为教务系统「选课导出」格式。</div>'
      + '</div>';

    main.innerHTML = html;

    $('#sSave').addEventListener('click', function () {
      var name = $('#sName').value.trim();
      var monday = $('#sMonday').value;
      var tw = parseInt($('#sWeeks').value, 10);
      st.termName = name;
      if (monday) st.week1Monday = monday;
      if (tw && tw >= 1 && tw <= 40) st.totalWeeks = tw;
      save();
      toast('已保存');
    });
    $('#perReset').addEventListener('click', function () {
      if (confirm('恢复默认的 12 节课时间？')) {
        st.periods = clone(DEFAULT_PERIODS);
        save(); renderSettings(); toast('已恢复默认');
      }
    });
    $('#impXlsx').addEventListener('click', function () { $('#fileXlsx').click(); });
    $('#expJson').addEventListener('click', exportJSON);
    $('#impJson').addEventListener('click', function () { $('#fileJson').click(); });
    $('#clearAll').addEventListener('click', function () {
      if (confirm('确定清空全部课程与设置？此操作不可恢复（建议先导出备份）。')) {
        localStorage.removeItem(KEY);
        st = defaultState();
        WEEK = clampWeek(currentWeekNum());
        render();
        toast('已清空');
      }
    });
  }

  /* ---------------- 导出 / 导入 JSON ---------------- */
  function exportJSON() {
    var blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'timetable-' + todayLocalISO() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  /* ---------------- 课程编辑弹窗 ---------------- */
  function openCourseModal(entryOrNull, preset) {
    var isEdit = !!entryOrNull;
    var e = entryOrNull || {
      id: genId(), name: '', code: '', teacher: '', credit: '', campus: '',
      day: preset && preset.day || 1,
      start: preset && preset.start || 1,
      end: preset && preset.end || 1,
      weeks: [],
      location: '', color: nextColor()
    };
    if (!isEdit) e.color = nextColor();
    editingId = isEdit ? e.id : null;
    draft = e;
    if (!st.week1Monday && !isEdit) {
      st.week1Monday = mondayOfISO(todayLocalISO());
      if (st.totalWeeks < 18) st.totalWeeks = 18;
      save();
    }

    var weekText = e.weeks.length ? fmtWeekRange(e.weeks).replace('周', '') : ('1-' + st.totalWeeks);

    var html = '<div class="modal-mask"></div><div class="sheet">'
      + '<div class="sheet-h"><h3>' + (isEdit ? '编辑课程' : '添加课程') + '</h3>'
      + '<button class="icon-btn" data-close="1">✕</button></div>'
      + '<div class="field"><label>课程名称 *</label><input type="text" id="fName" value="' + esc(e.name) + '" placeholder="课程名称"></div>'
      + '<div class="row2">'
      + '<div class="field"><label>星期</label><select id="fDay">'
      + WEEKDAY_CN.slice(1).map(function (n, i) { return '<option value="' + (i + 1) + '"' + (e.day === i + 1 ? ' selected' : '') + '>' + n + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>节次</label><div style="display:flex;gap:6px">'
      + '<select id="fStart">' + periodOptions(e.start) + '</select>'
      + '<select id="fEnd">' + periodOptions(e.end) + '</select>'
      + '</div></div></div>'
      + '<div class="field"><label>周次</label><input type="text" id="fWeeks" value="' + esc(weekText) + '" placeholder="如 1-18 / 3,5,7-9 / 1-16(单)">'
      + '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">'
      + '<button type="button" class="btn-sm secondary" data-weekset="1-' + st.totalWeeks + '">整学期</button>'
      + '<button type="button" class="btn-sm secondary" data-weekset="odd">单周</button>'
      + '<button type="button" class="btn-sm secondary" data-weekset="even">双周</button>'
      + '</div>'
      + '<div class="subtle" id="fWeeksPrev"></div></div>'
      + '<div class="row2"><div class="field"><label>教师</label><input type="text" id="fTeacher" value="' + esc(e.teacher) + '"></div>'
      + '<div class="field"><label>课程代码</label><input type="text" id="fCode" value="' + esc(e.code) + '"></div></div>'
      + '<div class="row2"><div class="field"><label>地点</label><input type="text" id="fLoc" value="' + esc(e.location) + '" placeholder="教学楼 / 教室"></div>'
      + '<div class="field"><label>学分</label><input type="text" id="fCredit" value="' + esc(e.credit) + '"></div></div>'
      + '<div class="field"><label>颜色</label><div class="color-row">'
      + PALETTE.map(function (c) {
        return '<button type="button" class="swatch' + (e.color === c ? ' sel' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>';
      }).join('')
      + '</div></div>'
      + '<div class="form-actions">'
      + (isEdit ? '<button id="fDel" class="btn danger" style="flex:0 0 auto;max-width:86px">删除</button>' : '')
      + '<button id="fSave" class="btn">保存</button>'
      + '</div>'
      + '</div>';

    openSheet(html, e.color);

    function sync() {
      var w = parseWeeksInput($('#fWeeks').value);
      $('#fWeeksPrev').textContent = w.length ? '→ ' + fmtWeekRange(w) : '未识别到有效周次';
    }
    sync();
    $('#fWeeks').addEventListener('input', sync);
    $('#fEnd').addEventListener('change', function () {
      var s = parseInt($('#fStart').value, 10), en = parseInt($('#fEnd').value, 10);
      if (en < s) $('#fEnd').value = s;
    });
    $('#fStart').addEventListener('change', function () {
      var s = parseInt($('#fStart').value, 10), en = parseInt($('#fEnd').value, 10);
      if (en < s) $('#fEnd').value = s;
    });
    var row = $('#modalRoot');
    row.querySelectorAll('[data-weekset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-weekset');
        if (v === 'odd') v = '1-' + st.totalWeeks + '(单)';
        else if (v === 'even') v = '1-' + st.totalWeeks + '(双)';
        $('#fWeeks').value = v; sync();
      });
    });
    row.querySelectorAll('[data-color]').forEach(function (b) {
      b.addEventListener('click', function () {
        row.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
    });

    $('#fSave').addEventListener('click', function () {
      var name = $('#fName').value.trim();
      if (!name) { toast('请填写课程名称'); return; }
      var weeks = parseWeeksInput($('#fWeeks').value);
      if (!weeks.length) { toast('周次填写有误，请检查'); return; }
      var day = parseInt($('#fDay').value, 10);
      var s0 = parseInt($('#fStart').value, 10);
      var e0 = parseInt($('#fEnd').value, 10);
      var colorSel = row.querySelector('.swatch.sel');
      var obj = {
        id: isEdit ? e.id : genId(),
        name: name,
        code: $('#fCode').value.trim(),
        teacher: $('#fTeacher').value.trim(),
        credit: $('#fCredit').value.trim(),
        campus: draft.campus || '',
        day: day, start: Math.min(s0, e0), end: Math.max(s0, e0),
        weeks: weeks,
        location: $('#fLoc').value.trim(),
        color: colorSel ? colorSel.getAttribute('data-color') : (e.color || PALETTE[0])
      };
      var idx = -1;
      for (var i = 0; i < st.entries.length; i++) if (st.entries[i].id === obj.id) { idx = i; break; }
      if (idx >= 0) st.entries[idx] = obj; else st.entries.push(obj);
      if (isEdit && idx < 0) st.entries.push(obj); // 删除后重新保存为新增
      save();
      closeSheet();
      render();
      toast('已保存');
    });
    if ($('#fDel')) {
      $('#fDel').addEventListener('click', function () {
        if (!confirm('删除这门课？')) return;
        st.entries = st.entries.filter(function (x) { return x.id !== e.id; });
        save(); closeSheet(); render(); toast('已删除');
      });
    }
  }

  function periodOptions(val) {
    var out = [];
    for (var i = 1; i <= 12; i++) {
      out.push('<option value="' + i + '"' + (i === val ? ' selected' : '') + '>第 ' + i + ' 节</option>');
    }
    return out.join('');
  }

  /* ---------------- 通用弹窗 ---------------- */
  var modalRoot = $('#modalRoot');
  function openSheet(html, accent) {
    modalRoot.classList.remove('hidden', 'center');
    modalRoot.innerHTML = html;
    var mask = modalRoot.querySelector('.modal-mask');
    mask.addEventListener('click', closeSheet);
    var closes = modalRoot.querySelectorAll('[data-close]');
    closes.forEach(function (b) { b.addEventListener('click', closeSheet); });
    if (accent) { /* 无需额外样式 */ }
  }
  function openCenter(html) {
    modalRoot.classList.remove('hidden');
    modalRoot.classList.add('center');
    modalRoot.innerHTML = '<div class="modal-mask"></div><div class="sheet center-style">' + html + '</div>';
    modalRoot.querySelector('.modal-mask').addEventListener('click', closeSheet);
    modalRoot.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });
  }
  function closeSheet() {
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
  }

  /* ---------------- 导入 xlsx ---------------- */
  function handleXlsxFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast('读取文件失败'); };
    reader.onload = function () {
      try {
        var bytes = new Uint8Array(reader.result);
        var wb = XlsxLib.parseWorkbook(bytes);
        if (!wb.sheets.length) { toast('文件内没有工作表'); return; }
        var res = ImportLib.importSheet(wb.sheets[0]);
        if (!res.ok) { toast(res.error || '导入失败'); return; }
        showImportConfirm(res, file.name);
      } catch (err) {
        console.error(err);
        toast('解析失败：' + (err && err.message ? err.message : err));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function showImportConfirm(res, fileName) {
    var newCount = 0, skipCount = 0;
    var fresh = res.entries.filter(function (en) {
      var dup = st.entries.some(function (x) {
        return x.code === en.code && x.day === en.day && x.start === en.start && x.end === en.end && x.location === en.location;
      });
      if (dup) { skipCount++; return false; }
      newCount++;
      return true;
    });
    var warnHtml = res.warnings.length
      ? '<div class="warn-list">' + res.warnings.map(function (w) { return esc(w); }).join('<br>') + '</div>' : '';
    var preview = sortEntries(fresh).slice(0, 40).map(function (e) {
      return '<div class="course-item"><div class="bar" style="background:' + PALETTE[0] + '"></div>'
        + '<div class="body"><div class="name">' + esc(e.name) + '</div>'
        + '<div class="meta">' + WEEKDAY_CN[e.day] + ' · 第' + e.start + '-' + e.end + '节 · ' + fmtWeekRange(e.weeks)
        + (e.location ? ' · ' + esc(e.location) : '') + '</div></div></div>';
    }).join('');
    var html = '<div class="sheet-h"><h3>导入预览 · ' + esc(fileName) + '</h3>'
      + '<button class="icon-btn" data-close="1">✕</button></div>'
      + '<div style="font-size:13px;color:var(--txt2);margin-bottom:6px">识别到课程 ' + res.courseCount + ' 门，将新增 ' + newCount + ' 条' + (skipCount ? '，跳过重复 ' + skipCount + ' 条' : '') + '。</div>';
    if (res.week1Monday) {
      html += '<div class="field"><label><input type="checkbox" id="icW1" checked> 使用建议开学日（第 1 周周一 = ' + res.week1Monday + '）' + (res.maxWeek ? '，总周数 ' + res.maxWeek : '') + '</label></div>';
    }
    html += warnHtml;
    html += '<div style="max-height:38vh;overflow:auto;margin:4px 0 12px">' + (preview || '<div class="empty-tip">没有可新增的课程（可能都已存在）。</div>') + '</div>'
      + '<div class="form-actions">'
      + (fresh.length ? '<button id="icOk" class="btn">导入 ' + newCount + ' 条</button>' : '<button class="btn secondary" data-close="1">完成</button>')
      + '<button class="btn secondary" data-close="1">取消</button>'
      + '</div>';
    openCenter(html);
    var ok = $('#icOk');
    if (ok) {
      ok.addEventListener('click', function () {
        var w1 = $('#icW1');
        if (w1 && w1.checked && res.week1Monday) {
          st.week1Monday = res.week1Monday;
          if (res.maxWeek) st.totalWeeks = Math.max(st.totalWeeks, res.maxWeek);
        } else if (res.maxWeek) {
          st.totalWeeks = Math.max(st.totalWeeks, res.maxWeek);
        }
        fresh.forEach(function (en) {
          en.id = genId();
          en.color = nextColor();
          st.entries.push(en);
        });
        save();
        closeSheet();
        WEEK = clampWeek(currentWeekNum());
        render();
        toast('已导入 ' + fresh.length + ' 条课程');
      });
    }
  }

  function handleJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var o = JSON.parse(reader.result);
        if (!o || !Array.isArray(o.entries)) { toast('不是有效的备份文件'); return; }
        openCenter(
          '<div class="sheet-h"><h3>导入备份</h3><button class="icon-btn" data-close="1">✕</button></div>'
          + '<div class="subtle" style="margin-bottom:10px">备份包含 ' + o.entries.length + ' 条课程记录与学期设置。将<strong>覆盖</strong>当前全部数据。</div>'
          + '<div class="form-actions"><button id="jrOk" class="btn">覆盖导入</button>'
          + '<button class="btn secondary" data-close="1">取消</button></div>'
        );
        $('#jrOk').addEventListener('click', function () {
          st = o;
          if (!Array.isArray(st.periods) || !st.periods.length) st.periods = clone(DEFAULT_PERIODS);
          if (typeof st.nextColor !== 'number') st.nextColor = 0;
          save();
          closeSheet();
          WEEK = clampWeek(currentWeekNum());
          render();
          toast('备份已导入');
        });
      } catch (e) { toast('JSON 解析失败'); }
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 全局事件 ---------------- */
  main.addEventListener('click', function (ev) {
    var t = ev.target;
    var chip = t.closest ? t.closest('[data-chip]') : null;
    if (chip) {
      var id = chip.getAttribute('data-chip');
      var entry = null;
      for (var i = 0; i < st.entries.length; i++) if (st.entries[i].id === id) { entry = st.entries[i]; break; }
      if (entry) openCourseModal(entry);
      return;
    }
    var add = t.closest ? t.closest('[data-add]') : null;
    if (add) {
      var p = add.getAttribute('data-add').split(',');
      var preset = { day: parseInt(p[0], 10), start: parseInt(p[1], 10), end: parseInt(p[1], 10) };
      openCourseModal(null, preset);
      return;
    }
    if (t.id === 'frImport' || t.id === 'impXlsx') { $('#fileXlsx').click(); }
    else if (t.id === 'frAdd') { openCourseModal(null); }
  });

  $('#tabbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tab]');
    if (b) switchTab(b.getAttribute('data-tab'));
  });
  $('#topAddBtn').addEventListener('click', function () {
    switchTab('courses');
    openCourseModal(null);
  });
  $('#fileXlsx').addEventListener('change', function (ev) {
    handleXlsxFile(ev.target.files && ev.target.files[0]);
    ev.target.value = '';
  });
  $('#fileJson').addEventListener('change', function (ev) {
    handleJsonFile(ev.target.files && ev.target.files[0]);
    ev.target.value = '';
  });

  /* ---------------- 启动 ---------------- */
  WEEK = clampWeek(currentWeekNum());
  render();
})();
