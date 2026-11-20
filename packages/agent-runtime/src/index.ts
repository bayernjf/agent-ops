import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { probeAgentVersion } from './catalog.js';
export { discoverAgentRuntimes, probeAgentCapabilities, probeAgentVersion, resolveExecutablePath, resolveProbeExecutable, runProbe, type AgentDescriptor, type AgentCapability, type CustomAgentInput, type AgentSource, type CapabilityProbe, type ProbeSpawn, type ProbeResult } from './catalog.js';
export {
  type AgentAdapterStatus,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeCommandPolicy,
  RuntimeRegistry,
  runtimeRegistry,
  getRuntimeAdapter,
  getAgentAdapterStatus,
} from './runtime-registry.js';
import { getRuntimeAdapter, getAgentAdapterStatus, type AgentAdapterStatus } from './runtime-registry.js';
export {
  type RuntimeToolPolicy,
  type ToolPolicyEnforcement,
  type ResolvedToolPolicy,
  type CanonicalToolPolicy,
  type ToolDecision,
  type ToolPolicyCapability,
  type UnifiedPolicyVerdict,
  normalizeToolName,
  hasRestrictedToolPolicy,
  isReadOnlyToolPolicy,
  isReadOnlyTool,
  effectiveAllowedTools,
  evaluateToolPolicy,
  resolveToolPolicy,
  KNOWN_WRITE_TOOLS,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  KNOWN_TOOL_NAMES,
} from './tool-policy.js';
import { resolveToolPolicy, hasRestrictedToolPolicy, type RuntimeToolPolicy, type ResolvedToolPolicy } from './tool-policy.js';
import type { AgentRole } from './roles.js';
export {
  type AgentRole,
  type CostBudget,
  type RoleApprovalMode,
  type RoleRuntimePolicy,
  type RoleRuntimeResolution,
  roleRuntimePolicySchema,
  costBudgetSchema,
  agentRoleSchema,
  agentRoleCreateSchema,
  agentRoleUpdateSchema,
  slugifyRoleName,
  ensureUniqueRoleId,
  resolveRoleRuntime,
} from './roles.js';
export {
  type AgentTeam,
  type TeamHandoff,
  type TeamGraphIssue,
  teamHandoffSchema,
  agentTeamSchema,
  agentTeamCreateSchema,
  agentTeamUpdateSchema,
  validateTeamGraph,
  orderTeamRoles,
  slugifyTeamName,
  ensureUniqueTeamId,
} from './teams.js';
export {
  type RoleTemplate,
  roleTemplates,
  getRoleTemplate,
} from './role-templates.js';
export {
  type ToolCallAudit,
  type ToolAudit,
  TOOL_AUDIT_LIMIT,
  extractToolAudit,
} from './tool-audit.js';
export {
  type AgentProfile,
  type AgentProfileOverrides,
  type ResolvedAgentConfig,
  type BaseAgentDefaults,
  agentProfileSchema,
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
  slugifyProfileName,
  ensureUniqueProfileId,
  mergeAgentConfig,
  validateProfileTools,
  validateProfileEnv,
  filterSafeEnv,
} from './profiles.js';
export {
  type PipelineStep,
  type PipelineStepStatus,
  type PipelineStepResult,
  type FeatureTaskPipeline,
  pipelineStepSchema,
  featureTaskPipelineSchema,
  createPipelineStepSchema,
  resolvePipelinePrompt,
  getNextPipelineStep,
  isPipelineComplete,
} from './pipeline.js';
export {
  type FailureCategory,
  type FailureSeverity,
  type FailureClassification,
  classifyFailure,
  categoryLabel,
  severityLabel,
} from './failure-classification.js';
export {
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorReport,
  runDoctor,
  formatDoctorSummary,
} from './doctor.js';
import type { AgentProfile } from './profiles.js';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NO_COLOR'];
const MAX_OUTPUT_LENGTH = 2_000_000;

export type ApprovedTask = {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  priority?: string;
};

export type CodexRuntimeProbe = {
  command: 'codex';
  available: boolean;
  version: string | null;
  executionVerified: false;
  reason: string;
};

