/*
 * tools/parse-test.mjs — 命令行验证 xlsx 解析与导入逻辑
 * 用法: node tools/parse-test.mjs [文件路径]   （默认 E:\选课1.xlsx）
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XlsxLib = require('../lib/xlsx.js');
const ImportLib = require('../lib/timetable-import.js');

const path = process.argv[2] || 'E:\\选课1.xlsx';
if (!fs.existsSync(path)) {
  console.error('文件不存在: ' + path);
  process.exit(2);
}

const bytes = new Uint8Array(fs.readFileSync(path));
const wb = XlsxLib.parseWorkbook(bytes);
console.log('sheets:', wb.sheets.map(s => `${s.name}(${s.rows.length}行)`).join(', '));

const sheet = wb.sheets[0];
const res = ImportLib.importSheet(sheet);
if (!res.ok) {
  console.error('导入失败:', res.error);
  process.exit(1);
}

console.log(`课程条目: ${res.entries.length}  课程数: ${res.courseCount}  建议开学日(第1周周一): ${res.week1Monday}  最大周: ${res.maxWeek}`);
if (res.warnings.length) {
  console.log('警告:');
  res.warnings.forEach(w => console.log('  - ' + w));
}

// 排序输出便于核对
const sorted = res.entries.slice().sort((a, b) =>
  (a.day - b.day) || (a.start - b.start) || (a.name < b.name ? -1 : 1));

console.log('\n条目明细:');
sorted.forEach(e => {
  console.log(`  [周${e.day}] 第${e.start}-${e.end}节  ${ImportLib.compressWeeks(e.weeks).padEnd(10)} ${e.name}  ${e.location || ''}  ${e.teacher || ''}`);
});

// 基本断言（对照选课1.xlsx 人工核对结论）
const byCode = {};
res.entries.forEach(e => { (byCode[e.code] = byCode[e.code] || []).push(e); });

const expect = {
  S00000004: { day: 3, start: 5, end: 7, loc: '望江三教150' },
  S00000101: { day: 4, start: 3, end: 4, loc: '望江研究生楼三区104' },
  S00000203: { day: 2, start: 2, end: 4, loc: '望江研究生楼一区204' },
  S08030004: { day: 5, start: 5, end: 7, loc: '望江研究生楼三区119' },
  S08030007: { day: 2, start: 10, end: 11, loc: '望江研究生楼三区412' },
  S08030008: { day: 1, start: 2, end: 4, loc: '望江研究生楼三区402' },
  S08030011: { day: 1, start: 10, end: 12, loc: '望江研究生楼三区401' }
};

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
  else console.log('  ✓ ' + msg);
}
Object.entries(expect).forEach(([code, ex]) => {
  const list = byCode[code] || [];
  const hit = list.find(e => e.day === ex.day && e.start === ex.start && e.end === ex.end && e.location === ex.loc);
  assert(!!hit, `${code} (${list[0] && list[0].name}) 时间地点匹配`);
});

// 光学工程发展动态：缺第 6 周
const optical = (byCode.S08030003 || []);
assert(optical.length === 1, 'S08030003 光学工程发展动态 合并为 1 条');
const has6 = optical.some(e => e.weeks.indexOf(6) >= 0);
assert(!has6 && optical.some(e => e.weeks.indexOf(3) >= 0) && optical.some(e => e.weeks.indexOf(18) >= 0),
  '光学工程发展动态 周次 = 3,4,5,7..18（不含第6周）');

// 开学日
assert(res.week1Monday === '2026-08-31', '建议开学日 = 2026-08-31 (实际 ' + res.week1Monday + ')');
assert(res.maxWeek === 18, '最大周 = 18');

if (failures) {
  console.error(`\n共 ${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部断言通过 ✔');
