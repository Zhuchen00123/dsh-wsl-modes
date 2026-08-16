# DSH WSL Modes

让 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 在 Windows 上使用 **WSL Linux bash + bubblewrap 沙箱**，并提供两个可直接使用的 Agent preset：

| Preset | 名称 | 说明 |
|---|---|---|
| `minimal-wsl` | 极简模式 (WSL) | 极简双工具：bash + `str_replace_editor`，另加 read/write/edit、glob/grep、plan、compact |
| `code-wsl` | Code Mode (WSL) | 完整 Code Mode：PTC `run_code` + delegation/workflow + skills + plan/compact + 全量工具 |

两个 preset 都内置 **两阶段锚定（anchored bootstrap）**：

- 第一轮模型请求只暴露 `[bash, read]`，并把 `maxTokens` 压到 1024，锚定 Minimal 的推理轨迹；
- 第一次持久 `tool/call` 或 `assistant/message` 后自动晋升；
- 晋升后恢复该 preset 的完整工具目录；
- 状态从持久 session events 推导，resume 不丢。

---

## 🐋 收录于 DSH 创意工坊

本仓库已打上 `dsh-plugin` topic，会被 [DSH 创意工坊](https://github.com/JxaMe/dsh-workshop) 每日自动扫描收录。

- 创意工坊在线地址：https://JxaMe.github.io/dsh-workshop/
- 收录方式：GitHub topic `dsh-plugin` 自动发现

---

## 目录结构

```text
dsh-wsl-modes/
├── README.md
├── presets/
│   ├── minimal-wsl/
│   │   ├── agent.cordis.yml       # preset 组合：bootstrap + persona + 工具
│   │   ├── preset.yml             # 下拉菜单显示信息
│   │   └── tool-bootstrap.mjs     # 两阶段锚定插件（MIT）
│   └── code-wsl/
│       ├── agent.cordis.yml
│       ├── preset.yml
│       └── tool-bootstrap.mjs
└── host/
    └── dsh-wsl-bash/              # ctx.shell 执行器：wsl.exe + bwrap
        ├── cordis.patch.yml       # 挂载补丁：禁 pwsh-sandbox，挂 wsl-bash
        ├── src/index.ts
        ├── lib/index.js
        └── package.json
```

---

## 工作原理

- **终端**：`tool-bash` 通过 `ctx.shell` 执行器运行 `wsl.exe -d <distro> --exec bwrap ... -- bash -c <cmd>`。
- **沙箱**：在 WSL 内用 `bwrap` 表达三档策略：
  - `read-only`：`--ro-bind / /`
  - `workspace-write`：额外 `--tmpfs /tmp --bind <workspace> <workspace>`
  - `danger-full-access`：不加 bwrap，直接 `wsl.exe bash`
- **路径**：工作区 Windows 路径会通过 `wslpath -a` 转成 WSL 路径用于 bwrap bind；bash 内看到的是 Linux 路径（如 `/codexprojects/...`）。
- **PTC（仅 code-wsl）**：`tool-presentation mode: code`，模型通过 `run_code` 写 TypeScript 程序，一次组合多步操作。

---

## 环境要求

- Windows 10/11 + WSL2
- WSL 发行版（默认 `Debian`，可用 `DSH_WSL_DISTRO` 指定）
- WSL 内已安装 `bwrap`（`sudo apt install bubblewrap`）
- Node.js ≥ 22（`node:sqlite` / `node:zstd`）
- DeepSeek Harness `0.1.0-rc.6` 或兼容版本

---

## 安装

### 1. 克隆本仓库

```bash
git clone https://github.com/<your-name>/dsh-wsl-modes.git
cd dsh-wsl-modes
```

### 2. 安装 preset 到 DSH

把 `presets/minimal-wsl` 和 `presets/code-wsl` 复制到：

```text
%USERPROFILE%\.dsh\.agent-presets\
```

PowerShell：

```powershell
$dest = "$env:USERPROFILE\.dsh\.agent-presets"
Copy-Item -Recurse -Force .\presets\minimal-wsl $dest
Copy-Item -Recurse -Force .\presets\code-wsl $dest
```

### 3. 安装 compaction 插件

`code-wsl` / `minimal-wsl` 使用 `dsh-compaction-cacheaware` 作为 compaction 后端（Reasonix 风格）。需要在 DSH profile 中安装该包：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm add dsh-compaction-cacheaware
```

> 如果暂时不想用 npm registry，也可以从 GitHub 安装：
> `pnpm add dsh-compaction-cacheaware@github:Zhuchen00123/dsh-compaction-cacheaware`

### 4. 挂载 WSL bash 执行器

启动 DSH Web 时带上本仓库的 host patch：

```powershell
dsh --profile web --patch F:\path\to\dsh-wsl-modes\host\dsh-wsl-bash\cordis.patch.yml --port 3xxx
```

> 也可以把 `cordis.patch.yml` 的内容合并进你的 profile `cordis.patch.yml`，这样不用每次带 `--patch`。

### 5. 使用

在 Web UI 里点“新建会话”，选择：

- `极简模式 (WSL)` 或
- `Code Mode (WSL)`

---

## 已验证

在 `opencode-go / deepseek-v4-flash` + WSL2 Debian 上实测通过：

| 项目 | 结果 |
|---|---|
| `minimal-wsl` 加载 | ✅ 双工具 + 锚定 |
| `code-wsl` 加载 | ✅ PTC `run_code` 可用 |
| WSL Linux bash | ✅ `uname -a` → `Linux ... WSL2 ... GNU/Linux` |
| `pwd` | ✅ `/codexprojects/deepseek-harnes` |
| bwrap workspace-write | ✅ `/tmp` 可写，`/etc` 被拦 |
| 沙箱 denial 上报 | ✅ `[sandbox: file access denied under workspace-write mode]` |
| escalation 审批流 | ✅ danger-full-access 可审批 |

---

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_WSL_DISTRO` | WSL 默认发行版 | 指定 WSL 发行版 |
| `DSH_WSL_EXE` | `wsl.exe` | wsl.exe 路径 |
| `DSH_WSL_BWRAP` | `bwrap` | WSL 内 bwrap 路径 |
| `DSH_WSL_ENV` | 空 | 额外透传到 WSL 的环境变量，逗号分隔 |

---

## 注意事项

- **路径问题**：bash 内看到的是 WSL 路径（`/mnt/f/...`），而 `read/write/edit/str_replace_editor` 运行在 Windows 主机，需要 Windows 路径（`F:\...`）。模型调用文件工具前应使用 `wslpath -w /mnt/f/...` 转换，或直接使用 Windows 路径。
- **不要多进程写同一 session**：DSH 的 session 日志是 append-only，多个 dsh 进程同时写同一会话会损坏日志。测试不同模式请用不同会话，或先退出旧进程。
- **Windows PTY 限制**：官方 minimal 的持久 bash 依赖 PTY seam，在 Windows 上不可用；本方案使用一次性 `tool-bash`，每条命令独立运行。
- **code-wsl 输出截断**：`code-wsl` 的 `bootstrapMaxTokens` 已设为 `16384`，避免首轮 PTC 因 1024 上限被截断。若仍遇到 `invalid pi-ai replay state: block count does not match assistant content`，通常是 DSH 在“继续”截断回复时的 pi-ai replay 状态同步问题；可先发一条新消息代替“继续”，或把 `bootstrapMaxTokens` 再调大。

---

## 致谢 / License

- `tool-bootstrap.mjs` 来自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，MIT License。
- 本仓库代码采用 MIT License，见 [LICENSE](./LICENSE)。