/**
 * Reasons a runner can refuse to start a process, as opposed to reporting how one exited.
 *
 * A refusal still has to travel through CodexExecutionResult because every caller already handles
 * `exitCode === null`, and a boolean "did it run" would be re-derived in each of them.
 */
export type CodexExecutionErrorCode = 'unsupported_platform';

export type CodexExecutionUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
};

export type CodexExecutionResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled?: boolean;
  output: string;
  startedAt: string;
  completedAt: string;
  /** Runtime version probed from the executed command, when available. */
  runtimeVersion?: string | null;
  /** Usage and cost reported by a Runtime that exposes them; absent means "not reported". */
  usage?: CodexExecutionUsage;
  /** Set only when the runner declined to spawn; `output` then carries the reason for humans. */
  errorCode?: CodexExecutionErrorCode;
};

/**
 * Windows is rejected up front by decision ④ in handoff.md §9: every supported CLI (codex, claude,
 * opencode, openclaw, codebuddy) ships as an npm `.cmd` shim that a shell-less spawn cannot resolve.
 * The old behaviour surfaced that as a bare `spawn ENOENT`, which reads like a broken install and
 * leaves the run looking like it merely failed rather than refused. Resolving shims correctly means
 * adding a command-injection surface (cross-spawn or hand-rolled quoting), and the Pilot target is
 * macOS, so the honest answer until a real Windows Pilot exists is an explicit refusal.
 */
export const WINDOWS_EXECUTION_UNSUPPORTED_CODE: CodexExecutionErrorCode = 'unsupported_platform';

export function describeWindowsExecutionUnsupported(command: string): string {
  return [
    `Agent execution is not supported on Windows yet (refused before launching "${command}").`,
    'Agent CLIs are installed as npm .cmd shims, which this runner starts without a shell, so they cannot be resolved.',
    'Next steps: run Agent-Dev on macOS or Linux, or use WSL. A native Windows execution path needs a shim-resolution design and a real Windows Pilot to verify it.',
  ].join(' ');
}

export type CodexExecutionPlan = {
  mode: 'dry-run' | 'execute';
  taskId: string;
  workspacePath: string;
  command: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  noExternalChanges: boolean;
  executionAllowed: boolean;
  /** When the run uses an Agent Profile, this is the profile ID. */
  profileId?: string;
  /** Base agent ID resolved from the profile (or the direct agentId). */
  baseAgentId: string;
  /** Additional environment variables from profile overrides, merged into execution env. */
  profileEnv?: Record<string, string>;
  /** Role that supplied the tool policy, when the run was created from one. */
  roleId?: string;
  /** What the Adapter can actually enforce, plus any warnings about coarse mapping. */
  toolPolicy?: ResolvedToolPolicy;
};

export function probeCodexRuntime(): CodexRuntimeProbe {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return {
    command: 'codex',
    available: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
    executionVerified: false,
    reason: result.error ? 'Codex CLI is not available on PATH.' : 'CLI presence is detected, but authenticated write execution is not verified.',
  };
}

