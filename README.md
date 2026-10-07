# 学习小站

这是一个部署在 GitHub Pages 上的纯静态学习网站，不需要后端服务器，也不需要安装构建工具。

## 架构

- `index.html`：首页和学习资源入口。
- `quiz.html`：所有选择题、判断题和填空题共用的练习程序。
- `data/subjects.json`：科目名称、题数、颜色、标签和题库路径的统一配置。
- `data/*.json`：各科目的题库数据。
- `assets/css/site-base.css`：全站通用的焦点样式和减少动画设置。
- `assets/js/home.js`：根据科目配置生成首页题库卡片。
- `assets/js/quiz.js`：题库加载、筛选、抽题、判题和页面交互逻辑。
- `scripts/validate_site.py`：检查科目配置、题库答案、本地链接和嵌套链接。
- `resources/`：制作网页时使用的原始文本、课件和文档，网站运行时不依赖这些文件。
- `archive/`：尚未接入首页的历史页面和物理复习资料。

根目录只保留当前网站入口、正在使用的学习页面和 GitHub Pages 配置。高数解析、Python题库和Python在线运行功能已经移入 `archive/unused/`，不再显示在首页。`snake.html` 是尚未接入首页的独立小游戏，暂时保留在根目录。

## 本地预览

由于页面使用 `fetch()` 读取 JSON，不能直接双击 HTML 文件预览。请在项目根目录运行：

```powershell
python -m http.server 8000
```

然后访问 `http://localhost:8000/`。

## 添加新题库

1. 在 `data` 目录中新建题库 JSON 文件。
2. 在 `data/subjects.json` 中添加对应的科目配置。
3. 运行检查脚本：

```powershell
python scripts/validate_site.py
```

检查通过后，首页会自动显示新科目，不需要再手工复制卡片 HTML。
