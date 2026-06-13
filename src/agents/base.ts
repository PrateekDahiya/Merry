import { TaskEnvelope, AgentResult } from '../types/messages.js';
import { createChildLogger } from '../logging/logger.js';

/**
 * Base class for all agent implementations.
 * Provides common structure, lifecycle hooks, and error handling.
 */
export abstract class BaseAgent {
  protected logger = createChildLogger({ agentId: this.agentId, agentType: this.agentType });

  constructor(
    protected agentId: string,
    protected agentType: string
  ) {}

  /**
   * Main entry point for agent work.
   * Called by Ace to execute a task.
   */
  async execute(task: TaskEnvelope): Promise<AgentResult> {
    const startTime = Date.now();

    // Bind correlationId = taskId for every log from this execution
    const taskLogger = this.logger.child({ correlationId: task.taskId });

    try {
      taskLogger.info({ taskId: task.taskId }, 'Starting task execution');

      const result = await this.doWork(task);

      const executionTimeMs = Date.now() - startTime;
      const response: AgentResult = {
        taskId: task.taskId,
        agentId: this.agentId,
        success: true,
        result,
        executionTimeMs,
      };

      taskLogger.info({ taskId: task.taskId, executionTimeMs }, 'Task completed successfully');
      return response;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      taskLogger.error(
        { taskId: task.taskId, error: errorMessage, executionTimeMs },
        'Task failed'
      );

      return {
        taskId: task.taskId,
        agentId: this.agentId,
        success: false,
        result: null,
        error: errorMessage,
        executionTimeMs,
      };
    }
  }

  /**
   * Subclasses override this to implement agent-specific logic.
   */
  protected abstract doWork(task: TaskEnvelope): Promise<unknown>;

  /**
   * Lifecycle hook: called when agent starts.
   */
  async onStart(): Promise<void> {
    this.logger.info('Agent started');
  }

  /**
   * Lifecycle hook: called when agent stops.
   */
  async onStop(): Promise<void> {
    this.logger.info('Agent stopped');
  }

  /**
   * Health check for monitoring.
   */
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true };
  }
}