export function buildAgentExecutionPlan(
  task: ApprovedTask,
  workspacePath: string,
  agentId: string,
  options: { execute?: boolean; profile?: AgentProfile; toolPolicy?: RuntimeToolPolicy; roleId?: string; role?: AgentRole; instruction?: string } = {},
): CodexExecutionPlan {
  const execute = options.execute === true;
  const profile = options.profile;
  const role = options.role;
  // When a profile is provided, resolve the base agent from the profile.
  const resolvedAgentId = profile?.baseAgentId ?? agentId;
  const promptParts = [buildTaskPrompt(task)];
  if (options.instruction?.trim()) promptParts.push(`---\nStep instruction:\n${options.instruction.trim()}`);
  if (role) promptParts.push(buildRolePromptSection(role));
  // Append profile system prompt after the task and Role prompts.
  if (profile?.overrides.systemPrompt) promptParts.push(`---\n${profile.overrides.systemPrompt}`);
  const prompt = promptParts.join('\n\n');
  const adapter = getRuntimeAdapter(resolvedAgentId);
  if (!adapter) throw new Error(`Agent "${resolvedAgentId}" does not have a candidate execution adapter.`);
  if (execute && adapter.status !== 'verified') throw new Error(`Agent "${resolvedAgentId}" has a candidate or experimental adapter but has not passed execution verification.`);
  const toolPolicy = options.toolPolicy ?? role?.runtimePolicy;
  const resolvedPolicy = toolPolicy && hasRestrictedToolPolicy(toolPolicy)
    ? resolveToolPolicy(adapter, toolPolicy)
    : undefined;
  return {
    mode: execute ? 'execute' : 'dry-run',
    taskId: task.id,
    workspacePath,
    command: adapter.buildCommand(
      prompt,
      workspacePath,
      resolvedPolicy
        ? { readOnly: resolvedPolicy.readOnly, allowedTools: resolvedPolicy.allowedTools, blockedTools: resolvedPolicy.blockedTools }
        : undefined,
    ),
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: !execute,
    executionAllowed: execute,
    profileId: profile?.id,
    baseAgentId: resolvedAgentId,
    profileEnv: profile?.overrides.env,
    roleId: role?.id ?? options.roleId,
    toolPolicy: resolvedPolicy,
  };
}

export function isAgentExecutable(agentId: string): boolean {
  return getAgentAdapterStatus(agentId) === 'verified';
}

// Blueprint runtime providers are namespaced (`local-opencode`) to say the runtime lives on this
// machine; the Adapter registry keys are bare (`opencode`). The strip lived inline in two storage
// methods and nowhere else, so every caller that resolved a Blueprint provider against the registry
// got 'unsupported' for a perfectly verified Agent and quietly fell back to Codex.
//
// Agent Profile ids are unprefixed, so they pass through untouched and are resolved against the
// Profile store afterwards by resolveRuntimeExecutor.
export function runtimeProviderAgentId(provider: string): string {
  return provider.startsWith('local-') ? provider.slice('local-'.length) : provider;
}

/** Who a run would actually be launched as, after the provider namespace and Profile resolution. */
export type RuntimeExecutor = {
  /** Id exactly as the caller named it (`local-opencode`, a Profile id, or a bare agent id). */
  requestedId: string;
  /** Bare Adapter registry key the task would run on. */
  agentId: string;
  adapterStatus: AgentAdapterStatus;
  /** Present when requestedId referred to an Agent Profile. */
  profile?: AgentProfile;
};

export type RuntimeExecutorResolution =
  | ({ ok: true } & RuntimeExecutor)
  | ({ ok: false; reason: 'no-adapter' | 'unverified-adapter' } & RuntimeExecutor);

// Carried on the 409 of any Runtime route that refuses an executor. GET .../runtime/plan already
// answers 409 for "nothing approved yet", so the status alone cannot tell the two facts apart and
// Studio would render a refusal as an empty panel. The browser cannot import this module (it pulls
// in node:child_process), so apps/studio/src/lib/runtime-executor.ts mirrors the literal; the two
// test suites pin both copies to this string.
export const AGENT_NOT_EXECUTABLE_CODE = 'agent_not_executable';

// A second code, because the two questions a Runtime route can refuse on are not the same question.
// `agent_not_executable` is answered by the Adapter registry and holds on every machine; whether a CLI
// is installed here is answered by PATH and changes when someone uninstalls it. One code for both
// would make the registry's answer depend on the machine it ran on, and Studio would have one sentence
// for a contract it cannot verify and a binary it could not find. Mirrored in
// apps/studio/src/lib/runtime-executor.ts for the same browser-import reason as the code above.
export const AGENT_NOT_DETECTED_CODE = 'agent_not_detected';

/**
 * The single answer to "which Agent runs this task?".
 *
 * Before it existed, the strip + Profile lookup was copy-pasted per layer and each copy disagreed:
 * the daemon's plan route resolved a Blueprint provider without stripping, so every provider that
 * route knew about looked up as 'unsupported' and the route silently built a Codex plan instead -
 * a run record whose executor nobody had asked for. Callers that cannot resolve an executor must
 * refuse; substituting another Agent is what this function exists to make detectable.
 *
 * Executability is judged against the Adapter registry only, never against the catalog or PATH, so
 * the answer stays machine-independent. "Installed here" is a separate fact (`detected`) that the
 * routes report on their own.
 */
