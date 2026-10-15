# Agent Todo

[English](README_EN.md) · 简体中文

一个面向 Codex 的本地待办技能：用 SQLite 保存个人或工作区任务，并通过网页工作台查看待办、Codex 额度和当前工作状态。

## 功能

- 通过自然语言创建、查询、更新和完成待办。
- 为每条待办分配稳定的四位编号，支持乐观并发控制。
- 数据保存在本机 SQLite，不依赖外部数据库。
- 固定使用 `http://127.0.0.1:8021/`，首次操作会自动启动并打开工作台；服务已运行时不会重复打开浏览器页面。
- 页面可见时每 5 秒同步待办与 Codex 活动，重新获得焦点时立即刷新。
- 工作台只显示一个 Codex 办公位，并按当前并行任务数量展示任务块。
- 进行中的任务显示蓝色流光，待用户确认显示橙色，已完成未读显示绿色。
- 从本地 Codex `app-server` 读取额度，并结合本地会话事件展示状态。
- Windows、macOS 和 Linux 均可使用，无第三方 npm 运行时依赖。

> 状态仅用于只读展示。审批、确认和用户输入仍需回到 Codex 中完成。

## 界面预览

### 个人工作台

![Agent Todo 个人工作台](assets/screenshots/workbench.png)

### 待办看板

![Agent Todo 待办看板](assets/screenshots/todo-board.png)

## 环境要求

- Codex 桌面端或 Codex CLI
- Node.js 22.13 或更高版本
- 本机端口 `8021` 可用

## 安装

仓库根目录就是完整技能目录。安装后重新打开 Codex，或开始一个新对话，让 Codex 重新发现技能。

### 使用 SSH

macOS / Linux：

```bash
git clone git@github.com:Angus221/agent-todo.git ~/.codex/skills/agent-todo
```

Windows PowerShell：

```powershell
git clone git@github.com:Angus221/agent-todo.git "$env:USERPROFILE\.codex\skills\agent-todo"
```

### 使用 HTTPS

```bash
git clone https://github.com/Angus221/agent-todo.git ~/.codex/skills/agent-todo
```

也可以直接让 Codex 使用 `skill-installer` 从本仓库安装。

## 使用方式

安装后，可以直接对 Codex 说：

- “帮我添加一个明天下午完成的高优先级待办。”
- “列出工作区里还没完成的待办。”
- “把 0007 标记为进行中。”
- “完成 0007，并记录处理结果。”
- “打开 Agent Todo 看板。”
- “查看当前 Codex 额度和正在处理的任务。”

技能会在执行待办命令前检查网页服务。如果服务尚未运行，会在 `127.0.0.1:8021` 自动启动并打开浏览器；已经运行时既不会重复启动，也不会重复打开浏览器页面。

## 命令行

Windows：

```powershell
./scripts/agent-todo.ps1 dashboard
./scripts/agent-todo.ps1 list --format text
./scripts/agent-todo.ps1 get 0007
```

macOS / Linux：

```bash
./scripts/agent-todo.sh dashboard
./scripts/agent-todo.sh list --format text
./scripts/agent-todo.sh get 0007
```

创建和更新命令使用 UTF-8 JSON 输入文件；详细字段见 [数据库与 API 说明](references/schema.md)。

## 数据与隐私

- 数据库默认位于 `data/agent-todo.sqlite`。
- SQLite、WAL、SHM、日志和其他本地运行数据均被 `.gitignore` 排除。
- 网页服务器只监听本机回环地址，不对局域网或互联网开放。
- Codex 额度与会话状态来自本机 Codex 服务和本地会话文件。
- 删除技能目录前，请自行备份 `data/agent-todo.sqlite`。

## 项目结构

```text
agent-todo/
├── SKILL.md                 # Codex 技能入口
├── agents/openai.yaml       # 技能界面元数据
├── assets/
│   ├── screenshots/         # README 界面截图
│   └── web/                 # Vue 3 工作台
├── data/                    # 本地 SQLite 数据（不提交）
├── references/              # 架构、数据库与 API 说明
├── scripts/
│   ├── cli.ts               # 命令行入口与自动启动逻辑
│   ├── server.ts            # 本地 HTTP/API 服务
│   ├── lib/                 # SQLite 与 Codex 状态集成
│   └── tests/               # Node.js 测试
├── README.md
└── README_EN.md
```

## 开发与验证

```bash
npm test
node scripts/server.ts
```

技能结构可使用 Codex 自带的 `skill-creator/scripts/quick_validate.py` 校验。

## 致谢

Codex 使用量与本地会话扫描思路参考了 MIT 许可的 [itvincent-git/codex-usage-desktop](https://github.com/itvincent-git/codex-usage-desktop)。本项目的 TypeScript 集成为独立实现。

网页端随仓库分发 Vue 3 与 Marked 的浏览器构建，分别遵循其原始开源许可证。

## 许可证

[MIT](LICENSE)

