import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentAdapterStatus = 'verified' | 'candidate' | 'experimental' | 'unsupported';

export type RuntimeCapabilities = {
  /** The Adapter can run a task without a human sitting at the CLI. */
  nonInteractive: boolean;
  /** The Adapter emits output incrementally instead of only at exit. */
  streaming: boolean;
  /** The Adapter emits machine-readable output rather than only prose. */
  structuredOutput: boolean;
  /** The Adapter can continue a previous session by id. */
  sessionResume: boolean;
  /** How tool permissions map onto this Runtime. */
  toolPolicy: 'native' | 'wrapper' | 'unsupported';
  /** The Adapter is expected to confine writes to the task worktree. */
  worktreeSafe: boolean;
};

export type RuntimeCommandPolicy = {
  readOnly: boolean;
  allowedTools: string[];
  blockedTools: string[];
};

export type RuntimeAdapter = {
  id: string;
  status: Exclude<AgentAdapterStatus, 'unsupported'>;
  capabilities: RuntimeCapabilities;
  buildCommand: (prompt: string, workspacePath: string, policy?: RuntimeCommandPolicy) => string[];
};

/**
 * A registry, not a switch. The kernel asks for an Adapter by id; adding a Runtime is a
 * registration instead of another branch in the execution path. The default entries are the
 * adapters that already existed; their commands and verification statuses are unchanged.
 */
export class RuntimeRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    if (!adapter.id.trim() || adapter.id.trim() !== adapter.id) {
      throw new Error('Runtime Adapter id must be a non-empty, trimmed string.');
    }
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Runtime Adapter "${adapter.id}" is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): RuntimeAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  capabilities(id: string): RuntimeCapabilities | null {
    return this.adapters.get(id)?.capabilities ?? null;
  }

  status(id: string): AgentAdapterStatus {
    return this.adapters.get(id)?.status ?? 'unsupported';
  }
}

export const runtimeRegistry = new RuntimeRegistry();

runtimeRegistry.register({
  id: 'codex',
  status: 'verified',
  capabilities: {
    nonInteractive: true,
    streaming: true,
    structuredOutput: true,
    sessionResume: false,
    toolPolicy: 'native',
    worktreeSafe: true,
  },
  // Adapters with status 'verified' have passed a locally exercised execution contract.
  // Candidate adapters are present but not yet verified end-to-end.
  buildCommand: (prompt, cwd, policy) => ['codex', 'exec', '--json', '--ephemeral', '--sandbox', policy?.readOnly ? 'read-only' : 'workspace-write', '--cd', cwd, prompt],
});

runtimeRegistry.register({
  id: 'claude-code',
  status: 'candidate',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: true,
    sessionResume: false,
    toolPolicy: 'native',
    worktreeSafe: true,
  },
  // Claude Code has no `--cwd` flag; the working directory is set by the spawn cwd option.
  // `--dangerously-skip-permissions` avoids interactive approval prompts in the isolated task workspace.
  // `--output-format json` gives structured output parseable by the same runner as Codex.
  buildCommand: (prompt, _cwd, policy) => {
    const allowedTools = policy?.allowedTools.length ? policy.allowedTools.join(',') : 'Read,Write,Edit,Bash';
    return ['claude', '-p', prompt, '--allowedTools', allowedTools, '--dangerously-skip-permissions', '--output-format', 'json'];
  },
});

runtimeRegistry.register({
  id: 'aider',
  status: 'candidate',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: false,
    sessionResume: false,
    toolPolicy: 'unsupported',
    worktreeSafe: true,
  },
  // Aider has no `--cwd` flag; the working directory is set by the spawn cwd option.
  // `--message` sends a single prompt, `--yes-always` auto-accepts all prompts.
  buildCommand: (prompt, _cwd) => ['aider', '--message', prompt, '--yes-always'],
});

runtimeRegistry.register({
  id: 'opencode',
  status: 'verified',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: false,
    sessionResume: false,
    toolPolicy: 'unsupported',
    worktreeSafe: true,
  },
  // OpenCode 2.0 (`lildax`) dropped the v1 `-p --print` interface, so tasks run through the
  // session-based driver script. The default model is the free `nemotron-3-ultra-free` from the
  // built-in `opencode` provider: it is the strongest free model verified working on the Zen
  // gateway (1M context / 128K output), avoiding the exhausted paid/plan quota that blocks Codex
  // and the deprecated/rate-limited free models (`hy3-free`, `big-pickle`, `ling-3.0-flash-free`).
  // Execution contract exercised locally: the driver wrote a file, ran `ls`, and exited 0.
  buildCommand: (prompt, cwd) => {
    const promptDir = join(tmpdir(), 'agent-ops-opencode');
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, `${randomUUID()}.md`);
    writeFileSync(promptFile, prompt);
    const driver = fileURLToPath(new URL('../scripts/opencode2-driver.mjs', import.meta.url));
    return ['node', driver, cwd, 'nemotron-3-ultra-free', 'opencode', `--prompt=${promptFile}`];
  },
});

runtimeRegistry.register({
  id: 'openclaw',
  status: 'candidate',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: true,
    sessionResume: false,
    toolPolicy: 'unsupported',
    worktreeSafe: true,
  },
  // OpenClaw runs an embedded agent turn via `agent --local --agent main --message`. No `--cwd` flag;
  // the working directory is set by the spawn cwd option. `--json` gives structured output.
  buildCommand: (prompt, _cwd) => ['openclaw', 'agent', '--local', '--agent', 'main', '--message', prompt, '--json'],
});

runtimeRegistry.register({
  id: 'codebuddy',
  status: 'verified',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: false,
    sessionResume: false,
    toolPolicy: 'unsupported',
    worktreeSafe: true,
  },
  // CodeBuddy runs non-interactively via `-p`, with permissions bypassed because it executes inside
  // an already-isolated task workspace. `--no-session-persistence` keeps each run stateless.
  // Execution contract exercised locally: `codebuddy -p ... "READY"` returned the response and
  // exited 0, and the child is captured through the same stdout/stderr runner as Codex.
  buildCommand: (prompt, _cwd) => ['codebuddy', '-p', '--permission-mode', 'bypassPermissions', '--no-session-persistence', prompt],
});

runtimeRegistry.register({
  id: 'hermes',
  status: 'verified',
  capabilities: {
    nonInteractive: true,
    streaming: false,
    structuredOutput: false,
    sessionResume: false,
    toolPolicy: 'unsupported',
    worktreeSafe: true,
  },
  // Hermes one-shot mode: `-z PROMPT` prints only the final response to stdout.
  // `--in DIR` sets the working directory, `--yolo` bypasses dangerous command approvals.
  // Execution contract exercised locally: `hermes -z "Create hello.txt" --in /tmp --yolo`
  // created the file with correct content and exited 0.
  buildCommand: (prompt, cwd) => ['hermes', '-z', prompt, '--in', cwd, '--yolo'],
});

export function getRuntimeAdapter(id: string): RuntimeAdapter | undefined {
  return runtimeRegistry.get(id);
}

export function getAgentAdapterStatus(id: string): AgentAdapterStatus {
  return runtimeRegistry.status(id);
}
