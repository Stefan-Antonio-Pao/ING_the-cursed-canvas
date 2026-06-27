# The Cursed Canvas - Tester Guide / 测试者使用指南

This guide is for external playtesters.
本指南用于发给外部测试者，帮助快速启动和反馈问题。

## 1) What is in this package? / 包内包含内容

- Source code for the game web app / 游戏 Web 应用源码
- Trained intent model files in `models/` / 已训练意图分类模型（`models/`）
- Frontend assets in `static/` and `templates/` / 前端资源（`static/`、`templates/`）
- Dependency list in `requirements.txt` / 依赖清单（`requirements.txt`）

Note: The package does NOT include a Python virtual environment.
说明：压缩包不包含 Python 虚拟环境，请在本机自行创建。

## 2) Test environment requirements / 测试环境要求

- Python 3.10+ (recommended / 建议: 3.11)
- Internet connection for dependency install and optional AI services
  安装依赖与可选 AI 服务需要联网
- 8GB+ RAM recommended / 建议内存 8GB 及以上

## 3) Quick start (macOS/Linux) / 快速启动（macOS/Linux）

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m nltk.downloader vader_lexicon
python app.py
```

Open in browser / 浏览器打开: `http://127.0.0.1:7860`

If port 7860 is occupied, the app will auto-switch to 7861/7862...
如果 7860 被占用，程序会自动切换到 7861/7862 等可用端口。

## 4) Quick start (Windows PowerShell) / 快速启动（Windows PowerShell）

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m nltk.downloader vader_lexicon
python app.py
```

## 5) Optional API configuration / 可选 API 配置

If you want online AI responses (DeepSeek), create a `.env` file:
如果你希望使用在线 AI（DeepSeek），请创建 `.env` 文件：

```env
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_MODEL=deepseek-chat
```

Without API key, the game still runs with fallback logic.
没有 API Key 也能运行，但部分 AI 效果会降级到回退逻辑。

## 6) How to play / 玩法说明

- Use parentheses for action commands:
  动作用圆括号输入：
  - `(look around)`
  - `(take lantern)`
  - `(enter starry night)`
- Use plain text for NPC dialogue:
  对 NPC 说话直接输入自然语言（不要加括号）：
  - `Where did your yellow go?`
  - `Tell me about this place.`

Useful commands / 常用命令:

- `inventory` or `i`
- `help` or `hint`
- `(go to museum)`
- `(restore painting)`

## 7) Basic test checklist / 基础测试清单

- App starts and page loads / 程序可启动，页面可加载
- Museum -> Starry Night -> Great Wave world flow works
  博物馆 -> 星月夜 -> 神奈川冲浪里 路线可用
- Item pickup/use and quest completion works
  物品拾取/使用与任务完成正常
- NPC dialogue and mood changes respond correctly
  NPC 对话与情绪反馈正常
- Reset and ending flow work / 重置与结局流程正常

## 8) Troubleshooting / 常见问题

- `No classifier found`
  - Run / 运行: `python -m ai.intent`
- Slow first launch
  - Model/dependency initialization may take several minutes.
    首次初始化模型与依赖可能需要几分钟。
- `ModuleNotFoundError`
  - Confirm virtual env is active and dependencies installed.
    确认已激活虚拟环境并执行 `pip install -r requirements.txt`。
- API mode unavailable
  - Check `.env` key and network connectivity.
    检查 `.env` 的 Key 和网络连接。

## 9) Feedback template / 反馈模板

Please include / 请尽量包含以下信息：

- OS + Python version / 操作系统与 Python 版本
- Steps to reproduce / 复现步骤
- Input command(s) / 输入命令
- Screenshot or console error / 截图或终端报错
- Expected vs actual behavior / 预期与实际结果

Thank you for testing The Cursed Canvas!
感谢测试 The Cursed Canvas！
