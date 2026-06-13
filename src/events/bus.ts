import { EventEmitter2 } from 'eventemitter2';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'event-bus' });

/**
 * Typed event bus for decoupled agent communication.
 *
 * Current agents use direct function calls (Ace calls Nami, etc.).
 * This bus provides an optional event-driven alternative:
 *
 *   bus.emit('message.received', { chatId, message, taskId })
 *   bus.on('task.completed', ({ taskId, response }) => sendToJinbe(response))
 *
 * Benefits over direct calls:
 *   - Decoupled: emitter doesn't need a reference to the listener
 *   - Multi-server: swap EventEmitter2 for Redis pub/sub with same interface
 *   - Testable: listen to events in tests without mocking the callee
 *
 * Usage: import { bus } and use bus.on() / bus.emit() / bus.offAll()
 */

// ── Event type definitions ─────────────────────────────────────────────────

export interface MessageReceivedEvent {
  chatId: number;
  userId: number;
  messageId: number;
  text: string;
  timestamp: Date;
}

export interface TaskRoutedEvent {
  taskId: string;
  chatId: string;
  agent: string;
  confidence: number;
}

export interface TaskCompletedEvent {
  taskId: string;
  chatId: string;
  success: boolean;
  response: string;
  agentId: string;
  durationMs: number;
}

export interface AgentHeartbeatEvent {
  agentId: string;
  agentType: string;
}

export interface AlertEvent {
  type: string;
  severity: 'warning' | 'critical';
  details: string;
}

export type BusEventMap = {
  'message.received': MessageReceivedEvent;
  'task.routed': TaskRoutedEvent;
  'task.completed': TaskCompletedEvent;
  'task.failed': TaskCompletedEvent;
  'agent.heartbeat': AgentHeartbeatEvent;
  'alert.raised': AlertEvent;
};

// ── Bus singleton ──────────────────────────────────────────────────────────

class MerryEventBus extends EventEmitter2 {
  constructor() {
    super({ wildcard: true, maxListeners: 50 });
  }

  /** Typed emit helper — ensures event name + payload match. */
  dispatch<K extends keyof BusEventMap>(event: K, payload: BusEventMap[K]): void {
    logger.debug({ event }, 'Bus event emitted');
    this.emit(event as string, payload);
  }

  /** Typed subscription helper. */
  subscribe<K extends keyof BusEventMap>(
    event: K,
    handler: (payload: BusEventMap[K]) => void | Promise<void>,
  ): void {
    this.on(event as string, handler as (...args: unknown[]) => void);
  }

  /** Remove all listeners (useful for test cleanup). */
  offAll(): void {
    this.removeAllListeners();
  }
}

export const bus = new MerryEventBus();
