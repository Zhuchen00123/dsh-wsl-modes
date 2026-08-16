/**
 * router-bootstrap: Flash 神模式引导（opencode-go 适配）。
 *
 * 在 system-prompt/assemble 阶段，把 Flash 模型（model id 含 "flash"）强制
 * 路由到 weak 模式（作者 dsh-router-standard 实测 w7 最优解），注入对应的
 * WEAK_FLASH persona，首轮只暴露 core 工具集，首次 tool call 后放开全目录。
 *
 * dsh rc.6 适配说明：作者原版的"近距离引导"依赖 `ctx.on('session/event')`
 * + `target.inbox.append`，在 dsh rc.6 上失效（session/event 是 session-scoped、
 * agent 对象无 inbox、assemble 时 session.events 尚无 user/message）。故改为把
 * 深度引导静态并入 WEAK_FLASH persona（见 router-core.mjs），不依赖动态注入。
 */

import {
  applyPersona, coreFor, extractText, guideFor, isChatTask, personaFor, sessionMode, isFlashModel,
} from './router-core.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'router-bootstrap'

/** Prompt assembly and the tools registry must exist. */
export const inject = ['systemPrompt', 'tools']

export function apply(ctx, config) {
  const overrides = new Map() // session id -> explicit mode（预留，供未来外部调优）
  const firstUserText = new Map() // session id -> first real user text (chat detection)
  const chatSessions = new Set() // sessions that stand down (greeting/chat)
  const guided = new Map() // session id -> last guided user message id

  // Capture the first real user message before assemble (rc.6 fix).
  ctx.on('agent/inbox/claimed', (payload) => {
    const agent = payload?.agent
    const message = payload?.message
    if (!agent || !message) return
    const session = agent.session
    if (!session) return
    const data = message.data ?? message
    const text = extractText(data)
    if (!firstUserText.has(session.id) && text.trim()) {
      firstUserText.set(session.id, text.trim())
    }
  })
  const PATH_CONVENTION =
    'Path convention (Windows + WSL):\n'
    + '- In bash, always use WSL paths (e.g. /mnt/f/projects/...).\n'
    + '- In read/write/edit/str_replace_editor, always use Windows paths (e.g. F:\\projects\\...).\n'
    + '- Convert WSL -> Windows: wslpath -w /mnt/f/projects/...\n'
    + "- Convert Windows -> WSL: wslpath -u 'F:\\projects\\...'\n"
    + '- Never pass /mnt/f/... to Windows file tools; never pass F:\\... to bash.'

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session

    // Chat/greeting sessions stand down: keep the original persona/tool surface.
    const firstText = firstUserText.get(session.id)
    if (firstText !== undefined && isChatTask(firstText)) {
      chatSessions.add(session.id)
      return assembled
    }

    const modelId = agent.options?.model
    // Flash 模型一律走 weak（作者 w7 最优解）；非 Flash 走关键词分类。
    const mode = overrides.get(session.id)
      ?? (isFlashModel(modelId) ? 'weak' : sessionMode(session))
    const persona = personaFor(mode, modelId)

    // persona 全程不变；只有工具面在首次 tool call 后放开全目录。
    const sections = applyPersona(assembled.sections, persona)

    if (session.events.some((event) => event.type === 'tool/call')) {
      return {
        ...assembled,
        sections: [...sections, { name: 'path-convention', text: PATH_CONVENTION, order: 1 }],
        contexts: assembled.contexts,
      } // promoted: full catalog + path convention
    }

    const core = new Set(coreFor(mode))
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (shell === null) {
      throw new Error(`${name}: no platform shell in catalog`)
    }
    core.add(shell)

    return {
      ...assembled,
      sections,
      contexts: [],
      tools: assembled.tools.filter((tool) => core.has(tool.name)),
    }
  })

  // First-round purity: strip skill-catalog / agent-instructions injections
  // while bootstrapping (mirrors dsh-wsl-modes tool-bootstrap).
  const BOOTSTRAP_INJECTED_SOURCE_KINDS = new Set(['skill-catalog', 'agent-instructions'])
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const agent = payload?.agent
    if (agent === undefined || agent.session === undefined) return decision
    if (agent.session.events.some((event) => event.type === 'tool/call')) return decision
    return {
      ...decision,
      messages: decision.messages.filter((message) => !BOOTSTRAP_INJECTED_SOURCE_KINDS.has(message.source?.kind)),
    }
  })

  // ── near-field adaptive guidance (mode-boost style, depth-adaptive) ──
  ctx.on('agent/inbox/inserted', (payload) => {
    const agent = payload?.agent
    const message = payload?.message
    if (!agent || !message) return
    const data = message.data ?? message
    if (data.source?.kind !== 'user') return // only real user messages
    const session = agent.session
    if (!session) return
    if (chatSessions.has(session.id)) return // chat sessions stand down
    const text = extractText(data)
    if (!text.trim()) return
    if (guided.get(session.id) === message.id) return // dedupe
    const round = session.events.filter((e) => e.type === 'user/message').length
    const modelId = agent.options?.model
    const guide = guideFor(round, text, modelId)
    try {
      agent.inbox.append('next-step', {
        id: `router-guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        source: { kind: 'plugin', plugin: 'router-bootstrap' },
        content: [{ type: 'text', text: guide }],
      })
      guided.set(session.id, message.id)
    } catch { /* duplicate/ordering races: skip */ }
  })
}
