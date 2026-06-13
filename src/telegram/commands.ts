import { Telegraf } from 'telegraf';
import { ChatMetadataStore, TaskStore, ResultStore } from '../persistence/store.js';
import { TonyMonitor } from '../monitoring/monitor.js';
import { ZoroAgent } from '../agents/zoro.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'bot-commands' });

export interface CommandDeps {
  store: TaskStore & ResultStore & ChatMetadataStore;
  monitor: TonyMonitor;
  zoro?: ZoroAgent;
  adminUserIds?: number[];
}


/**
 * Register all bot slash commands on the Telegraf bot instance.
 * Called once at startup, before bot.launch().
 */
export function registerCommands(bot: Telegraf, deps: CommandDeps): void {
  // /help — list available commands
  bot.command('help', async (ctx) => {
    logger.debug({ chatId: ctx.chat.id }, '/help');
    await ctx.reply(
      '*Merry Crew Commands*\n\n' +
      '/status — Captain Luffy\'s crew inspection report\n' +
      '/reset — Clear your conversation history\n' +
      '/zoro — Knowledge base stats\n' +
      '/agents — Crew heartbeat status\n' +
      '/help — This message',
      { parse_mode: 'Markdown' }
    );
  });

  // /status — Luffy-style health report
  bot.command('status', async (ctx) => {
    logger.debug({ chatId: ctx.chat.id }, '/status');

    const [running, failed] = await Promise.all([
      deps.store.listTasksByState('running'),
      deps.store.listTasksByState('failed'),
    ]);
    const heartbeats = deps.monitor.getAgentStatuses();
    const zoroStats = deps.zoro?.getStats();

    const lines = [
      '🍖 *Luffy\'s Crew Status Report*',
      '',
      `✅ Running tasks: ${running.length}`,
      `${failed.length > 0 ? '⚠️' : '✅'} Failed tasks: ${failed.length}`,
      heartbeats.length > 0
        ? `✅ ${heartbeats.length} agent(s) reporting heartbeats`
        : '⚠️ No agent heartbeats recorded yet',
      zoroStats
        ? `✅ Zoro: ${zoroStats.processedFiles} files indexed, ${zoroStats.pendingFiles} pending`
        : '⚠️ Zoro not active',
      '',
      'My crew is strong! GOMU GOMU NO! 🍖',
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  // /reset — clear chat history for this chatId
  bot.command('reset', async (ctx) => {
    logger.debug({ chatId: ctx.chat.id }, '/reset');
    const chatId = String(ctx.chat.id);
    const existing = (await deps.store.getChatMetadata(chatId)) ?? {};
    await deps.store.saveChatMetadata(chatId, {
      ...existing,
      lastSeenAt: new Date().toISOString(),
      // Clear: last crew/brook/franky message timestamps so proactive messaging restarts
      lastCrewMessageAt: undefined,
      lastBrookMessageAt: undefined,
      lastFrankyMessageAt: undefined,
    });
    await ctx.reply('🌊 Jinbe: Chat history cleared with honour. Fresh slate, new course.');
  });

  // /zoro — knowledge base stats
  bot.command('zoro', async (ctx) => {
    logger.debug({ chatId: ctx.chat.id }, '/zoro');
    const stats = deps.zoro?.getStats();
    if (!stats) {
      await ctx.reply('⚔️ Zoro: Not configured. (ZORO_ENABLED=false or no GitHub token)');
      return;
    }
    await ctx.reply(
      `⚔️ *Zoro Knowledge Base*\n\n` +
      `Repos indexed: ${stats.doneRepos}/${stats.totalRepos}\n` +
      `Files indexed: ${stats.processedFiles}\n` +
      `Files pending: ${stats.pendingFiles}\n` +
      `Files skipped: ${stats.skippedFiles}\n` +
      `Workers: ${stats.workers}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /agents — crew heartbeat status
  bot.command('agents', async (ctx) => {
    logger.debug({ chatId: ctx.chat.id }, '/agents');
    const statuses = deps.monitor.getAgentStatuses();
    if (statuses.length === 0) {
      await ctx.reply('🍖 Luffy: No heartbeats recorded yet. Agents start reporting after their first loop cycle.');
      return;
    }
    const lines = ['🍖 *Crew Heartbeat Status*', ''];
    for (const s of statuses) {
      const ageMs = Date.now() - new Date(s.lastHeartbeat).getTime();
      const ageMin = Math.round(ageMs / 60_000);
      lines.push(`${s.healthy ? '✅' : '⚠️'} ${s.agentType} — last seen ${ageMin}min ago`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  logger.info('Bot commands registered: /help /status /reset /zoro /agents');
}
