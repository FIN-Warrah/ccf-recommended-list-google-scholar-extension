# CCF Rank — Google Scholar 学术等级标注插件

在 Google Scholar 搜索结果中自动标注 CCF 推荐的国际学术会议/期刊等级（A / B / C），帮助研究者快速识别论文发表质量。

## ✨ 功能特色

- 🏅 **等级标注** — 在每条搜索结果旁显示 CCF-A / B / C 等级徽章
- 📊 **统计面板** — 页面顶部汇总当前搜索结果的 A/B/C 分布
- 🔄 **变更追踪** — 标注 2026 年新增、晋级、名称更新的会议/期刊
- 💬 **悬浮详情** — 鼠标悬停查看完整名称、缩写、所属类别
- 👤 **个人主页支持** — 在学者个人主页的论文列表中同样标注
- 🔌 **隐私友好** — CCF 数据内嵌，本地完成匹配；仅当 Google Scholar 来源行被截断且本地无法确认时，才同源请求 Scholar 引用页补全刊会名

## 📦 安装

### 方式一：从源码加载（推荐开发者）

1. 下载或克隆本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择 `ccf-recommended-list-google-scholar-extension` 目录

### 方式二：下载 Release 包

1. 前往 [Releases](../../releases) 页面下载最新 `.zip`
2. 解压后按上述步骤加载

## 📁 项目结构

```
├── ccf-recommended-list-google-scholar-extension/   # Chrome 扩展核心
│   ├── manifest.json          # 扩展配置（Manifest V3）
│   ├── content.js             # 内容脚本 — 匹配与注入逻辑
│   ├── content.css            # 徽章与悬浮提示样式
│   ├── ccf_data.js            # CCF 数据（查找表）
│   ├── popup.html / popup.js  # 弹出面板
│   └── icons/                 # 扩展图标
├── ccf_rankings.json          # CCF 目录结构化数据（JSON）
├── extract_pdf.py             # 从 PDF 提取原始数据
├── extract_changes.py         # 提取版本变更信息
├── extract_colors.py          # 提取 PDF 颜色标注
├── find_deleted.py            # 对比发现删除条目
├── gen_icons.py               # 图标生成工具
└── verify_against_pdf.py      # 数据校验脚本
```

## 🔍 匹配策略

插件采用多层递进匹配，在尽量标全的同时控制误标：

1. **全称精确匹配** — 去空格、标点、大小写差异后比对完整刊会名
2. **名称型简称匹配** — 支持 `Middleware`、`Eurographics`、`Inscrypt` 等非传统大写简称
3. **倒置名称匹配** — 处理 Google Scholar 中类似 `Computers, IEEE Transactions on` 的展示方式
4. **缩写与别名匹配** — 支持 `SIGMOD`、`TPDS`、`ASP-DAC`、`CODES+ISSS` 等缩写变体
5. **全文缩写搜索** — 在解析出的 venue 字段中搜索缩写，并对 `IMAGE`、`HEALTH`、`FAST` 等普通英文词做误标保护
6. **截断后缀匹配** — 处理 `… Transactions on Image Processing` 这类 Google Scholar 截断文本
7. **高置信关键词匹配** — 处理 `IEEE Trans. Pattern Anal. Mach. Intell.` 等缩写刊名和常见变体
8. **引用页补全** — 对仍无法确认的截断结果，同源读取 Google Scholar 引用页中的候选刊会名后再次匹配

## 🔐 隐私说明

扩展不会把论文标题、作者或搜索结果发送到第三方服务。CCF 目录数据已内嵌在扩展中，常规识别都在当前页面本地完成。

为了提高 Google Scholar 新布局下被截断来源行的识别率，扩展可能会向当前 Scholar 域名的引用页发起同源请求，用于读取完整刊会名候选；该请求不离开 Google Scholar 域名，不访问自建服务器，也不上传 CCF 匹配结果。

## 🌐 支持的 Google Scholar 域名

`scholar.google.com`、`scholar.google.com.hk`、`scholar.google.co.uk`、`scholar.google.ca`、`scholar.google.com.au`、`scholar.google.de`、`scholar.google.fr`、`scholar.google.co.jp`、`scholar.google.co.kr`

## 📋 数据来源与声明

本扩展使用的会议/期刊等级数据来自中国计算机学会（CCF）公开发布的[《推荐国际学术会议和期刊目录》](https://www.ccf.org.cn/Academic_Evaluation/By_category/)（2026 年版，第七版）。

- 该数据仅供学术研究参考，不应作为学术评价的唯一依据
- 如有数据错误，欢迎提 Issue 反馈
- 本项目与 CCF 官方无关联

## 📄 许可证

[MIT License](LICENSE)
