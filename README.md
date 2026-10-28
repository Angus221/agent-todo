# Agent Todo

[English](README_EN.md) · 简体中文

一个面向 Codex 的本地待办技能：用 SQLite 保存个人或工作区任务，并通过网页工作台查看待办、Codex 额度和当前工作状态。

## 功能

- 通过自然语言创建、查询、更新和完成待办。
- 创建时未指定日期的待办会自动使用当前本地日期。
- 为每条待办分配稳定的四位编号，支持乐观并发控制。
- 数据保存在本机 SQLite，不依赖外部数据库。
- AI 默认只生成一个 `项目名-功能概括` 标签，避免单条待办堆积大量标签。
- 固定使用 `http://127.0.0.1:8021/`，首次操作会自动启动并打开工作台；服务已运行时不会重复打开浏览器页面。
- 页面可见时每 5 秒同步待办与 Codex 活动，重新获得焦点时立即刷新。
- 工作台只显示一个 Codex 办公位，并在办公位右侧逐行展示当前并行任务；底部集中显示本周待办。
- 提供独立 3D 任务农场：货架承接未排期待办，左田显示已排期，中田显示进行中与待验收，右田显示已完成。
- Codex 工作时人物进入田地执行挖掘动画，空闲后回到椅子休息；悬浮作物可看标题，点击可直接打开待办详情。
- 进行中的任务显示蓝色流光，待用户确认显示橙色，已完成未读显示绿色。
- 从本地 Codex `app-server` 读取额度，并结合本地会话事件展示状态。
- Windows、macOS 和 Linux 均可使用，无第三方 npm 运行时依赖。

> 状态仅用于只读展示。审批、确认和用户输入仍需回到 Codex 中完成。

## 界面预览

### 个人工作台

![Agent Todo 个人工作台](assets/screenshots/workbench.png)

### 待办看板

![Agent Todo 待办看板](assets/screenshots/todo-board.png)

### 3D 任务农场

角色使用 Tripo 原生行走、坐下、挖掘与跳舞动画：Codex 开始工作时从椅子起身走进田格，挖出带有会话标题的植物；工作结束后到随机路边位置跳舞，再返回躺椅。点击植物或悬浮标题可打开对应 Codex 会话，右下角“演示角色动作”可预览完整流程。

每个会话使用独立固定田格；多个任务同时进行时，人物随机轮换耕作。矮植物表示进行中，高植物表示已完成，摇晃的植物表示等待确认或异常。人物按直线路径前往目标，坐下、挖掘和跳舞时面向房屋正面的方向。植物前方的地面标签显示会话标题前 10 个字，悬浮显示全文，点击跳转会话。

主路通过三条小路连接田地；角色根据草地、路面与田地的实际高度贴地行走。

田格从前方最右角起，沿纵列往后编号，再向左换列。标题与田面平行，贴在植物前方的格子边缘，并随视角保持透视关系。

![Agent Todo 3D 任务农场](assets/web/models/farm-browser.png)

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
- “打开 3D 任务农场。”

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
│   ├── blender/             # 3D 农场 Blender 源工程
│   └── web/                 # Vue 3 工作台、Three.js 运行时与 GLB 场景
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

网页端随仓库分发 Vue 3、Marked 与 Three.js 的浏览器构建，分别遵循其原始开源许可证。

## 许可证

[MIT](LICENSE)

