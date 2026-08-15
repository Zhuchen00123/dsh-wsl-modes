/**
 * Anchored tool bootstrap — keep the FIRST model request on a small tool
 * surface and a small output budget, then expose the full preset catalog (and
 * the normal output budget) once the session has produced its first durable
 * promotion signal.
 *
 * The phase is derived from durable session events, so resume and reload
 * preserve it. By default (`promoteOn: 'either'`) a session promotes after the
 * first `tool/call` OR the first `assistant/message`, whichever comes first:
 * request #1 always sees the bootstrap catalog and request #2 always sees the
 * full catalog. The original `'tool-call'` mode is kept for compatibility, but
 * it can trap a session in bootstrap forever when the first model reply makes
 * no tool call — the `'either'` default removes that trap while keeping the
 * first-request anchor intact.
 *
 * Two additional first-request conditions found during the 2026-08-15
 * reproduction work (issue #6):
 *
 *  1. Output budget. On the official endpoint the first request's
 *     `max_tokens` dominates the trajectory anchor: 1024 reproduced the
 *     `We need` style in 26/32 runs against 0/5 at the adapter default of
 *     256000, independent of tool descriptions. Bootstrap therefore caps the
 *     first request at `bootstrapMaxTokens` (default 1024) and strips the cap
 *     after promotion — the next request's seed proposal carries the previous
 *     header's maxTokens forward, so the release must be explicit.
 *
 *  2. Injected reminders. dsh-agent-instructions and dsh-tool-skill inject
 *     workspace instructions (AGENTS.md) and the skill catalog into the first
 *     step as user messages whenever such content exists. With the skill
 *     catalog present the anchor did not reproduce at all (0/9); without it
 *     the same request reproduces at ~81%. Both message kinds are therefore
 *     stripped during bootstrap and allowed again after promotion.
 *
 * Robustness:
 *  - Promotion decisions are memoized per session id for this process; the
 *    durable event scan runs once per session per process, then O(1).
 *  - A missing bootstrap tool degrades to the full catalog with a one-time
 *    warning instead of throwing, so a composition drift can never brick
 *    every request of a session.
 *  - Invalid config (bad tool lists, unknown `promoteOn`) fails at apply
 *    time, i.e. at preset mount, where it is visible and fixable.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-tool-bootstrap'

/**
 * Deliberately NO inject list: the listeners only touch services at event
 * time. Applying without an inject — combined with this row being FIRST in
 * agent.cordis.yml — registers the plugin before dsh-agent-instructions and
 * dsh-tool-skill, and waterfall after-next transforms apply in reverse
 * registration order, so the first-request strip below is the LAST transform.
 * With an inject here those plugins register first and re-inject their
 * messages after the strip.
 */
export const inject = []

const DEFAULT_BOOTSTRAP_MAX_TOKENS = 1024

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

/** Message source kinds injected into the first step that must not reach request #1. */
const BOOTSTRAP_INJECTED_SOURCE_KINDS = new Set(['skill-catalog', 'agent-instructions'])

function stringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

function positiveInt(value, field, fallback) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name}: ${field} must be a positive safe integer`)
  }
  return value
}

/** Register the per-session bootstrap filters. */
export function apply(ctx, config) {
  const commonTools = stringList(config.commonTools, 'commonTools')
  const shellTools = stringList(config.shellTools, 'shellTools')
  const promoteEvents = parsePromoteOn(config.promoteOn)
  const bootstrapMaxTokens = positiveInt(config.bootstrapMaxTokens, 'bootstrapMaxTokens', DEFAULT_BOOTSTRAP_MAX_TOKENS)

  /** Sessions already promoted in this process. Promotion is append-only, so a Set is sound. */
  const promoted = new Set()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  /**
   * Whether the session has reached the promoted phase.
   * @param agent - the assembly context's agent, or undefined outside an agent.
   */
  const isPromoted = (agent) => {
    if (agent === undefined) return true
    const session = agent.session
    if (session === undefined) return true
    if (promoted.has(session.id)) return true
    const hit = session.events.some((event) => promoteEvents.includes(event.type))
    if (hit) promoted.add(session.id)
    return hit
  }

  /** Narrow the assembled catalog to one platform shell plus the common tools. */
  const applyBootstrap = (assembled) => {
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const selectedShells = shellTools.filter((toolName) => available.has(toolName))
    const missingCommon = commonTools.filter((toolName) => !available.has(toolName))
    if (selectedShells.length !== 1 || missingCommon.length > 0) {
      warnOnce(
        `${name}: expected exactly one bootstrap shell and every common tool; `
        + `shells=${JSON.stringify(selectedShells)}, missing=${JSON.stringify(missingCommon)} — `
        + 'bootstrap disabled, full catalog exposed',
      )
      return assembled
    }
    const bootstrap = new Set([...selectedShells, ...commonTools])
    return {
      ...assembled,
      tools: assembled.tools.filter((tool) => bootstrap.has(tool.name)),
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    try {
      if (isPromoted(context.agent)) return assembled
      return applyBootstrap(assembled)
    } catch (error) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  })

  // Cap the first model request's output budget while bootstrapping.
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload.agent
    if (isPromoted(agent)) {
      // The next request's seed proposal carries the previous header's
      // maxTokens forward, so the injected cap must be stripped explicitly —
      // otherwise it would persist for the whole session.
      if (resolved.maxTokens === bootstrapMaxTokens) {
        const { maxTokens: _bootstrap, ...rest } = resolved
        return rest
      }
      return resolved
    }
    return {
      ...resolved,
      maxTokens: bootstrapMaxTokens,
    }
  })

  // Strip first-step injected reminders (skill catalog, AGENTS.md) during
  // bootstrap. Because this listener is the first registered (see the inject
  // note and the row order in agent.cordis.yml), the strip is the final
  // waterfall transform and actually removes what later listeners inject.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const agent = payload.agent
    if (isPromoted(agent)) return decision
    return {
      ...decision,
      messages: decision.messages.filter((message) => !BOOTSTRAP_INJECTED_SOURCE_KINDS.has(message.source?.kind)),
    }
  })
}
