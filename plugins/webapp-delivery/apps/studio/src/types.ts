import type { ProductBlueprint } from '@agent-ops/blueprint';
import type { DeliveryState } from '@agent-ops/delivery-workflow';

export type Project = {
  id: string;
  name: string;
  productType: string;
  state: DeliveryState;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = Project & { blueprint: ProductBlueprint };

export type ActivityEntry = { id: string; text: string; time: string };

export type BaselineApproval = {
  projectId: string;
  blueprintRevision: number;
  status: 'approved';
  approvedBy: string;
  approvedAt: string;
};

export type ApplyStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
};

export type ApplyRun = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  recoveryIndex: number;
  workspacePath: string;
  steps: ApplyStep[];
  createdAt: string;
  updatedAt: string;
};

export type DependencyReadiness = {
  status: 'not-applied' | 'missing-dependencies' | 'ready';
  workspacePath: string | null;
  packageLockPresent: boolean;
  nodeModulesPresent: boolean;
  qualityCommandPresent: boolean;
  nextAction: string;
};

export type QualityGateResult = {
  status: 'passed' | 'failed';
  command: string;
  exitCode: number;
  output: string;
  completedAt: string;
};

export type DependencyInstallResult = {
  status: 'installed' | 'failed';
  exitCode: number;
  output: string;
  completedAt: string;
};

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineStep = {
  id: string;
  name: string;
  profileId: string;
  prompt: string;
  dependsOn?: string[];
  outputArtifact?: string;
  continueOnFailure?: boolean;
  requiresApproval?: boolean;
};

export type PipelineStepResult = {
  stepId: string;
  status: PipelineStepStatus;
  output?: string;
  runtimeRunId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type FeatureTaskPipeline = {
  steps: PipelineStep[];
  currentStepIndex: number;
  results: PipelineStepResult[];
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  startedAt?: string;
  completedAt?: string;
};

export type FeatureTask = {
  id: string;
  blueprintRevision: number;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  status: 'draft' | 'approved';
  approvedBy?: string;
  approvedAt?: string;
  pipeline?: FeatureTaskPipeline;
};

export type RuntimeAttempt = {
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    output: string;
  };
};

export type RuntimeRun = {
  id: string;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskId: string;
  blueprintRevision: number;
  agentId: string;
  attempts: number;
  history: RuntimeAttempt[];
  plan: {
    mode: 'dry-run' | 'execute';
    executionAllowed: boolean;
    noExternalChanges: boolean;
    command: string[];
  };
  result?: {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    output: string;
  };
};

export type GitEvidence = {
  branch: string;
  head: string;
  status: string;
  diffStat: string;
};

export type PrEvidence = {
  url: string;
  checks: string[];
  recordedAt: string;
};

export type PreviewEvidence = {
  apiUrl: string;
  webUrl: string;
  smokeTest: string;
  recordedAt: string;
};

export type AcceptanceRecord = {
  status: 'blocked' | 'ready' | 'approved';
  summary: string;
  criteriaConfirmed: boolean;
  qualityStatus: 'passed' | 'failed' | 'missing';
  approvedBy?: string;
  approvedAt?: string;
};

export type ProviderPlan = {
  providerId: string;
  idempotencyKey: string;
  noExternalChanges: true;
  resources: {
    spec: { id: string; kind: string; owner: string };
    action: 'create' | 'update' | 'noop';
    reason: string;
  }[];
};

export type ProviderVerification = {
  providerId: string;
  verified: boolean;
  missing: string[];
  mismatched: string[];
};

export type AgentDescriptor = {
  id: string;
  name: string;
  source: 'built-in' | 'custom';
  launchCommand: string;
  detected: boolean;
  version: string | null;
  detail: string;
  capabilities: string[];
  // Whether the execution contract for this Agent has been exercised. Separate from `detected`,
  // which only says the CLI is installed: an installed Agent with a candidate Adapter cannot run a
  // feature task, so Studio must not present the two as the same guarantee.
  adapterStatus?: 'verified' | 'candidate' | 'unsupported';
};

export type AgentCapabilityProbe = {
  agentId: string;
  // Evidence about a help page, not a verdict about the Agent: what the three readings are is derived
  // in src/lib/capability-verdict.ts. There is no workspace-write field here on purpose - the probe
  // never observed one, and the row above already shows what the catalog declares.
  nonInteractive: boolean;
  nonInteractiveFlags: string[];
  helpAvailable: boolean;
  adapterStatus: 'verified' | 'candidate' | 'unsupported';
};

