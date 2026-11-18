import { describe, expect, it } from 'vitest';
import { createTaskRunActor, restoreTaskRunActor } from '../src/index.js';

describe('task-run workflow', () => {
  it('starts a new task in queued', () => {
    const actor = createTaskRunActor('task-1');
    expect(actor.getSnapshot().value).toBe('queued');
    actor.stop();
  });

  it('moves through running and review to done on the happy path', () => {
    const actor = createTaskRunActor('task-1');
    actor.send({ type: 'START' });
    expect(actor.getSnapshot().value).toBe('running');
    actor.send({ type: 'REQUEST_REVIEW' });
    expect(actor.getSnapshot().value).toBe('review');
    actor.send({ type: 'ACCEPT' });
    expect(actor.getSnapshot().value).toBe('done');
    actor.stop();
  });

  it('rejects a review back to queued for another pass', () => {
    const actor = createTaskRunActor('task-1');
    actor.send({ type: 'START' });
    actor.send({ type: 'REQUEST_REVIEW' });
    actor.send({ type: 'REJECT' });
    expect(actor.getSnapshot().value).toBe('queued');
    actor.stop();
  });

  it('fails from running and review, then retries into queued', () => {
    const fromRunning = createTaskRunActor('task-1');
    fromRunning.send({ type: 'START' });
    fromRunning.send({ type: 'FAIL' });
    expect(fromRunning.getSnapshot().value).toBe('failed');
    fromRunning.send({ type: 'RETRY' });
    expect(fromRunning.getSnapshot().value).toBe('queued');
    expect(fromRunning.getSnapshot().context.retryCount).toBe(1);
    fromRunning.stop();

    const fromReview = createTaskRunActor('task-2');
    fromReview.send({ type: 'START' });
    fromReview.send({ type: 'REQUEST_REVIEW' });
    fromReview.send({ type: 'FAIL' });
    expect(fromReview.getSnapshot().value).toBe('failed');
    fromReview.stop();
  });

  it('restores a persisted review gate and continues', () => {
    const original = createTaskRunActor('task-1');
    original.send({ type: 'START' });
    original.send({ type: 'REQUEST_REVIEW' });
    const snapshot = original.getPersistedSnapshot();
    original.stop();

    const restored = restoreTaskRunActor('task-1', snapshot);
    expect(restored.getSnapshot().value).toBe('review');
    restored.send({ type: 'ACCEPT' });
    expect(restored.getSnapshot().value).toBe('done');
    restored.stop();
  });
});