export async function resolveRuntimeExecutor(
  requestedId: string,
  getProfile: (id: string) => Promise<AgentProfile | null>,
): Promise<RuntimeExecutorResolution> {
  const stripped = runtimeProviderAgentId(requestedId);
  // A Profile owns its entire id, and Profile slugs come from user-chosen names, so one can begin with
  // `local-` on its own. Looking the id up as written first keeps such a Profile resolvable; falling
  // back to the stripped form still resolves `local-<profileId>`, which is how a Blueprint stores it.
  const profile = (await getProfile(requestedId))
    ?? (requestedId === stripped ? null : await getProfile(stripped))
    ?? undefined;
  const agentId = profile?.baseAgentId ?? stripped;
  const adapterStatus = getAgentAdapterStatus(agentId);
  if (adapterStatus === 'verified') return { ok: true, requestedId, agentId, adapterStatus, profile };
  return {
    ok: false,
    reason: adapterStatus === 'candidate' || adapterStatus === 'experimental' ? 'unverified-adapter' : 'no-adapter',
    requestedId,
    agentId,
    adapterStatus,
    profile,
  };
}

/** Refusal sentence shared by every layer that rejects an executor, so the record and the API agree. */
export function describeRuntimeExecutorRejection(executor: RuntimeExecutor): string {
  const subject = executor.profile
    ? `Profile "${executor.profile.name}" (base agent ${executor.agentId})`
    : `Agent "${executor.agentId}"`;
  return executor.adapterStatus === 'candidate' || executor.adapterStatus === 'experimental'
    ? `${subject} has a ${executor.adapterStatus} Adapter that has not passed non-interactive execution verification, so it cannot run this task.`
    : `${subject} has no execution Adapter at all, so it cannot run this task.`;
}

function buildTaskPrompt(task: ApprovedTask): string {
  return [
    `Implement the approved feature task: ${task.title}`,
    `Objective: ${task.objective}`,
    `Priority: ${task.priority ?? 'medium'}`,
    'Acceptance criteria:',
    ...task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    'Work only in this task workspace. Do not access secrets, production systems, or paths outside the workspace.',
    'After implementation, summarize changed files and remaining risks. Do not claim acceptance without evidence.',
  ].join('\n');
}

