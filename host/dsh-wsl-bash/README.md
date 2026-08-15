# dsh-wsl-bash

把 DeepSeek Harness 在 Windows 上给模型的终端，从 PowerShell 换成 **WSL 里的 Linux bash**。

## 为什么

官方 web 组合在 Windows 上：

- `bash-sandbox`（Linux bash 执行器）被禁用（`process.platform === 'win32'`）
- `pwsh-sandbox`（PowerShell 执行器）被启用

所以模型看到的终端是 `pwsh`。本插件提供一个 `ctx.shell` 执行器，它继承
`LocalBashExecutor` 的全部进程机制（超时、输出截断、spill 文件、后台任务句柄），
只把命令 argv 换成 `wsl.exe -d <发行版> --exec bash -lc <命令>`。

## 用法

1. 编译：

```bash
cd packages/dsh-wsl-bash
npx tsc -p tsconfig.json
```

2. 挂载（作为 `--patch` 覆盖，或合并进 `$DSH_HOME/profiles/web/cordis.patch.yml`）：

```bash
dsh --profile web --patch ./packages/dsh-wsl-bash/cordis.patch.yml
```

该 patch 会禁用 `pwsh-sandbox` 并挂载 `wsl-bash` 作为新的 `ctx.shell`。

3. 让模型看到 `bash` 工具（而非 `pwsh`）：

   默认 `code` preset 在 Windows 上启用 `tool-pwsh`、禁用 `tool-bash`。要换终端，
   需要让 preset 暴露 `tool-bash`。最简单的是复制 `code` preset 并把 shell 两行的
   `disabled` 反过来，或直接修改 preset 里的 `tool-bash`/`tool-pwsh` 行。

## 配置（环境变量，无 Config schema）

| 变量 | 默认 | 含义 |
|---|---|---|
| `DSH_WSL_DISTRO` | 空（用 WSL 默认发行版） | 指定执行用的 WSL 发行版名 |
| `DSH_WSL_EXE` | `wsl.exe` | wsl.exe 路径 |
| `DSH_WSL_ENV` | 空 | 逗号分隔的额外环境变量名，经 `WSLENV` 透传进 WSL |

## 稳健性（本机已验证）

- `--exec` 跳过外层 login shell；`bash -lc` 仍加载 login 文件，发行版自定义 PATH/alias 生效。
- Windows cwd 直接透传，`wsl.exe` 自动映射进发行版（本机 `F:/...` → `/codexprojects/...`，
  由发行版 `wsl.conf` 的 bind mount 决定）。cwd 在挂载外会由 bash 明确报错，不会静默跑错目录。
- 退出码逐字转发（`exit 42` → 42）；杀掉 Windows 端 `wsl.exe` 会连 Linux 进程树一起终止，
  无孤儿进程泄漏，继承的 subprocess 优雅终止仍然干净。
- Windows 环境变量默认**不**进 WSL；每个名字必须列入 `WSLENV`。本插件转发 `DSH_*` 快照
  和配置的额外变量，并**合并**进已存在的 `WSLENV` 而非覆盖。
- `WSL_UTF8=1` 让 Linux 工具输出 UTF-8，匹配 subprocess 收集器的解码；`NO_COLOR`/
  `TERM=dumb`/pager 覆盖继承自 `LocalBashExecutor`。

## 沙箱边界（重要）

本执行器**不**声明 `sandboxMode`（返回 `undefined`），所以 `bash` 工具不会暴露
`sandbox_permissions` 升级字段。Linux 侧**不受** Windows ACL 沙箱约束 —— 这是一个
**全权限终端**，等价于 `danger-full-access`。这是切换到 WSL 的既定、已文档化的边界。

如果你希望保留文件写限制，需要另外在 WSL 内套一层（例如 bwrap/landlock），本插件
刻意不做这层，保持轻量。
