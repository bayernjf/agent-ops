import { assign, createActor, createMachine } from 'xstate';

// A Task and each of its Runs share one lifecycle, reduced from the 15-state delivery
// machine. `review` is the human gate: a diff is produced in `running`, then either
// accepted into `done` or rejected back to `queued` for another pass.
export const taskRunStates = ['queued', 'running', 'review', 'done', 'failed', 'cancelled'] as const;

export type TaskRunState = (typeof taskRunStates)[number];

export type TaskRunContext = {
  id: string;
  retryCount: number;
};

export type TaskRunEvent =
  | { type: 'START' }
  | { type: 'REQUEST_REVIEW' }
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'FAIL' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' };

export const taskRunMachine = createMachine({
  types: {} as {
    context: TaskRunContext;
    events: TaskRunEvent;
    input: { id: string };
  },
  id: 'task-run',
  initial: 'queued',
  context: ({ input }) => ({ id: input.id, retryCount: 0 }),
  states: {
    queued: { on: { START: 'running' } },
    running: {
      on: {
        REQUEST_REVIEW: 'review',
        FAIL: 'failed',
        CANCEL: 'cancelled',
      },
    },
    review: {
      on: {
        ACCEPT: 'done',
        REJECT: 'queued',
        FAIL: 'failed',
      },
    },
    done: { type: 'final' },
    failed: {
      on: {
        RETRY: { target: 'queued', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
      },
    },
    cancelled: {},
  },
});

export function createTaskRunActor(id: string) {
  return createActor(taskRunMachine, { input: { id } }).start();
}

export type TaskRunSnapshot = ReturnType<ReturnType<typeof createTaskRunActor>['getPersistedSnapshot']>;

export function restoreTaskRunActor(id: string, snapshot: TaskRunSnapshot) {
  return createActor(taskRunMachine, { input: { id }, snapshot }).start();
}