function buildRolePromptSection(role: AgentRole): string {
  const lines = [
    '---',
    `Acting Role: ${role.name} (${role.id})`,
  ];
  if (role.description) lines.push(`Role responsibility: ${role.description}`);
  if (role.systemPrompt) lines.push(role.systemPrompt);
  if (role.acceptanceCriteria.length > 0) {
    lines.push('Role acceptance criteria:');
    lines.push(...role.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`));
  }
  lines.push('Role tool policy:');
  lines.push(`- Allowed tools: ${role.runtimePolicy.allowedTools.length > 0 ? role.runtimePolicy.allowedTools.join(', ') : '(no allowlist; Runtime defaults apply)'}`);
  lines.push(`- Blocked tools: ${role.runtimePolicy.blockedTools.length > 0 ? role.runtimePolicy.blockedTools.join(', ') : '(none)'}`);
  lines.push(`- Approval mode: ${role.runtimePolicy.approvalMode}`);
  return lines.join('\n');
}

function boundedAppend(current: string, chunk: string) {
  const next = current + chunk;
  return next.length > MAX_OUTPUT_LENGTH ? `${next.slice(0, MAX_OUTPUT_LENGTH)}\n[output truncated]` : next;
}

function safeEnvironment() {
  return Object.fromEntries(SAFE_ENV_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key] as string]] : []));
}

export type CodexOutputListener = (chunk: string, stream: 'stdout' | 'stderr') => void;

export type CodexProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Called for each raw stdout/stderr chunk as the child process produces it. */
  onOutput?: CodexOutputListener;
  /** Aborting this signal terminates the child process group and resolves with `cancelled: true`. */
  signal?: AbortSignal;
};

export type CodexProcessRunner = (command: string, arguments_: string[], options: CodexProcessOptions) => Promise<CodexExecutionResult>;

/**
 * Builds the runner for one platform. Exposed so the Windows refusal is testable on macOS/Linux CI;
 * production code only ever uses `runCodexProcess`, bound to the platform it runs on.
 */
export function runCodexProcessOnPlatform(platform: NodeJS.Platform): CodexProcessRunner {
  return async (command, arguments_, options) => {
    if (platform === 'win32') {
      const refusedAt = new Date().toISOString();
      return {
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: options.signal?.aborted,
        errorCode: WINDOWS_EXECUTION_UNSUPPORTED_CODE,
        output: describeWindowsExecutionUnsupported(command),
        startedAt: refusedAt,
        completedAt: refusedAt,
        runtimeVersion: null,
      };
    }
    // A missing or failed version probe must not block or fail the actual run.
    const runtimeVersion = await probeAgentVersion(command).catch(() => null);
    return new Promise(resolve => {
      const startedAt = new Date().toISOString();
      const child: ChildProcess = spawn(command, arguments_, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let timedOut = false;
      let cancelled = false;
      let exited = false;
      let timeout: NodeJS.Timeout | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const emit = (chunk: string, stream: 'stdout' | 'stderr') => {
        if (!options.onOutput) return;
        try {
          options.onOutput(chunk, stream);
        } catch {
          // A listener must never break the child-process lifecycle.
        }
      };
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (exited || cancelled) return;
        cancelled = true;
        if (timeout) clearTimeout(timeout);
        child.kill('SIGTERM');
        // A child that ignores SIGTERM must not keep the cancellation hanging forever.
        killTimer = setTimeout(() => {
          if (!exited) child.kill('SIGKILL');
        }, 5_000);
        killTimer.unref();
      };
      child.stdout?.on('data', chunk => {
        const text = String(chunk);
        emit(text, 'stdout');
        output = boundedAppend(output, text);
      });
      child.stderr?.on('data', chunk => {
        const text = String(chunk);
        emit(text, 'stderr');
        output = boundedAppend(output, text);
      });
      child.once('error', error => {
        exited = true;
        cleanup();
        resolve({ exitCode: null, signal: null, timedOut, cancelled, output: boundedAppend(output, error.message), startedAt, completedAt: new Date().toISOString(), runtimeVersion });
      });
      child.once('close', (exitCode, signal) => {
        exited = true;
        cleanup();
        resolve({ exitCode, signal, timedOut, cancelled, output, startedAt, completedAt: new Date().toISOString(), runtimeVersion });
      });
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // `child.killed` only records that a signal was delivered, so it is already true here and can
        // never report whether the process actually died. An agent that keeps working through SIGTERM
        // has to be escalated against observed exit, otherwise the timeout bounds nothing.
        killTimer = setTimeout(() => {
          if (!exited) child.kill('SIGKILL');
        }, 5_000);
        killTimer.unref();
      }, options.timeoutMs);
      if (options.signal) {
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  };
}

export const runCodexProcess: CodexProcessRunner = runCodexProcessOnPlatform(process.platform);

// A real feature task spends most of its wall clock inside model turns, not inside the shell. The
// first live run on this machine was still reading files at 5m22s, so a three-minute bound cut off
// work that was progressing normally and reported it as a failure.
const DEFAULT_EXECUTION_TIMEOUT_MS = 900_000;

export type ExecutePlanOptions = {
  onOutput?: CodexOutputListener;
  signal?: AbortSignal;
};

export async function executeCodexPlan(
  plan: CodexExecutionPlan,
  runner: CodexProcessRunner = runCodexProcess,
  timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
  options: ExecutePlanOptions = {},
) {
  if (!plan.executionAllowed || plan.mode !== 'execute' || plan.noExternalChanges) {
    throw new Error('Agent execution requires an explicitly approved execute plan.');
  }
  const env = { ...safeEnvironment(), ...(plan.profileEnv ?? {}) };
  return runner(plan.command[0], plan.command.slice(1), {
    cwd: plan.workspacePath,
    env,
    timeoutMs,
    ...options,
  });
}
