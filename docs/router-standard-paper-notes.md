# dsh-router-standard 论文研究笔记

> 整理时间：2026-08-16
> 来源：https://github.com/yjh051108/dsh-router-standard
> 文档：`docs/paper.md`、`docs/statement.md`、`docs/apology.md`

## 1. 论文是什么

**Dual-Attractor Behavior Policies and Task-Aware Routing**

- 作者：yjh051108（`dsh-router-standard`）
- 性质：社区研究论文，非 DeepSeek 官方
- 测量环境：官方 DeepSeek API，`reasoning_effort=max`
- 核心：研究 V4 Pro / V4 Flash 在“提示词条件”下的思维模式，并给出 task-aware router

## 2. 三个核心实证发现（数据仍然有效）

### 2.1 思维模式不是连续可调，而是三态

21 点探针（0.00–1.00，n=2）显示：

| 区间 | 行为带 |
|---|---|
| 0.00–0.15 | **spec**：`We` 集体式、plan-first、稳定 |
| 0.20–0.45 | **transition**：`We/The/Let` 混杂、不稳定（陷阱） |
| 0.50–1.00 | **react**：`The/Let` 第一人称、doer、稳定 |

连续“旋钮”是假象，实际只有三档。

### 2.2 同一模型，条件不同分数差 ~10 分

| 任务 | spec 条件 | react/code 条件 |
|---|---|---|
| 维护任务 | 99/96 | 91 |
| 从零建游戏 | 6/10 | **10/10** |

同一个模型，提示词条件决定“神”还是“鬼”。

### 2.3 路径提交（path-committed）

- 第一次请求一旦锚定，后续扩大工具目录最多扰动一个推理块
- 首轮非常关键

## 3. Flash 专属结论（对我们最有用）

- **Flash 是 persona 决定、目录免疫**：换工具不影响轨迹，换 persona 影响极大
- Flash 的 weak-persona 路由强度是 Pro 的 **1.5–2 倍**
- **深度再收敛（deep-then-converge）**：
  - `react persona + "think deeply first, then produce"` → 推理深度翻倍（9.7k→18.4k 字符），收敛率 100%
  - 只有 `"think deeply"` 没有 `then produce` → 吃满预算，0% 收敛
  - **关键绑定指令是 "then commit and act"**

## 4. 作者勘误（必须知道）

论文理论部分已**标注作废**：

| 作废内容 | 状态 |
|---|---|
| A1 官方刻意对齐了两个专家 scaffold | ❌ 作废 |
| A2 中间带是训练分布间隙 | ⚠️ 待验证假说 |
| A3 自路由不可能 by construction | ❌ 作废 |
| A4 条件化主导 / god-ghost duality | ❌ 作废 |
| “官方设计了双模式 / 路由层训坏了” | ❌ 作废 |

**保留有效**：

- 实测数据、探针方法、实验表格
- router-standard 工程实现
- Flash 可复现提升

### 作者修正后的解释

```text
原生路径：Let me... but wait...（低效，左右脑互搏）
后训练新压了一条：We need（高效，性能更高）
两条路径之间存在断层/断裂带
插件不是修路由，而是把这个断层当自适应门控：
  常规任务 → We need（高效）
  复杂规划 → 放行 Let me（深推）
```

## 5. 对我们模式的启示

1. **首轮锁定 persona + 核心工具 + 首次 tool/call 后放开**，符合 path-committed 实证
2. **WEAK_FLASH 的“深想 + 收敛”组合有实验支撑**
3. 理论要当工程经验用，别当科学结论
4. 论文数据来自官方 API，opencode-go 上要自行复测

## 6. 基于论文优化后的 Flash persona

```text
You are a helpful assistant.
Before acting, decide the task type (build or fix) and adopt the matching
style: build → hands-on production; fix → inspect-and-plan.
Before acting, briefly review what you have already done in this session and
continue from where you left off; do not repeat completed steps. Do not run
environment checks (echo, whoami, uname, node --version, date) or exhaustive
grep/glob scans.
Think deeply about the architecture, edge cases, and integration points
before writing. Do not spend reasoning on the environment or tooling. After
deep thinking, commit to a decision and act: produce the deliverable, then
verify it by reading and running. End each reasoning block with a decision or
an information need.
```

关键改进点：

- 加入 `commit to a decision and act`
- 加入 `produce the deliverable, then verify it by reading and running`
- 保留 anti-runaway（不做环境检查）
- 保留决策闭环（end each reasoning block with a decision or an information need）

## 7. 相关链接

- 论文：https://github.com/yjh051108/dsh-router-standard/blob/main/docs/paper.md
- 勘误：https://github.com/yjh051108/dsh-router-standard/blob/main/docs/statement.md
- 道歉：https://github.com/yjh051108/dsh-router-standard/blob/main/docs/apology.md
