import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
export declare const name = "wsl-bash";
export default class WslBashExecutor extends LocalBashExecutor {
    static inject: string[];
    wslPath: string;
    distro: string | undefined;
    bwrapPath: string;
    extraWslEnv: string[];
    /** The configured default mode — the capability fact the tool layer reads. */
    mode: import('@deepseek-ai/dsh-sandbox').SandboxMode;
    /** Per-process confinement facts retained until settlement. */
    processFacts: Map<any, any>;
    /** Cache wslpath translations per Windows path (bounded). */
    pathCache: Map<string, string>;
    constructor(ctx: import('@deepseek-ai/cordis').Context, config: Record<string, unknown>);
    /** The configured default mode — required by dsh-permission-presets. */
    get sandboxMode(): import("@deepseek-ai/dsh-sandbox").SandboxMode;
    /** Prefix argv for the wsl.exe invocation (distro + --exec). */
    wslPrefix(): string[];
    /** Translate a Windows path to its WSL path via `wslpath -a` (cached). */
    toWslPath(winPath: string): string;
    /**
     * Stamp the per-call sandbox policy and forward WSLENV. Mirrors
     * SandboxBashExecutor.resolve (policy) plus WSL env bridging.
     */
    resolve(request: import('@deepseek-ai/dsh-shell').ShellExecRequest): import('@deepseek-ai/dsh-shell').ShellExecSpec;
    /**
     * Build the confined argv for one command under `policy`. Returns the argv
     * plus sandbox classification facts (denial signature, enforcement, runner
     * failure rules). danger-full-access returns a plain wsl bash argv.
     */
    confine(command: string, policy: import('@deepseek-ai/dsh-sandbox').SandboxExecutionPolicy): {
        argv: string[];
        enforcement: "full";
        denialSignatures: readonly ["read-only file system"];
        runnerFailureRules: readonly [{
            readonly fatalSignatures: readonly ["bwrap: "];
        }];
    };
    /** Classify a settled process against the bwrap denial dialect. */
    classifyDenial(result: {
        exitCode: number | null;
        stderr: {
            text: string;
        };
    }): boolean;
    /** Classify a settled process against the bwrap runner-failure rule. */
    classifyRunnerFailure(result: {
        exitCode: number | null;
        stderr: {
            text: string;
        };
    }): boolean;
    run(spec: import('@deepseek-ai/dsh-shell').ShellExecSpec): Promise<{
        sandbox: {
            mode: "danger-full-access";
            denied: boolean;
            enforcement?: undefined;
        };
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        aborted: boolean;
        timeoutMs: number;
        stdout: import("@deepseek-ai/dsh-shell").CollectedOutput;
        stderr: import("@deepseek-ai/dsh-shell").CollectedOutput;
    } | {
        sandbox: {
            mode: "read-only" | "workspace-write";
            denied: boolean;
            enforcement: "full";
        };
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        aborted: boolean;
        timeoutMs: number;
        stdout: import("@deepseek-ai/dsh-shell").CollectedOutput;
        stderr: import("@deepseek-ai/dsh-shell").CollectedOutput;
    }>;
    start(spec: import('@deepseek-ai/dsh-shell').ShellExecSpec): import("@deepseek-ai/dsh-shell").ShellProcess;
    /** Stamp per-process sandbox facts before done settles (background jobs). */
    onProcessDone(proc: any, stderr: string, spawnFailed: boolean, spawnError?: unknown): void;
}
