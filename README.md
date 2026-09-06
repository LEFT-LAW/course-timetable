# 纯净课表 (course-timetable)

纯净、离线、可安装到 iPhone 主屏幕的课表（PWA）。

- 无框架、无构建、无 npm 依赖，纯 HTML/CSS/JS 静态文件
- 数据保存在浏览器 localStorage，仅在本机，可导出/导入 JSON 备份
- 支持导入教务系统「选课导出」的 `.xlsx`（如川大研究生教务选课结果），解析在浏览器内本地完成，不上传任何数据
- 手动增删改课程同样支持（周次支持区间、逐周、单双周）

## 快速开始

桌面双击 `index.html` 即可使用（功能完整，仅无“安装到主屏幕”的 PWA 能力）。

**在 iPhone 上安装为 App：**

1. 把项目部署到任意 HTTPS 静态托管（见下）
2. iPhone Safari 打开部署地址
3. 点底部「分享」→「添加到主屏幕」
4. 主屏出现「课表」图标，此后可像普通 App 一样独立窗口离线使用

## 数据导入（.xlsx）

教务选课导出文件的格式形如：

```
课程代码 | 课程名称 | … | 首次上课日期 | 上课时间地点
S08030008 | Matlab程序设计 | … | 46279 | 3-13周 星期一[02-04节]望江研究生楼三区402
```

- 设置页 →「导入选课 .xlsx」选择文件，先预览再确认导入
- 自动识别：星期、节次起止、周次（`3-13周` 区间或逐行 `N周`，可缺周，如第 6 周无课）、教师、地点、学分
- 自动推算第 1 周周一（开学日）与最大周数，可在预览中勾选采用
- 重复导入同一份文件会跳过已存在的记录

> 注意：若教务导出的不是这种表头，导入器会提示“未找到表头”，请以教务系统原始导出为准。

## 开发与校验

```bash
# 用真实教务文件跑一遍解析校验（断言 8 门课信息一致）
node tools/parse-test.mjs "E:\选课1.xlsx"

# 重新生成 PWA 图标（需本机 python，产物已提交，一般无需重跑）
python tools/make-icons.py
```

## 目录

```
index.html              页面骨架
app.css                 样式（纯净浅色主题）
app.js                  应用逻辑（课表/今日/编辑/导入/设置）
lib/xlsx.js             纯 JS xlsx 解析（zip+deflate+XML，无依赖）
lib/timetable-import.js 教务课表 → 应用数据映射
manifest.webmanifest    PWA 清单
sw.js                   Service Worker 离线缓存
icons/                  App 图标（由 tools/make-icons.py 生成）
tools/parse-test.mjs    Node 端解析自测
tools/make-icons.py     图标生成脚本
```

## 部署到 GitHub Pages

```bash
# 在项目目录内（本目录是独立仓库更干净）
git init && git add . && git commit -m "纯净课表 PWA"
gh repo create course-timetable --public --source=. --remote=origin --push
gh api repos/<你的用户名>/course-timetable/pages \
  -f "source[branch]=main" -f "source[path]=/" || true
```

然后 iPhone Safari 打开 `https://<你的用户名>.github.io/course-timetable/` 添加到主屏幕。

## 隐私

所有数据仅存本机浏览器，无服务器、无账号、无网络请求（除首次访问时加载自身静态文件）。
