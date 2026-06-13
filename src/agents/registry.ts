import { BaseAgent } from './base.js';
import { LlmClient } from '../llm/client.js';

export interface AgentPlugin {
  type: string;           // unique name — also the AgentType value
  description: string;   // shown in /agents command and routing logs
  emoji: string;         // used for display labels
  /** Optional: return true if this plugin should handle the request. Used by routing. */
  matches?: (request: string) => boolean;
  /** Factory: called by Ace to create a fresh specialist instance per task. */
  factory: (llm?: LlmClient) => BaseAgent;
}

/**
 * Global agent plugin registry.
 *
 * Any specialist can self-register by importing and calling registry.register().
 * Ace reads the registry at startup and includes all registered agents in routing.
 *
 * Example (in a new agent file):
 *   import { registry } from './registry.js';
 *   registry.register({ type: 'usopp', description: '...', emoji: '🎯', factory: (llm) => new UsoppAgent(llm) });
 */
export class AgentRegistry {
  private readonly plugins = new Map<string, AgentPlugin>();

  register(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.type)) {
      // Allow re-registration (e.g., in tests) without throwing
      return;
    }
    this.plugins.set(plugin.type, plugin);
  }

  get(type: string): AgentPlugin | undefined {
    return this.plugins.get(type);
  }

  getAll(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(type: string): boolean {
    return this.plugins.has(type);
  }

  /** Returns all plugins that declare a matches() function and match the request. */
  findMatches(request: string): AgentPlugin[] {
    return this.getAll().filter(p => p.matches?.(request) ?? false);
  }

  clear(): void {
    this.plugins.clear();
  }
}

export const registry = new AgentRegistry();

// ── Built-in registrations ─────────────────────────────────────────────────
// Robin and Sanji are registered here so the plugin system works out of the box.
// Additional specialists can register themselves in their own files.

import { RobinAgent } from './robin.js';
import { SanjiAgent } from './sanji.js';

registry.register({
  type: 'robin',
  description: 'Writing specialist — prose, summaries, editing, natural-language responses',
  emoji: '📖',
  factory: (llm) => new RobinAgent(llm),
});

registry.register({
  type: 'sanji',
  description: 'Coding specialist — implementation, debugging, refactors, code-specific tasks',
  emoji: '🍳',
  matches: (request) => /\b(code|bug|debug|implement|python|javascript|typescript|function|class|api|sql|bash)\b/i.test(request),
  factory: (llm) => new SanjiAgent(llm),
});
