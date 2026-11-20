import { describe, expect, it } from 'vitest';
import { RuntimeRegistry, runtimeRegistry, getAgentAdapterStatus, getRuntimeAdapter } from '../src/runtime-registry.js';

describe('RuntimeRegistry', () => {
  it('registers the built-in adapters with a queryable capability matrix', () => {
    expect(runtimeRegistry.list().map(adapter => adapter.id)).toEqual([
      'codex',
      'claude-code',
      'aider',
      'opencode',
      'openclaw',
      'codebuddy',
      'hermes',
    ]);
    expect(getAgentAdapterStatus('codex')).toBe('verified');
    expect(getAgentAdapterStatus('claude-code')).toBe('candidate');
    expect(getAgentAdapterStatus('missing-agent')).toBe('unsupported');
    expect(getRuntimeAdapter('codex')?.capabilities).toMatchObject({
      nonInteractive: true,
      structuredOutput: true,
      toolPolicy: 'native',
      worktreeSafe: true,
    });
    expect(runtimeRegistry.capabilities('hermes')).toMatchObject({
      toolPolicy: 'unsupported',
    });
  });

  it('allows a new adapter to be registered without another kernel switch', () => {
    const registry = new RuntimeRegistry();
    registry.register({
      id: 'fixture-runtime',
      status: 'experimental',
      capabilities: {
        nonInteractive: true,
        streaming: false,
        structuredOutput: false,
        sessionResume: false,
        toolPolicy: 'unsupported',
        worktreeSafe: true,
      },
      buildCommand: prompt => ['fixture', prompt],
    });
    expect(registry.get('fixture-runtime')?.status).toBe('experimental');
    expect(registry.capabilities('fixture-runtime')?.nonInteractive).toBe(true);
  });

  it('refuses duplicate and malformed ids', () => {
    const registry = new RuntimeRegistry();
    registry.register({
      id: 'one',
      status: 'candidate',
      capabilities: {
        nonInteractive: true,
        streaming: false,
        structuredOutput: false,
        sessionResume: false,
        toolPolicy: 'unsupported',
        worktreeSafe: true,
      },
      buildCommand: prompt => [prompt],
    });
    expect(() => registry.register({
      id: 'one',
      status: 'candidate',
      capabilities: {
        nonInteractive: true,
        streaming: false,
        structuredOutput: false,
        sessionResume: false,
        toolPolicy: 'unsupported',
        worktreeSafe: true,
      },
      buildCommand: prompt => [prompt],
    })).toThrow('already registered');
    expect(() => registry.register({
      id: ' two ',
      status: 'candidate',
      capabilities: {
        nonInteractive: true,
        streaming: false,
        structuredOutput: false,
        sessionResume: false,
        toolPolicy: 'unsupported',
        worktreeSafe: true,
      },
      buildCommand: prompt => [prompt],
    })).toThrow('trimmed');
  });
});
