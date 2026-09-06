/*
 * lib/timetable-import.js — 把教务「选课导出」工作表转换成课表数据
 *
 * 输入：lib/xlsx.js 解析出的 sheet（{ name, rows: string[][] }）
 * 逻辑：
 *   1) 表头定位列（课程代码/课程名称/任课教师/学分/上课时间地点/首次上课日期…）
 *   2) 按「课程代码列是否为空」切分课程；空代码但含「上课时间地点」的行为上一课程的续行
 *   3) 解析每行「上课时间地点」文本 → 若干排课条目 {day,start,end,weeks[],location}
 *      （同星期同节次同地点合并周次；其余各自成条）
 *   4) 用「首次上课日期 + 最早周」反推第 1 周周一（week1Monday）
 *
 * 浏览器（window.ImportLib）与 Node（module.exports）通用。
 */
(function (root) {
  'use strict';

  var WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  var HEADER_KEYS = {
    code: ['课程代码'],
    name: ['课程名称'],
    teacher: ['任课教师'],
    credit: ['学分'],
    hours: ['课程学时'],
    campus: ['校区'],
    firstDate: ['首次上课日期'],
    timeLoc: ['上课时间地点']
  };

  // Excel 序列日期 → 'YYYY-MM-DD'
  function excelDateISO(serial) {
    var ms = (Date.UTC(1899, 11, 30) + (Number(serial) | 0) * 86400000);
    var d = new Date(ms);
    return d.toISOString().slice(0, 10);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 星期文本 → 1..7
  function parseDay(str) {
    var m = /星期([一二三四五六日天])/.exec(str);
    if (!m) return null;
    return WEEKDAY[m[1]];
  }

  // '3-18周' / '3周' / '3,5,7-9周(单)' → [3,5,7,8,9]（单周过滤为奇数）
  function expandWeeks(token) {
    var t = String(token).replace(/第|周/g, '');
    var odd = /单/.test(t);
    var even = /双/.test(t) && !odd;
    var parts = t.replace(/[单双]|周/g, '').replace(/[（(].*?[）)]/g, '').split(/[\s,，、;；]+/);
    var set = [];
    var push = function (n) {
      if (odd && n % 2 === 0) return;
      if (even && n % 2 !== 0) return;
      if (set.indexOf(n) < 0) set.push(n);
    };
    parts.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      var m = /^(\d+)(?:\s*[-~]\s*(\d+))?$/.exec(p);
      if (!m) return;
      if (m[2]) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (b < a) { var tmp = a; a = b; b = tmp; }
        for (var k = a; k <= b; k++) push(k);
      } else push(parseInt(m[1], 10));
    });
    return set.sort(function (a, b) { return a - b; });
  }

  var LINE_RE = /^([^\s\[\]]+)\s*(星期[一二三四五六日天])\s*[\[（(]?\s*(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*节?\s*[\]）)]?\s*(.*)$/;

  // 解析单行 "3-18周 星期五[05-07节]望江研究生楼三区119"
  function parseTimeLine(line) {
    var text = String(line || '').trim();
    if (!text) return null;
    var m = LINE_RE.exec(text);
    if (!m) {
      // 兼容：前面可能带多余分隔符
      return null;
    }
    var weeks = expandWeeks(m[1]);
    var day = parseDay(m[2]);
    var start = parseInt(m[3], 10);
    var end = parseInt(m[4], 10);
    if (!day || !weeks.length || end < start) return null;
    return { day: day, start: start, end: end, weeks: weeks, location: (m[5] || '').trim() };
  }

  // 行 → 本课程的若干原始上课时段（每行可能多条，用换行/分号分隔）
  function parseTimeCell(text) {
    var out = [];
    if (!text) return out;
    text.split(/[\r\n;；]+/).forEach(function (l) {
      l = l.trim();
      if (!l) return;
      var r = parseTimeLine(l);
      if (r) out.push(r);
      else out.push({ raw: l });
    });
    return out;
  }

  function buildHeaderMap(row) {
    var map = {};
    if (!row) return map;
    row.forEach(function (cell, i) {
      var name = String(cell || '').trim();
      if (!name) return;
      if (map[name] === undefined) map[name] = i;
    });
    return map;
  }

  // sheet → { courses: [{code,name,teacher,credit,hours,campus,firstDate,timeCell}], headerFound }
  function parseSheetCourses(sheet) {
    var rows = sheet.rows || [];
    var headerIdx = -1;
    var headerMap = {};
    for (var r = 0; r < rows.length; r++) {
      var joined = (rows[r] || []).join(' ');
      if (/课程代码/.test(joined) && /上课时间/.test(joined)) {
        headerIdx = r;
        headerMap = buildHeaderMap(rows[r]);
        break;
      }
    }
    var ci = {};
    Object.keys(HEADER_KEYS).forEach(function (k) {
      var found = null;
      HEADER_KEYS[k].some(function (label) {
        if (headerMap[label] !== undefined) { found = headerMap[label]; return true; }
        return false;
      });
      ci[k] = found;
    });
    var courses = [];
    var cur = null;
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var cell = function (idx) { return (idx === null || idx === undefined || !row[idx]) ? '' : String(row[idx]).trim(); };
      var code = cell(ci.code);
      if (code) {
        cur = {
          code: code,
          name: cell(ci.name),
          teacher: cell(ci.teacher),
          credit: cell(ci.credit),
          hours: cell(ci.hours),
          campus: cell(ci.campus),
          firstDate: cell(ci.firstDate),
          timeCell: cell(ci.timeLoc)
        };
        courses.push(cur);
      } else if (cur) {
        var tc = cell(ci.timeLoc);
        if (tc) cur.timeCell += '\n' + tc;
      }
    }
    return { courses: courses, headerIdx: headerIdx };
  }

  // 条目去重键：同课同(day,start,end,location) 合并周次
  function keyOf(e) { return e.day + '-' + e.start + '-' + e.end + '|' + (e.location || ''); }

  function buildEntries(course) {
    var slots = parseTimeCell(course.timeCell);
    var out = [];
    var raw = [];
    slots.forEach(function (s) {
      if (s.raw) { raw.push(s.raw); return; }
      var existing = null;
      for (var i = 0; i < out.length; i++) {
        if (keyOf(out[i]) === keyOf(s)) { existing = out[i]; break; }
      }
      if (existing) {
        s.weeks.forEach(function (w) { if (existing.weeks.indexOf(w) < 0) existing.weeks.push(w); });
        existing.weeks.sort(function (a, b) { return a - b; });
      } else {
        out.push({
          code: course.code,
          name: course.name,
          teacher: course.teacher,
          credit: course.credit,
          hours: course.hours,
          campus: course.campus,
          day: s.day, start: s.start, end: s.end,
          weeks: s.weeks.slice(),
          location: s.location
        });
      }
    });
    return { entries: out, raw: raw };
  }

  // 主入口：sheet → { entries, week1Monday, maxWeek, warnings }
  function importSheet(sheet) {
    var warnings = [];
    var parsed = parseSheetCourses(sheet);
    if (parsed.headerIdx < 0) {
      return { ok: false, error: '未找到表头（课程代码/上课时间地点），可能不是选课导出的文件。' };
    }
    var entries = [];
    var candidate = null; // { minWeek, week1Monday, code }
    var maxWeek = 0;
    parsed.courses.forEach(function (course) {
      if (!course.timeCell) {
        warnings.push('课程「' + (course.name || course.code) + '」没有「上课时间地点」，已跳过。');
        return;
      }
      var r = buildEntries(course);
      r.raw.forEach(function (line) {
        warnings.push('课程「' + (course.name || course.code) + '」有一行无法解析，请手动补录：' + line);
      });
      if (!r.entries.length) {
        if (!r.raw.length) warnings.push('课程「' + (course.name || course.code) + '」没有可用的排课时间。');
        return;
      }
      entries.push.apply(entries, r.entries);
      // 开学日推算候选：取该课程最早周
      var minW = Infinity;
      r.entries.forEach(function (e) { e.weeks.forEach(function (w) { if (w < minW) minW = w; }); });
      if (course.firstDate && /^\d+(\.\d+)?$/.test(course.firstDate) && minW !== Infinity) {
        var entryOfMin = null;
        for (var i = 0; i < r.entries.length; i++) {
          if (r.entries[i].weeks.indexOf(minW) >= 0) { entryOfMin = r.entries[i]; break; }
        }
        var d = excelDateISO(course.firstDate);
        var dt = new Date(d + 'T00:00:00Z');
        var weekdayOfDate = dt.getUTCDay() || 7; // JS: 0=Sun→7
        var day = entryOfMin ? entryOfMin.day : weekdayOfDate;
        // 该日期所在周的周一
        var monday = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - (weekdayOfDate - 1)));
        var w1 = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() - (minW - 1) * 7));
        var cand = { minWeek: minW, week1Monday: w1.toISOString().slice(0, 10) };
        if (!candidate || cand.minWeek < candidate.minWeek) candidate = cand;
        void day;
      }
    });
    entries.forEach(function (e) {
      e.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; });
    });
    return {
      ok: true,
      entries: entries,
      week1Monday: candidate ? candidate.week1Monday : null,
      maxWeek: maxWeek,
      courseCount: parsed.courses.length,
      warnings: warnings
    };
  }

  // 周次数组 → '3-13周' / '3,4,5,7-18周'
  function compressWeeks(weeks) {
    var sorted = (weeks || []).slice().sort(function (a, b) { return a - b; });
    if (!sorted.length) return '';
    var parts = [];
    var i = 0;
    while (i < sorted.length) {
      var s = sorted[i], e = sorted[i];
      while (i + 1 < sorted.length && sorted[i + 1] === e + 1) { e = sorted[i + 1]; i++; }
      parts.push(s === e ? '' + s : s + '-' + e);
      i++;
    }
    return parts.join(',') + '周';
  }

  var api = {
    excelDateISO: excelDateISO,
    parseDay: parseDay,
    expandWeeks: expandWeeks,
    parseTimeLine: parseTimeLine,
    parseTimeCell: parseTimeCell,
    importSheet: importSheet,
    compressWeeks: compressWeeks
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImportLib = api;
})(typeof self !== 'undefined' ? self : this);