export type AgentProfile = {
  id: string;
  name: string;
  description?: string;
  baseAgentId: string;
  icon?: string;
  overrides: {
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    env?: Record<string, string>;
    allowedTools?: string[];
    blockedTools?: string[];
    maxTokens?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type CredentialMeta = {
  version: 1;
  updatedAt: string;
  keys: string[];
};

// Read-only secret backend status from GET /api/credentials/backend; never carries plaintext.
export type CredentialBackendInfo = {
  type: 'local-file' | 'infisical';
  available: boolean;
  reason?: string;
  projectId?: string;
  environment?: string;
};

export type ProjectResources = {
  version: number;
  projectName: string;
  projectId: string;
  blueprintRevision: number;
  updatedAt: string;
  providers: Record<string, Record<string, unknown>>;
} | null;

export type CredentialVerifyResult = {
  providerId: string;
  status: 'valid' | 'invalid' | 'not_set';
  detail: string;
};

export type PreviewStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
};

export type PreviewDeploymentResult = {
  status: 'completed' | 'failed' | 'cancelled';
  steps: PreviewStep[];
  apiBaseUrl?: string;
  pagesUrl?: string;
  pagesUrlSource?: 'cli-output' | 'derived-fallback';
  corsOrigin?: string;
  evidence?: Record<string, string>;
  cleanupRequired?: { vercel?: string; cloudflare?: string };
};

export type WorkspaceVerification = {
  usable: boolean;
  workspaceMissing: boolean;
  missing: string[];
  staleConfig: string[];
  reason?: string;
};

export type ReleaseStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ReleaseRun = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  approvedBy: string;
  approvalSummary: string;
  steps: ReleaseStep[];
  createdAt: string;
  updatedAt: string;
};

export type ReleaseEvidence = {
  projectName: string;
  // Hosted deployment targets produce these URLs; product types distributed manually have none.
  apiBaseUrl?: string;
  webUrl?: string;
  corsOrigin?: string;
  distribution?: 'manual';
  approvedBy: string;
  approvalSummary: string;
  observations: Record<string, unknown>;
  recordedAt: string;
};

export type ReleaseSource = {
  repository: string;
  branch: string;
  acceptedCommit: string;
  checkoutPath: string;
};

export type ReleasePlan = {
  steps: ReleaseStep[];
  manualDistribution?: boolean;
  idempotencyKey: string;
  corsOrigin?: string;
  productionApproval: string;
  state: string;
  workspace: WorkspaceVerification;
  releaseRun: ReleaseRun | null;
  source: ReleaseSource | null;
  sourceReason?: string;
};

export type View =
  | { kind: 'dashboard' }
  | { kind: 'project'; projectId: string; tab: ProjectTab }
  | { kind: 'credentials' }
  | { kind: 'agents' }
  | { kind: 'activity' }
  | { kind: 'tasks' }
  | { kind: 'roles' };

export type ProjectTab =
  | 'blueprint'
  | 'delivery'
  | 'iteration'
  | 'release';

// The kernel Task/Run control plane (server-core). Studio only renders these records; it never
// derives state from them, so the shapes mirror `TaskRecord`/`RunRecord` from @agent-ops/storage-core
// without pulling that package into the webapp plugin.
export type KernelTaskState = 'queued' | 'running' | 'review' | 'done' | 'failed' | 'cancelled';

export type KernelTask = {
  id: string;
  repo: string;
  baseRef: string;
  worktreePath: string;
  recipe: string;
  title: string;
  objective: string;
  status: KernelTaskState;
  pipeline?: TaskPipeline | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskPipelineStep = {
  id: string;
  name: string;
  roleId?: string;
  profileId?: string;
  agentId?: string;
  prompt?: string;
  requiresApproval?: boolean;
};

export type TaskPipelineStepResult = {
  stepId: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  runId?: string;
  commitSha?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TaskPipeline = {
  steps: TaskPipelineStep[];
  results: TaskPipelineStepResult[];
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
};

export type KernelRunArtifacts = {
  output: string;
  outputTruncated: boolean;
  diff: string;
  diffTruncated: boolean;
  changedFiles: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type KernelRun = {
  id: string;
  taskId: string;
  agentId: string;
  status: KernelTaskState;
  diffStat: string;
  artifacts?: KernelRunArtifacts;
  commitSha?: string;
  roleId?: string | null;
  runtimeId?: string | null;
  runtimeVersion?: string | null;
  command?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type RoleApprovalMode = 'auto' | 'human' | 'strict';

export type RoleRuntimePolicy = {
  allowedTools: string[];
  blockedTools: string[];
  approvalMode: RoleApprovalMode;
};

/** Mirrors `AgentRole` in `@agent-ops/agent-runtime/roles` for the browser. */
export type AgentRole = {
  id: string;
  name: string;
  description?: string;
  baseAgentId?: string;
  profileId?: string;
  systemPrompt?: string;
  acceptanceCriteria: string[];
  runtimePolicy: RoleRuntimePolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

