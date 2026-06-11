import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

/**
 * Tom - Telegram Interface Agent
 *
 * Responsibilities:
 * - Listen for incoming Telegram messages
 * - Send immediate acknowledgment/reaction
 * - Parse chat ID, message ID, sender, text, and metadata
 * - Queue or hand off task to Ace
 * - Receive final response from Ace
 * - Send response back to Telegram
 * - Support replies and formatting for long messages
 *
 * Phase 2 will implement full Telegram integration.
 * Phase 1 skeleton provides structure only.
 */
export class TomAgent extends BaseAgent {
  constructor() {
    super('tom-primary', 'tom');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Tom processing Telegram interaction');

    // Phase 2 will implement:
    // 1. Telegram client initialization
    // 2. Message polling or webhook handling
    // 3. Reaction/acknowledgment sending
    // 4. Message parsing and validation
    // 5. Task forwarding to Ace
    // 6. Response formatting and sending

    return {
      status: 'not_implemented',
      message: 'Tom Telegram integration will be implemented in Phase 2',
      taskId: task.taskId,
    };
  }
}
