import { describe, expect, it, vi } from 'vitest';
import { AceAgent } from '../../src/agents/ace.js';
import { BaseAgent } from '../../src/agents/base.js';
import { Phase2AceDispatcher } from '../../src/orchestrator/phase2-dispatcher.js';
import { selectSpecialistAgent } from '../../src/orchestrator/routing.js';
import { InMemoryStore } from '../../src/persistence/store.js';
import { TaskEnvelope } from '../../src/types/messages.js';
import { MockLlmClient } from '../../src/llm/client.js';

class StubAgent extends BaseAgent {
  constructor(
    agentId: string,
    agentType: string,
    private readonly response: unknown
  ) {
    super(agentId, agentType);
  }

  protected async doWork(): Promise<unknown> {
    return this.response;
  }
}

function createTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: 'task-123',
    chatId: 'chat-123',
    userId: 'user-123',
    messageId: 'msg-123',
    timestamp: new Date('2026-06-11T00:00:00.000Z'),
    state: 'acknowledged',
    userRequest: 'Please debug this TypeScript test failure',
    assignedAgent: 'ace',
    ...overrides,
  };
}

describe('specialist routing', () => {
  it('routes coding requests to Sanji (keyword fallback)', async () => {
    const decision = await selectSpecialistAgent('Please debug this TypeScript API error');
    expect(decision.agent).toBe('sanji');
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it('routes writing requests to Robin (keyword fallback)', async () => {
    const decision = await selectSpecialistAgent('Please rewrite and summarize this article');
    expect(decision.agent).toBe('robin');
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it('uses LLM classification when LLM returns valid answer', async () => {
    const llm = new MockLlmClient();
    vi.spyOn(llm, 'chat').mockResolvedValueOnce({ content: 'sanji', inputTokens: 5, outputTokens: 1 });

    const decision = await selectSpecialistAgent('make me a pizza', llm);
    expect(decision.agent).toBe('sanji');
    expect(decision.confidence).toBe(0.9);
    expect(decision.reason).toContain('LLM');
  });

  it('falls back to keyword routing when LLM returns unexpected output', async () => {
    const llm = new MockLlmClient();
    vi.spyOn(llm, 'chat').mockResolvedValueOnce({ content: 'randomgibberish', inputTokens: 5, outputTokens: 1 });

    const decision = await selectSpecialistAgent('debug this typescript error', llm);
    expect(decision.agent).toBe('sanji');              // keyword fallback still correct
    expect(decision.reason).not.toContain('LLM');      // keyword reason, not LLM path
  });

  it('falls back to keyword routing when LLM throws', async () => {
    const llm = new MockLlmClient();
    vi.spyOn(llm, 'chat').mockRejectedValueOnce(new Error('API down'));

    const decision = await selectSpecialistAgent('write code for sorting', llm);
    expect(decision.agent).toBe('sanji');
  });

  it('detects crew member addressing and sets respondAs', async () => {
    const decision = await selectSpecialistAgent('Hey Zoro what are you up to');
    expect(decision.respondAs).toBe('zoro');
  });

  it('detects Brook from yohoho keyword', async () => {
    const decision = await selectSpecialistAgent('yohoho sing a song');
    expect(decision.respondAs).toBe('brook');
  });

  it('tie between coding and writing keywords routes to Sanji', async () => {
    // "write code" — 1 writing + 1 coding → tie → Sanji (not Robin)
    const decision = await selectSpecialistAgent('write code for fibonacci');
    expect(decision.agent).toBe('sanji');
  });
});

describe('AceAgent', () => {
  it('delegates to the selected specialist and completes the task', async () => {
    const store = new InMemoryStore();
    const ace = new AceAgent({
      store,
      contextAgentFactory: () =>
        new StubAgent('nami-test', 'nami', {
          taskId: 'task-123',
          findings: [],
          summary: 'No context needed',
          timestamp: new Date('2026-06-11T00:00:00.000Z'),
        }),
      specialistFactories: {
        sanji: () =>
          new StubAgent('sanji-test', 'sanji', {
            response: 'Sanji handled the coding task.',
          }),
      },
    });

    const result = await ace.execute(createTask());
    const savedTask = await store.getTask('task-123');
    const specialistResult = await store.getResultByTaskId('task-123');

    expect(result.success).toBe(true);
    expect(savedTask?.state).toBe('completed');
    expect(savedTask?.assignedAgent).toBe('sanji');
    expect(specialistResult?.agentId).toBe('sanji-test');
    expect(JSON.stringify(result.result)).toContain('Sanji handled the coding task.');
  });

  it('marks the task failed when the specialist fails', async () => {
    const store = new InMemoryStore();
    const ace = new AceAgent({
      store,
      specialistFactories: {
        sanji: () =>
          new StubAgent('sanji-failing', 'sanji', {
            response: 'unused',
          }),
      },
    });

    class FailingSanji extends BaseAgent {
      constructor() {
        super('sanji-failing', 'sanji');
      }

      protected async doWork(): Promise<unknown> {
        throw new Error('specialist unavailable');
      }
    }

    const failingAce = new AceAgent({
      store,
      specialistFactories: {
        sanji: () => new FailingSanji(),
      },
    });

    const result = await failingAce.execute(createTask());
    const savedTask = await store.getTask('task-123');

    expect(result.success).toBe(true);
    expect(savedTask?.state).toBe('failed');
    expect(JSON.stringify(result.result)).toContain('specialist unavailable');
  });
});

describe('Phase2AceDispatcher', () => {
  it('returns Ace final response to Jinbe', async () => {
    const store = new InMemoryStore();
    const dispatcher = new Phase2AceDispatcher(store);

    const response = await dispatcher.dispatch(createTask({ userRequest: 'Please summarize this note' }));

    expect(response).toContain('Robin response');
  });
});
