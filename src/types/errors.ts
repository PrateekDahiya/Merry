/**
 * Custom error types for the system.
 */

export class SystemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SystemError';
  }
}

export class TelegramError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TELEGRAM_ERROR', details);
    this.name = 'TelegramError';
  }
}

export class AgentError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', details);
    this.name = 'AgentError';
  }
}

export class ContextError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONTEXT_ERROR', details);
    this.name = 'ContextError';
  }
}

export class ValidationError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class TimeoutError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TIMEOUT_ERROR', details);
    this.name = 'TimeoutError';
  }
}

export class PersistenceError extends SystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PERSISTENCE_ERROR', details);
    this.name = 'PersistenceError';
  }
}
