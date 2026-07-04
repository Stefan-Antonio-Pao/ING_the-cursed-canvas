# 被诅咒的画布 —— 一场魔法艺术悬案

**简体中文** | [English](./README.md)

<p align="center">
  <img src="static/icons/skeuomorphic.png" alt="被诅咒的画布图标" width="144">
</p>

一款融合艺术史与奇幻元素的网页文字冒险游戏，由真实 AI 驱动。

## 目录

- [项目简介](#项目简介)
- [特性](#特性)
- [图标资源](#图标资源)
- [快速开始](#快速开始)
- [桌面版](#桌面版)
- [玩法说明](#玩法说明)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [致谢](#致谢)

## 项目简介

午夜，你被锁进一座魔法博物馆。画作已经苏醒，画中的世界正在崩解。要逃出去，你必须走进《星月夜》《神奈川冲浪里》与《日出·印象》，遇见梵高、葛饰北斋与莫奈，找回每幅画遗失的颜色、声音与记忆。

## 特性

- **LLM 驱动的故事与 NPC 对话**：在线使用 DeepSeek API，离线使用 Phi-3-mini（transformers）。可选的体验代理（Experience Proxy）提供试用额度，新玩家无需自备 API Key 即可体验在线模式。
- **意图分类器**：TF-IDF + 逻辑回归，基于标注数据训练，准确率 ≥85%，支持中英文。
- **情感感知情绪**：英文用 VADER，中文用 SnowNLP，两者在库或模型不可用时均回退到关键词规则。
- **三个可玩世界**：含任务、物品与 NPC。
- **双语界面（中/英）**：JSON 资源文件、游戏内语言切换，以及覆盖每个页面的客户端 `t()` 函数。
- **分阶段预加载界面**：启动时保持语言稳定，显示进度反馈，并执行非阻塞的本地运行时检查。
- **电影感标题屏**：粒子特效、进入主菜单的过场桥接、按钮错峰显现动画，以及按运行环境处理的退出游戏流程。
- **新手教程**：序章前的引导流程（默认仅首次游玩显示），并可通过"帮助"快捷按钮随时打开教程弹窗。
- **实验性语音输入**：支持麦克风录音、本地转写、转写修正设置与可选自动发送。
- **主题光标特效**：随画作主题变化的光标样式、点击反馈、光晕半径，以及"追光逐影" / "群星璀璨"拖尾模式。
- **游戏图标选择器**：可从多个新图标样式中选择浏览器标签页与主屏幕图标。
- **修复画廊**：提供画作修复记录与中英双语艺术背景内容。
- **存档槽**：多槽位、浏览器端迁移、未保存进度提示与故事回顾。
- **桌面版**：基于 Electron + PyInstaller，支持 macOS 与 Windows。
- **完整 ML 流水线**：数据标注 → 训练 → 评估 → 部署。

## 图标资源

v3 图标组包含四种可选样式。默认桌面资源也沿用同一视觉方向生成。

| 拟物化 | 扁平化 | 概念版本 | 简洁版本 |
|--------|--------|----------|----------|
| <img src="static/icons/skeuomorphic.png" alt="拟物化图标" width="96"> | <img src="static/icons/flattened.png" alt="扁平化图标" width="96"> | <img src="static/icons/concept.png" alt="概念版本图标" width="96"> | <img src="static/icons/clean.png" alt="简洁版本图标" width="96"> |

## 快速开始

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m ai.intent en    # 训练英文分类器（约 2 秒）
python -m ai.intent zh    # 训练中文分类器（约 2 秒）
python app.py             # 启动服务
```

打开 **http://127.0.0.1:5000**。本地 Phi-3-mini 交互模型首次使用时从 HuggingFace 下载（约 650MB，5–15 分钟），之后会缓存；DeepSeek API 模式无需下载。语音输入是可选功能，需要麦克风权限与可用的本地语音运行时。

## 桌面版

桌面打包使用 Electron + PyInstaller。体验代理、桌面配置与 macOS/Windows 构建命令详见 [DESKTOP_PACKAGING.md](./DESKTOP_PACKAGING.md)。

### macOS：安装后需移除隔离属性

Apple 会对未签名的下载文件打上隔离标记，导致应用无法启动，并提示"Apple 无法检查其是否包含恶意软件"或"已损坏"。将 **The Cursed Canvas** 拖入 `/Applications` 后，在终端运行：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/The Cursed Canvas.app"
```

按提示输入 macOS 密码即可。此后应用可正常打开。每次安装只需执行一次。

## 玩法说明

行动用括号包裹，对话直接输入。输入框下方的快捷按钮会随地点变化覆盖常用操作；随时按 **Help**（帮助）可重新打开教程，也可以通过麦克风按钮试用实验性语音输入。

| 指令 | 意图 |
|------|------|
| (look around), (examine painting) | 探索 |
| talk to van gogh, where is the pigment? | 与 NPC 对话 |
| (take lantern), (use pigment), (give flute) | 使用/拾取物品 |
| (enter starry night), (return to museum) | 在世界间移动 |
| (inventory), (i) | 查看物品栏 |
| (help), (hint) | 获取提示 / 打开教程 |
| (restore painting), (solve puzzle) | 完成任务 |

中文指令格式一致，例如 `（四处看看）`、`（拿起灯笼）`、`（进入星月夜）`。

## 项目结构

```
cursed-canvas/
├── app.py                # Flask 应用
├── engine/               # 游戏状态、记忆、世界数据
├── ai/                   # LLM（Phi-3-mini / DeepSeek）、意图分类器、情感分析
├── i18n/                 # 中英文关键词、提示词、世界数据、界面文案
├── data/                 # intents.json, world_data.json
├── models/               # 训练好的中英文分类器与向量化器
├── experience_proxy/     # 可选的 DeepSeek 兼容试用额度代理
├── desktop/              # Electron 主进程、配置、资源
├── static/ + templates/  # 聊天界面、预加载/标题屏、设置、画廊、教程
├── tests/                # 世界流程、语音与中文术语/状态测试
├── requirements.txt
└── README.md
```

## 常见问题

- **找不到分类器**：运行 `python -m ai.intent en` 与 `python -m ai.intent zh`。
- **中文情感回退到关键词**：安装 `snownlp`（`pip install snownlp`）；不安装也能正常运行，只是粒度较粗。
- **macOS 应用打不开（"已损坏"/"无法检查"）**：运行上方"桌面版"章节中的 `xattr` 命令。
- **首次加载慢**：本地 Phi-3-mini 模型需从 HuggingFace 下载，之后会缓存；在设置中切换到 DeepSeek API 模式可即时响应。
- **语音输入不可用**：语音是可选功能。请检查麦克风权限与设置中的本地语音运行时状态；Windows 上的 PyTorch 或 Microsoft Visual C++ 运行库问题可能导致本地语音转写不可用。
- **内存不足**：关闭其他应用；本地模型约占 1.5GB 内存。
- **文本重复**：变换指令；使用 `help` 重置上下文。

## 致谢

Daihong Luo, Xinzhi Bao —— CPS 3320 Python Programming, 2026 年 6 月
