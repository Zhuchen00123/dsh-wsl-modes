/**
 * dsh-wsl-bash — a `ctx.shell` executor that runs the bash tool inside WSL,
 * with the sandbox enforced by bubblewrap (bwrap) INSIDE the distro.
 *
 * Why this exists:
 *   On Windows the stock web composition mounts pwsh-sandbox (PowerShell) and
 *   disables bash-sandbox. Swapping only the interpreter to wsl.exe is not
 *   enough — dsh-permission-presets REQUIRES ctx.shell.sandboxMode to be set
 *   (a sandbox-capable executor), and the Windows ACL sandbox cannot confine a
 *   Linux process running inside WSL. So the sandbox must move inside WSL too,
 *   using bwrap (the same Linux confinement the stock bash-sandbox uses, and
 *   the same family the original Codex codex-linux-sandbox used).
 *
 * How it works:
 *   - extends LocalBashExecutor (inherits timeouts, output truncation, spill
 *     files, background job handles, model-friendly ENV_OVERRIDES).
 *   - declares sandboxMode from ctx.sandboxPolicy.defaultMode (default
 *     workspace-write) so the permission stack composes.
 *   - resolve(): stamps the per-call sandboxPolicy (same as SandboxBashExecutor),
 *     and translates the Windows workspaceRoot → WSL path via `wslpath -a`.
 *   - confine(): builds a bwrap argv with the standard profile args and runs it
 *     THROUGH wsl.exe, mirroring the stock sandbox-local bwrap profile.
 *   - danger-full-access: no bwrap, just wsl.exe bash -lc (full access).
 *
 * bwrap profile (mirrors @deepseek-ai/dsh-sandbox-local bwrapProfileArgs):
 *   read-only:      --ro-bind / / --dev /dev --proc /proc --die-with-parent
 *   workspace-write: + --tmpfs /tmp --bind <workspace> <workspace>
 *   danger-full-access: no bwrap at all
 *
 * Verified on this machine (WSL2 Debian, bwrap 0.11.0):
 *   - workspace-write: project root writable, /etc and /root denied
 *   - read-only: all writes denied (Read-only file system)
 *   - wslpath -a F:/... → /codexprojects/... (~100ms)
 *   - killing wsl.exe tears down the Linux tree (no orphaned processes)
 *   - exit codes forwarded verbatim
 *
 * Sandbox facts (denied/enforcement/runnerFailed) are reported with the same
 * bwrap dialect as the stock executor: denial signature 'read-only file system',
 * fatal signature 'bwrap: ', enforcement 'full'.
 *
 * Config (environment variables, mirroring how dsh-pwsh-sandbox inherits the
 * base executor's Config):
 *   - DSH_WSL_DISTRO  WSL distro (default: WSL default distro)
 *   - DSH_WSL_EXE     wsl.exe path (default: 'wsl.exe' on PATH)
 *   - DSH_WSL_BWRAP   bwrap path inside the distro (default: 'bwrap' on PATH)
 *   - DSH_WSL_ENV     comma-separated extra env var names to forward via WSLENV
 *
 * @module dsh-wsl-bash
 */
import { execFileSync } from 'node:child_process'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

export const name = 'wsl-bash'

const DENIAL_SIGNATURES = ['read-only file system'] as const
const RUNNER_FAILURE_RULES = [{ fatalSignatures: ['bwrap: '] }] as const

export default class WslBashExecutor extends LocalBashExecutor {
  static inject = ['subprocess', 'sandboxPolicy']

  wslPath: string
  distro: string | undefined
  bwrapPath: string
  extraWslEnv: string[]
  /** The configured default mode — the capability fact the tool layer reads. */
  mode: import('@deepseek-ai/dsh-sandbox').SandboxMode
  /** Per-process confinement facts retained until settlement. */
  processFacts = new Map()
  /** Cache wslpath translations per Windows path (bounded). */
  pathCache = new Map<string, string>()

