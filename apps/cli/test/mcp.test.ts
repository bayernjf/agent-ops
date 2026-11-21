import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentOpsStore } from '@agent-ops/storage-webapp';
import { createDaemonApp } from '@agent-ops/daemon';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import { createAgentOpsMcpServer } from '../src/mcp.js';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

const textOf = (result: ToolCallResult): string => {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const first = content?.[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
};

// The bridge is tested against a real HTTP listener over the real daemon app, so a green test
// proves the whole path: MCP client -> bridge -> daemon route -> store.
async function startBridge(): Promise<Client> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-ops-mcp-'));
  const store = await AgentOpsStore.open(join(directory, 'agent-ops.sqlite'));
  const { app } = createDaemonApp(store);
  const httpServer = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>(resolve => httpServer.once('listening', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('The test daemon did not bind a port.');
  const mcpServer = createAgentOpsMcpServer({ daemonBaseUrl: `http://127.0.0.1:${address.port}` });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await mcpServer.close();
    await new Promise<void>((resolve, reject) => httpServer.close(error => (error ? reject(error) : resolve())));
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return client;
}

// Connector preflight/account discovery spawn real CLIs by default, and so does the runtime catalog:
// discovery walks all eight built-in commands in sequence with a 5 s version-probe budget each, which
// is more than the 5 s a test is given, so this helper timed out on 2 of 8 full runs while only ever
// meaning to check that the bridge reaches the route. Stub all three and the wiring is still exercised
// end to end — MCP client -> bridge -> HTTP -> daemon route -> store — without probing the machine.
async function startBridgeWithStubbedConnectors(): Promise<Client> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-ops-mcp-'));
  const store = await AgentOpsStore.open(join(directory, 'agent-ops.sqlite'));
  const { app } = createDaemonApp(store, undefined, {
    discoverRuntimes: () => [{
      id: 'codex',
      name: 'Codex',
      source: 'built-in',
      launchCommand: 'codex',
      detected: true,
      version: 'fixture',
      detail: 'Detected on local PATH.',
      capabilities: ['workspace-write', 'version-detection', 'non-interactive'],
    }],
    runPreflight: async () => ({
      checkedAt: new Date().toISOString(),
      localOnly: true as const,
      readyForAccountDiscovery: true,
      connectors: [{
        id: 'github',
        title: 'GitHub',
        command: 'gh',
        status: 'available',
        version: '1.0.0',
        detail: 'fixture',
        nextAction: 'none',
      }],
    }),
    runAccountDiscovery: async () => ({
      checkedAt: new Date().toISOString(),
      readOnly: true as const,
      accounts: [{
        id: 'github',
        title: 'GitHub',
        status: 'authenticated',
        identity: 'fixture',
        detail: 'fixture',
        nextAction: 'none',
      }],
    }),
  });
  const httpServer = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>(resolve => httpServer.once('listening', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('The test daemon did not bind a port.');
  const mcpServer = createAgentOpsMcpServer({ daemonBaseUrl: `http://127.0.0.1:${address.port}` });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await mcpServer.close();
    await new Promise<void>((resolve, reject) => httpServer.close(error => (error ? reject(error) : resolve())));
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return client;
}

describe('agent-ops MCP bridge', () => {
  it('exposes read and progress tools only, never the human gates', async () => {
    const client = await startBridge();
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'agent_ops_accept_run',
      'agent_ops_apply_team_plan',
      'agent_ops_cancel_run',
      'agent_ops_cancel_task',
      'agent_ops_coordinator_summary',
      'agent_ops_create_feature_task',
      'agent_ops_create_project',
      'agent_ops_create_role',
      'agent_ops_create_role_from_template',
      'agent_ops_create_run',
      'agent_ops_create_task',
      'agent_ops_create_team',
      'agent_ops_delete_role',
      'agent_ops_delete_task',
      'agent_ops_delete_team',
      'agent_ops_doctor',
      'agent_ops_dry_run',
      'agent_ops_evaluate_policy',
      'agent_ops_execute_dag',
      'agent_ops_execute_parallel',
      'agent_ops_execute_pipeline',
      'agent_ops_execute_run',
      'agent_ops_export_task',
      'agent_ops_get_acceptance',
      'agent_ops_get_apply',
      'agent_ops_get_baseline_plan',
      'agent_ops_get_budget',
      'agent_ops_get_connectors',
      'agent_ops_get_credentials_meta',
      'agent_ops_get_delivery_report',
      'agent_ops_get_feature_task',
      'agent_ops_get_metrics',
      'agent_ops_get_project',
      'agent_ops_get_quality_gate',
      'agent_ops_get_release',
      'agent_ops_get_release_plan',
      'agent_ops_get_role',
      'agent_ops_get_run',
      'agent_ops_get_runtime',
      'agent_ops_get_task',
      'agent_ops_get_team',
      'agent_ops_list_audit',
      'agent_ops_list_handoffs',
      'agent_ops_list_projects',
      'agent_ops_list_role_templates',
      'agent_ops_list_roles',
      'agent_ops_list_runs',
      'agent_ops_list_tasks',
      'agent_ops_list_team_tasks',
      'agent_ops_list_teams',
      'agent_ops_plan_team_pipeline',
      'agent_ops_provision_task',
      'agent_ops_reject_run',
      'agent_ops_release_task',
      'agent_ops_request_release',
      'agent_ops_rerun_pipeline',
      'agent_ops_retry_pipeline',
      'agent_ops_revise_blueprint',
      'agent_ops_select_final_lane',
      'agent_ops_submit_acceptance',
      'agent_ops_test_role',
      'agent_ops_update_role',
      'agent_ops_update_task',
      'agent_ops_update_team',
    ]);
    // Acceptance submissions are exposed by design; the approval acts never are.
    expect(names.some(name => name.includes('approve'))).toBe(false);

    // Clients decide whether to ask a human before running a tool from these hints alone.
    expect(tools.every(tool => tool.annotations !== undefined)).toBe(true);
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    expect(byName.get('agent_ops_list_projects')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get('agent_ops_dry_run')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('agent_ops_get_connectors')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(byName.get('agent_ops_request_release')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('agent_ops_create_feature_task')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('agent_ops_submit_acceptance')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

    expect(client.getServerVersion()).toMatchObject({ name: 'agent-ops', version: packageJson.version });
  });

  it('creates and manages a role through the daemon', async () => {
    const client = await startBridge();

    const created = await client.callTool({
      name: 'agent_ops_create_role',
      arguments: {
        name: 'Reviewer',
        baseAgentId: 'codex',
        acceptanceCriteria: ['Read the diff without writes.'],
        runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Write', 'Edit'], approvalMode: 'strict' },
      },
    });
    expect(created.isError).toBeFalsy();
    const { role } = JSON.parse(textOf(created)) as { role: { id: string; name: string } };
    expect(role).toMatchObject({ id: 'reviewer', name: 'Reviewer' });

    const listed = await client.callTool({ name: 'agent_ops_list_roles', arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain(role.id);

    const single = await client.callTool({ name: 'agent_ops_get_role', arguments: { roleId: role.id } });
    expect(single.isError).toBeFalsy();
    expect(JSON.parse(textOf(single))).toMatchObject({ role: { name: 'Reviewer' } });

    const updated = await client.callTool({
      name: 'agent_ops_update_role',
      arguments: { roleId: role.id, enabled: false },
    });
    expect(updated.isError).toBeFalsy();
    expect(JSON.parse(textOf(updated))).toMatchObject({ role: { enabled: false } });

    const deleted = await client.callTool({ name: 'agent_ops_delete_role', arguments: { roleId: role.id } });
    expect(deleted.isError).toBeFalsy();
    expect(JSON.parse(textOf(deleted))).toMatchObject({ deleted: true });
  });

  it('creates a role from a template through the daemon', async () => {
    const client = await startBridge();
    const listed = await client.callTool({ name: 'agent_ops_list_role_templates', arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain('researcher');

    const created = await client.callTool({
      name: 'agent_ops_create_role_from_template',
      arguments: { templateId: 'researcher', name: 'Probe researcher' },
    });
    expect(created.isError).toBeFalsy();
    const { role } = JSON.parse(textOf(created)) as { role: { name: string; runtimePolicy: { approvalMode: string } } };
    expect(role.name).toBe('Probe researcher');
    expect(role.runtimePolicy.approvalMode).toBe('auto');
  });

  it('creates, updates and deletes a team through the daemon', async () => {
    const client = await startBridge();
    const createRole = async (name: string) => {
      const res = await client.callTool({ name: 'agent_ops_create_role', arguments: { name, baseAgentId: 'codex' } });
      expect(res.isError).toBeFalsy();
      return (JSON.parse(textOf(res)) as { role: { id: string } }).role;
    };
    const architect = await createRole('Team architect');
    const implementer = await createRole('Team implementer');

    const created = await client.callTool({
      name: 'agent_ops_create_team',
      arguments: {
        name: 'MCP delivery',
        roleIds: [architect.id, implementer.id],
        handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }],
      },
    });
    expect(created.isError).toBeFalsy();
    const { team } = JSON.parse(textOf(created)) as { team: { id: string; roleIds: string[] } };
    expect(team).toMatchObject({ id: 'mcp-delivery', roleIds: [architect.id, implementer.id] });

    const listed = await client.callTool({ name: 'agent_ops_list_teams', arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain(team.id);

    const single = await client.callTool({ name: 'agent_ops_get_team', arguments: { teamId: team.id } });
    expect(single.isError).toBeFalsy();
    expect(JSON.parse(textOf(single))).toMatchObject({ team: { handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }] } });

    const taskRes = await client.callTool({
      name: 'agent_ops_create_task',
      arguments: { repo: '/r', baseRef: 'main', title: 'Team task', teamId: team.id },
    });
    expect(taskRes.isError).toBeFalsy();
    const { id: teamTaskId } = JSON.parse(textOf(taskRes)) as { id: string };
    const teamTasks = await client.callTool({ name: 'agent_ops_list_team_tasks', arguments: { teamId: team.id } });
    expect(teamTasks.isError).toBeFalsy();
    expect(textOf(teamTasks)).toContain(teamTaskId);

    const updated = await client.callTool({ name: 'agent_ops_update_team', arguments: { teamId: team.id, enabled: false } });
    expect(updated.isError).toBeFalsy();
    expect(JSON.parse(textOf(updated))).toMatchObject({ team: { enabled: false } });

    const deleted = await client.callTool({ name: 'agent_ops_delete_team', arguments: { teamId: team.id } });
    expect(deleted.isError).toBeFalsy();
    expect(JSON.parse(textOf(deleted))).toMatchObject({ deleted: true });
  });

  it('reads a task budget through the daemon', async () => {
    const client = await startBridge();
    const created = await client.callTool({
      name: 'agent_ops_create_task',
      arguments: { repo: '/r', baseRef: 'main', title: 'Budgetless' },
    });
    expect(created.isError).toBeFalsy();
    const { id } = JSON.parse(textOf(created)) as { id: string };

    const budget = await client.callTool({ name: 'agent_ops_get_budget', arguments: { taskId: id } });
    expect(budget.isError).toBeFalsy();
    const body = JSON.parse(textOf(budget)) as { role: unknown; team: unknown };
    expect(body.role).toBeNull();
    expect(body.team).toBeNull();
  });

  it('evaluates a tool policy through the daemon', async () => {
    const client = await startBridge();
    const evaluated = await client.callTool({
      name: 'agent_ops_evaluate_policy',
      arguments: { allowedTools: ['Read'], approvalMode: 'strict' },
    });
    expect(evaluated.isError).toBeFalsy();
    const { verdicts } = JSON.parse(textOf(evaluated)) as {
      verdicts: Array<{ runtimeId: string; enforcement: string; approval: { humanGate: boolean } }>;
    };
    expect(verdicts.find(verdict => verdict.runtimeId === 'codex')).toMatchObject({ enforcement: 'exact', approval: { humanGate: true } });
  });

  it('plans and applies a team pipeline through the daemon', async () => {
    const client = await startBridge();
    const createRole = async (name: string) => {
      const res = await client.callTool({ name: 'agent_ops_create_role', arguments: { name, baseAgentId: 'codex' } });
      expect(res.isError).toBeFalsy();
      return (JSON.parse(textOf(res)) as { role: { id: string } }).role;
    };
    const architect = await createRole('Coordinator architect');
    const implementer = await createRole('Coordinator implementer');

    const teamRes = await client.callTool({
      name: 'agent_ops_create_team',
      arguments: {
        name: 'MCP coordinator',
        roleIds: [implementer.id, architect.id],
        handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }],
      },
    });
    expect(teamRes.isError).toBeFalsy();
    const { team } = JSON.parse(textOf(teamRes)) as { team: { id: string } };

    const taskRes = await client.callTool({
      name: 'agent_ops_create_task',
      arguments: { repo: '/r', baseRef: 'main', title: 'Coordinated', teamId: team.id },
    });
    expect(taskRes.isError).toBeFalsy();
    const { id } = JSON.parse(textOf(taskRes)) as { id: string };

    const planRes = await client.callTool({ name: 'agent_ops_plan_team_pipeline', arguments: { taskId: id } });
    expect(planRes.isError).toBeFalsy();
    const { plan } = JSON.parse(textOf(planRes)) as { plan: { order: string[] } };
    expect(plan.order).toEqual([architect.id, implementer.id]);

    const applyRes = await client.callTool({ name: 'agent_ops_apply_team_plan', arguments: { taskId: id } });
    expect(applyRes.isError).toBeFalsy();
    const { pipeline } = JSON.parse(textOf(applyRes)) as { pipeline: { steps: unknown[] } };
    expect(pipeline.steps).toHaveLength(2);
  });

  it('reads kernel metrics through the daemon', async () => {
    const client = await startBridge();
    const metrics = await client.callTool({ name: 'agent_ops_get_metrics', arguments: {} });
    expect(metrics.isError).toBeFalsy();
    const body = JSON.parse(textOf(metrics)) as { runs: { successRate: number | null }; usage: { costUsd: number | null } };
    expect(body.runs.successRate).toBeNull();
    expect(body.usage.costUsd).toBeNull();
  });

  it('builds a role test plan through the daemon', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_ops_create_role', arguments: { name: 'Plan probe', baseAgentId: 'codex' } });
    expect(created.isError).toBeFalsy();
    const { role } = JSON.parse(textOf(created)) as { role: { id: string } };

    const tested = await client.callTool({ name: 'agent_ops_test_role', arguments: { roleId: role.id } });
    expect(tested.isError).toBeFalsy();
    const { plan } = JSON.parse(textOf(tested)) as { plan: { executable: boolean; command: string[] } };
    expect(plan.executable).toBe(true);
    expect(plan.command[0]).toBe('codex');
  });

  it('replays audit events through the daemon', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_ops_create_role', arguments: { name: 'Audit role', baseAgentId: 'codex' } });
    expect(created.isError).toBeFalsy();

    const audit = await client.callTool({ name: 'agent_ops_list_audit', arguments: { type: 'role.created' } });
    expect(audit.isError).toBeFalsy();
    const { events } = JSON.parse(textOf(audit)) as { events: Array<{ type: string; data: { name?: string } }> };
    expect(events).toContainEqual(expect.objectContaining({ type: 'role.created', data: expect.objectContaining({ name: 'Audit role' }) }));
  });

  it('exports a task through the daemon', async () => {
    const client = await startBridge();
    const created = await client.callTool({
      name: 'agent_ops_create_task',
      arguments: { repo: '/r', baseRef: 'main', title: 'MCP export' },
    });
    expect(created.isError).toBeFalsy();
    const { id } = JSON.parse(textOf(created)) as { id: string };

    const exported = await client.callTool({ name: 'agent_ops_export_task', arguments: { taskId: id } });
    expect(exported.isError).toBeFalsy();
    const body = JSON.parse(textOf(exported)) as { task: { id: string }; totals: { runs: number; costUsd: number | null } };
    expect(body.task.id).toBe(id);
    expect(body.totals.runs).toBe(0);
    expect(body.totals.costUsd).toBeNull();
  });

  it('creates and reads a project through the daemon', async () => {
    const client = await startBridge();

    const created = await client.callTool({ name: 'agent_ops_create_project', arguments: { name: 'MCP Probe', answers: { mode: 'beginner' } } });
    expect(created.isError).toBeFalsy();
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; state: string } };
    expect(project.state).toBe('NEEDS_INPUT');

    const listed = await client.callTool({ name: 'agent_ops_list_projects', arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain(project.id);

    const single = await client.callTool({ name: 'agent_ops_get_project', arguments: { projectId: project.id } });
    expect(single.isError).toBeFalsy();
    expect(JSON.parse(textOf(single))).toMatchObject({ project: { name: 'MCP Probe' } });

    const dryRun = await client.callTool({ name: 'agent_ops_dry_run', arguments: { projectId: project.id } });
    expect(dryRun.isError).toBeFalsy();
    expect(JSON.parse(textOf(dryRun))).toMatchObject({ plan: { noExternalChanges: true } });
    type Manifest = { plan: { artifactCount: number; artifacts: { id: string; path: string; bytes: number; content?: string }[] } };
    const manifest = JSON.parse(textOf(dryRun)) as Manifest;
    expect(manifest.plan.artifactCount).toBeGreaterThan(0);
    expect(manifest.plan.artifacts.every(artifact => artifact.content === undefined)).toBe(true);

    const artifactId = manifest.plan.artifacts[0].id;
    const fullArtifact = await client.callTool({ name: 'agent_ops_dry_run', arguments: { projectId: project.id, artifactId } });
    expect(fullArtifact.isError).toBeFalsy();
    const content = JSON.parse(textOf(fullArtifact)) as { plan: { artifact: { id: string; path: string; content: string } } };
    expect(content.plan.artifact.id).toBe(artifactId);
    expect(content.plan.artifact.content.length).toBeGreaterThan(0);

    const missingArtifact = await client.callTool({ name: 'agent_ops_dry_run', arguments: { projectId: project.id, artifactId: 'no-such-file' } });
    expect(missingArtifact.isError).toBe(true);
    expect(textOf(missingArtifact)).toContain('no-such-file');

    const featureTask = await client.callTool({ name: 'agent_ops_get_feature_task', arguments: { projectId: project.id } });
    expect(featureTask.isError).toBeFalsy();
    expect(JSON.parse(textOf(featureTask))).toMatchObject({ task: null });

    const apply = await client.callTool({ name: 'agent_ops_get_apply', arguments: { projectId: project.id } });
    expect(apply.isError).toBeFalsy();
    expect(JSON.parse(textOf(apply))).toMatchObject({ run: null });

    const quality = await client.callTool({ name: 'agent_ops_get_quality_gate', arguments: { projectId: project.id } });
    expect(quality.isError).toBeFalsy();
    expect(JSON.parse(textOf(quality))).toMatchObject({ result: null });

    const acceptance = await client.callTool({ name: 'agent_ops_get_acceptance', arguments: { projectId: project.id } });
    expect(acceptance.isError).toBeFalsy();
    expect(JSON.parse(textOf(acceptance))).toMatchObject({ acceptance: null });

    const report = await client.callTool({ name: 'agent_ops_get_delivery_report', arguments: { projectId: project.id } });
    expect(report.isError).toBeFalsy();
    expect(textOf(report)).toContain('MCP Probe Final Delivery Report');

    const baselinePlan = await client.callTool({ name: 'agent_ops_get_baseline_plan', arguments: { projectId: project.id } });
    expect(baselinePlan.isError).toBeFalsy();
    expect(JSON.parse(textOf(baselinePlan))).toMatchObject({ plan: { noExternalChanges: true } });

    const credentialsMeta = await client.callTool({ name: 'agent_ops_get_credentials_meta', arguments: {} });
    expect(credentialsMeta.isError).toBeFalsy();
    const meta = JSON.parse(textOf(credentialsMeta)) as { meta: { keys: string[] } };
    expect(Array.isArray(meta.meta.keys)).toBe(true);

    const unknown = await client.callTool({ name: 'agent_ops_get_project', arguments: { projectId: 'missing' } });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('HTTP 404');
  });

  it('surfaces release gates as errors that point to Studio instead of approving anything', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_ops_create_project', arguments: { name: 'Gate Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string } };

    // A fresh project has no completed Apply, so the request is refused at the first gate. The
    // bridge must report the daemon's refusal and where a human continues, never pretend success.
    const blocked = await client.callTool({ name: 'agent_ops_request_release', arguments: { projectId: project.id } });
    expect(blocked.isError).toBe(true);
    const blockedText = textOf(blocked);
    expect(blockedText).toContain('HTTP 409');
    expect(blockedText).toContain('Studio');

    // The same gates protect the two progress tools: a feature task needs a completed Apply, and
    // acceptance needs an approved feature task. The bridge must refuse both, not forge them.
    const taskBlocked = await client.callTool({
      name: 'agent_ops_create_feature_task',
      arguments: { projectId: project.id, title: 'Add receipt list', objective: 'Show saved receipts to the user.', acceptanceCriteria: ['The list renders saved receipts.'] },
    });
    expect(taskBlocked.isError).toBe(true);
    expect(textOf(taskBlocked)).toContain('HTTP 409');

    const acceptanceBlocked = await client.callTool({
      name: 'agent_ops_submit_acceptance',
      arguments: { projectId: project.id, summary: 'Everything works as specified.', criteriaConfirmed: true },
    });
    expect(acceptanceBlocked.isError).toBe(true);
    expect(textOf(acceptanceBlocked)).toContain('HTTP 409');
  });

  it('explains how to reach the daemon when it is not running', async () => {
    const mcpServer = createAgentOpsMcpServer({ daemonBaseUrl: 'http://127.0.0.1:1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await mcpServer.close();
    });

    const result = await client.callTool({ name: 'agent_ops_doctor', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('agent-ops start');
  });

  it('gives up on a daemon that accepts the request but never answers', async () => {
    // A hung process looks exactly like a slow one to fetch, so the bridge owns the deadline.
    const fetchImpl = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const mcpServer = createAgentOpsMcpServer({ daemonBaseUrl: 'http://127.0.0.1:3737', fetchImpl, timeoutMs: 50 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await mcpServer.close();
    });

    const result = await client.callTool({ name: 'agent_ops_doctor', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('did not answer within 50 ms');
  });

  it('covers the remaining read tools: runtime, connectors, release, release plan', async () => {
    const client = await startBridgeWithStubbedConnectors();
    const created = await client.callTool({ name: 'agent_ops_create_project', arguments: { name: 'Read Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; state: string } };

    // Runtime catalog + profiles are a single combined read from the bridge.
    const runtime = await client.callTool({ name: 'agent_ops_get_runtime', arguments: {} });
    expect(runtime.isError).toBeFalsy();
    const runtimeBody = JSON.parse(textOf(runtime)) as { agents?: unknown[]; profiles?: unknown[] };
    expect(Array.isArray(runtimeBody.agents)).toBe(true);
    expect(Array.isArray(runtimeBody.profiles)).toBe(true);

    // Connector preflight + account discovery are combined into one read.
    const connectors = await client.callTool({ name: 'agent_ops_get_connectors', arguments: {} });
    expect(connectors.isError).toBeFalsy();
    const connectorBody = JSON.parse(textOf(connectors)) as { preflight?: unknown; discovery?: unknown };
    expect(connectorBody.preflight).toBeDefined();
    expect(connectorBody.discovery).toBeDefined();

    // Release state is a read of the current run + evidence; a fresh project has none.
    const release = await client.callTool({ name: 'agent_ops_get_release', arguments: { projectId: project.id } });
    expect(release.isError).toBeFalsy();
    const releaseBody = JSON.parse(textOf(release)) as { state: string; releaseRun: unknown; evidence: unknown };
    expect(releaseBody.state).toBe('NEEDS_INPUT');
    expect(releaseBody.releaseRun).toBeNull();
    expect(releaseBody.evidence).toBeNull();

    // Release plan requires a completed Apply; the bridge must surface the 409 gate, not forge a plan.
    const releasePlan = await client.callTool({ name: 'agent_ops_get_release_plan', arguments: { projectId: project.id } });
    expect(releasePlan.isError).toBe(true);
    expect(textOf(releasePlan)).toContain('HTTP 409');

    // Unknown project for release read -> 404 surfaced as an error.
    const missing = await client.callTool({ name: 'agent_ops_get_release', arguments: { projectId: 'missing' } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('HTTP 404');
  });

  it('revises a Blueprint through the bridge and surfaces invalid answers', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_ops_create_project', arguments: { name: 'Revise Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; blueprint: { metadata: { revision: number } } } };
    expect(project.blueprint.metadata.revision).toBe(1);

    // Revising with the full answers creates the next revision without touching any external system.
    const revised = await client.callTool({
      name: 'agent_ops_revise_blueprint',
      arguments: { projectId: project.id, answers: { mode: 'professional' } },
    });
    expect(revised.isError).toBeFalsy();
    const revisedBody = JSON.parse(textOf(revised)) as { project: { blueprint: { metadata: { revision: number } } } };
    expect(revisedBody.project.blueprint.metadata.revision).toBe(2);

    // A project that does not exist is reported as a 404, never silently ignored.
    const missing = await client.callTool({ name: 'agent_ops_revise_blueprint', arguments: { projectId: 'missing', answers: { mode: 'professional' } } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('HTTP 404');
  });

  it('creates and lists kernel tasks and runs through the daemon', async () => {
    const client = await startBridge();
    const roleCreated = await client.callTool({
      name: 'agent_ops_create_role',
      arguments: { name: 'MCP Runner', baseAgentId: 'codex' },
    });
    expect(roleCreated.isError).toBeUndefined();
    const role = JSON.parse(textOf(roleCreated)) as { role: { id: string } };

    const created = await client.callTool({
      name: 'agent_ops_create_task',
      arguments: {
        repo: '/Users/jiangfeng/000mycodes/agent-ops',
        baseRef: 'dev',
        title: 'MCP kernel probe',
        objective: 'Verify the task/run tools reach the daemon.',
        recipe: 'storefront',
        acceptanceCriteria: ['The task and run tools reach the daemon.'],
        priority: 'high',
        roleId: role.role.id,
        pipeline: {
          steps: [{ id: 'mcp-step', name: 'MCP step', roleId: role.role.id, prompt: 'Do the work.' }],
        },
      },
    });
    expect(created.isError).toBeUndefined();
    const task = JSON.parse(textOf(created)) as { id: string; title: string; repo: string; baseRef: string; recipe: string; status: string; roleId: string | null; acceptanceCriteria: string[]; priority: string; pipeline: { status: string; steps: { id: string; name: string; roleId?: string }[] } | null };
    expect(task.id).toBeTruthy();
    expect(task.title).toBe('MCP kernel probe');
    expect(task.status).toBe('queued');
    expect(task.recipe).toBe('storefront');
    expect(task.roleId).toBe(role.role.id);
    expect(task.acceptanceCriteria).toEqual(['The task and run tools reach the daemon.']);
    expect(task.priority).toBe('high');
    expect(task.pipeline?.status).toBe('idle');
    expect(task.pipeline?.steps[0]).toMatchObject({ id: 'mcp-step', name: 'MCP step', roleId: role.role.id });

    const rebound = await client.callTool({ name: 'agent_ops_update_task', arguments: { taskId: task.id, roleId: role.role.id } });
    expect(rebound.isError).toBeUndefined();
    expect((JSON.parse(textOf(rebound)) as { roleId: string | null }).roleId).toBe(role.role.id);

    const cleared = await client.callTool({ name: 'agent_ops_update_task', arguments: { taskId: task.id, roleId: null } });
    expect(cleared.isError).toBeUndefined();
    expect((JSON.parse(textOf(cleared)) as { roleId: string | null }).roleId).toBeNull();

    const restored = await client.callTool({ name: 'agent_ops_update_task', arguments: { taskId: task.id, roleId: role.role.id } });
    expect(restored.isError).toBeUndefined();
    expect((JSON.parse(textOf(restored)) as { roleId: string | null }).roleId).toBe(role.role.id);

    const listed = await client.callTool({ name: 'agent_ops_list_tasks', arguments: {} });
    const tasks = JSON.parse(textOf(listed)) as { id: string }[];
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.some(candidate => candidate.id === task.id)).toBe(true);

    const single = await client.callTool({ name: 'agent_ops_get_task', arguments: { taskId: task.id } });
    expect((JSON.parse(textOf(single)) as { title: string }).title).toBe('MCP kernel probe');

    const runCreated = await client.callTool({ name: 'agent_ops_create_run', arguments: { taskId: task.id, agentId: 'codex' } });
    expect(runCreated.isError).toBeUndefined();
    const run = JSON.parse(textOf(runCreated)) as { id: string; agentId: string; status: string; roleId: string | null; runtimeId: string | null };
    expect(run.id).toBeTruthy();
    expect(run.agentId).toBe('codex');
    expect(run.status).toBe('queued');
    expect(run.roleId).toBe(role.role.id);
    expect(run.runtimeId).toBeNull();

    const inheritedRunCreated = await client.callTool({ name: 'agent_ops_create_run', arguments: { taskId: task.id } });
    expect(inheritedRunCreated.isError).toBeUndefined();
    const inheritedRun = JSON.parse(textOf(inheritedRunCreated)) as { id: string; agentId: string; roleId: string | null };
    expect(inheritedRun.id).toBeTruthy();
    expect(inheritedRun.agentId).toBe('codex');
    expect(inheritedRun.roleId).toBe(role.role.id);

    const runs = await client.callTool({ name: 'agent_ops_list_runs', arguments: { taskId: task.id } });
    const runList = JSON.parse(textOf(runs)) as { id: string }[];
    expect(Array.isArray(runList)).toBe(true);
    expect(runList.some(candidate => candidate.id === run.id)).toBe(true);

    const runSingle = await client.callTool({ name: 'agent_ops_get_run', arguments: { runId: run.id } });
    expect((JSON.parse(textOf(runSingle)) as { agentId: string }).agentId).toBe('codex');

    // A task that does not exist is a 404, never silently ignored.
    const missingTask = await client.callTool({ name: 'agent_ops_get_task', arguments: { taskId: 'missing' } });
    expect(missingTask.isError).toBe(true);
    expect(textOf(missingTask)).toContain('HTTP 404');
  });
});
