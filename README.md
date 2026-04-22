# CCF Rank — Google Scholar 学术等级标注插件

在 Google Scholar 搜索结果中自动标注 CCF 推荐的国际学术会议/期刊等级（A / B / C），帮助研究者快速识别论文发表质量。

## ✨ 功能特色

- 🏅 **等级标注** — 在每条搜索结果旁显示 CCF-A / B / C 等级徽章
- 📊 **统计面板** — 页面顶部汇总当前搜索结果的 A/B/C 分布
- 🔄 **变更追踪** — 标注 2026 年新增、晋级、名称更新的会议/期刊
- 💬 **悬浮详情** — 鼠标悬停查看完整名称、缩写、所属类别
- 👤 **个人主页支持** — 在学者个人主页的论文列表中同样标注
- 🔌 **纯本地运行** — 无需网络请求，所有数据内嵌，保护隐私

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

插件采用五层递进匹配，确保高召回率：

1. **缩写直接匹配** — `SIGMOD`、`TPDS` 等
2. **缩写变体匹配** — 去连字符、复数变体
3. **全文缩写搜索** — 在整段文本中定位缩写词
4. **全称归一化匹配** — 去空格/标点后比对完整名称
5. **关键词模糊匹配** — 基于关键词重叠度打分

## 🌐 支持的 Google Scholar 域名

`scholar.google.com`、`scholar.google.com.hk`、`scholar.google.co.uk`、`scholar.google.ca`、`scholar.google.com.au`、`scholar.google.de`、`scholar.google.fr`、`scholar.google.co.jp`、`scholar.google.co.kr`

## 📋 数据来源与声明

本扩展使用的会议/期刊等级数据来自中国计算机学会（CCF）公开发布的[《推荐国际学术会议和期刊目录》](https://www.ccf.org.cn/Academic_Evaluation/By_category/)（2026 年版，第七版）。

- 该数据仅供学术研究参考，不应作为学术评价的唯一依据
- 如有数据错误，欢迎提 Issue 反馈
- 本项目与 CCF 官方无关联

## 📄 许可证

[MIT License](LICENSE)