  constructor(ctx: import('@deepseek-ai/cordis').Context, config: Record<string, unknown>) {
    super(ctx, config)
    this.wslPath = (process.env.DSH_WSL_EXE || 'wsl.exe').trim() || 'wsl.exe'
    this.distro = (process.env.DSH_WSL_DISTRO || '').trim() || undefined
    this.bwrapPath = (process.env.DSH_WSL_BWRAP || 'bwrap').trim() || 'bwrap'
    this.extraWslEnv = (process.env.DSH_WSL_ENV || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    this.mode = ctx.sandboxPolicy.defaultMode
  }

  /** The configured default mode — required by dsh-permission-presets. */
  get sandboxMode() { return this.mode }

  /** Prefix argv for the wsl.exe invocation (distro + --exec). */
  wslPrefix(): string[] {
    const argv = [this.wslPath]
    if (this.distro) argv.push('-d', this.distro)
    argv.push('--exec')
    return argv
  }

  /** Translate a Windows path to its WSL path via `wslpath -a` (cached). */
  toWslPath(winPath: string): string {
    const hit = this.pathCache.get(winPath)
    if (hit !== undefined) return hit
    try {
      const out = execFileSync(this.wslPath, [...(this.distro ? ['-d', this.distro] : []), '--exec', 'wslpath', '-a', winPath], { encoding: 'utf8' }).trim()
      if (out.length === 0) throw new Error('wslpath returned empty')
      if (this.pathCache.size >= 256) this.pathCache.clear()
      this.pathCache.set(winPath, out)
      return out
    } catch (error) {
      throw new SandboxUnavailableError('workspace-write', 'failed to translate workspace path for WSL: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Stamp the per-call sandbox policy and forward WSLENV. Mirrors
   * SandboxBashExecutor.resolve (policy) plus WSL env bridging.
   */
  resolve(request: import('@deepseek-ai/dsh-shell').ShellExecRequest): import('@deepseek-ai/dsh-shell').ShellExecSpec {
    const spec = super.resolve(request)
    const policy = request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const keys = new Set(this.extraWslEnv)
    for (const key of Object.keys(spec.dshEnv ?? {})) keys.add(key)
    for (const key of Object.keys(spec.env ?? {})) {
      if (key.startsWith(DSH_ENV_PREFIX)) keys.add(key)
    }
    keys.delete('WSLENV')
    keys.delete('WSL_UTF8')
    const env: Record<string, string> = { ...(spec.env ?? {}), WSL_UTF8: '1' }
    if (keys.size > 0) {
      const existing = process.env.WSLENV ?? ''
      const list = [...keys].join(':')
      env.WSLENV = existing ? existing + ':' + list : list
    }
    return { ...spec, env, sandboxPolicy: policy }
  }

  /**
   * Build the confined argv for one command under `policy`. Returns the argv
   * plus sandbox classification facts (denial signature, enforcement, runner
   * failure rules). danger-full-access returns a plain wsl bash argv.
   */
  confine(command: string, policy: import('@deepseek-ai/dsh-sandbox').SandboxExecutionPolicy) {
    if (policy.mode === 'danger-full-access') {
      return {
        argv: [...this.wslPrefix(), 'bash', '-lc', command],
        enforcement: 'full' as const,
        denialSignatures: DENIAL_SIGNATURES,
        runnerFailureRules: RUNNER_FAILURE_RULES,
      }
    }
    const profile = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
    if (policy.mode === 'workspace-write') {
      const ws = this.toWslPath(policy.workspaceRoot)
      profile.push('--tmpfs', '/tmp', '--bind', ws, ws)
    }
    return {
      argv: [...this.wslPrefix(), this.bwrapPath, ...profile, '--', 'bash', '-c', command],
      enforcement: 'full' as const,
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
    }
  }

  /** Classify a settled process against the bwrap denial dialect. */
  classifyDenial(result: { exitCode: number | null; stderr: { text: string } }): boolean {
    if (result.exitCode === null || result.exitCode === 0) return false
    const lowered = result.stderr.text.toLowerCase()
    return DENIAL_SIGNATURES.some((sig) => lowered.includes(sig.toLowerCase()))
  }

  /** Classify a settled process against the bwrap runner-failure rule. */
  classifyRunnerFailure(result: { exitCode: number | null; stderr: { text: string } }): boolean {
    if (result.exitCode === null || result.exitCode === 0) return false
    return RUNNER_FAILURE_RULES.some((rule) =>
      rule.fatalSignatures.some((sig) => result.stderr.text.toLowerCase().includes(sig.toLowerCase()))
    )
  }

  async run(spec: import('@deepseek-ai/dsh-shell').ShellExecSpec) {
    const policy = spec.sandboxPolicy!
    if (policy.mode === 'danger-full-access') {
      return {
        ...(await super.run(spec)),
        sandbox: { mode: policy.mode, denied: false },
      }
    }
    const confined = this.confine(spec.command, policy)
    let result
    try {
      result = await this.runArgv(spec, confined.argv)
    } catch (error) {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
      throw new SandboxUnavailableError(policy.mode, String(error))
    }
    const runnerFailed = this.classifyRunnerFailure(result)
    if (runnerFailed) throw new SandboxUnavailableError(policy.mode)
    return {
      ...result,
      sandbox: {
        mode: policy.mode,
        denied: this.classifyDenial(result),
        enforcement: confined.enforcement,
      },
    }
  }

  start(spec: import('@deepseek-ai/dsh-shell').ShellExecSpec) {
    const policy = spec.sandboxPolicy!
    if (policy.mode === 'danger-full-access') {
      return super.start(spec)
    }
    const confined = this.confine(spec.command, policy)
    let proc
    try {
      proc = this.startArgv(spec, confined.argv)
    } catch (error) {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
      throw new SandboxUnavailableError(policy.mode, String(error))
    }
    const facts = { mode: policy.mode, enforcement: confined.enforcement, denialSignatures: DENIAL_SIGNATURES, runnerFailureRules: RUNNER_FAILURE_RULES }
    this.processFacts.set(proc, facts)
    return proc
  }

  /** Stamp per-process sandbox facts before done settles (background jobs). */
  onProcessDone(proc: any, stderr: string, spawnFailed: boolean, spawnError?: unknown) {
    const facts = this.processFacts.get(proc)
    if (facts !== undefined) {
      this.processFacts.delete(proc)
      const runnerFailed = spawnFailed
        ? true
        : this.classifyRunnerFailure({ exitCode: proc.exitCode, stderr: { text: stderr } })
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && this.classifyDenial({ exitCode: proc.exitCode, stderr: { text: stderr } }),
        enforcement: facts.enforcement,
        ...(runnerFailed ? { runnerFailed } : {}),
      }
    }
    super.onProcessDone(proc, stderr, spawnFailed, spawnError)
  }
}
