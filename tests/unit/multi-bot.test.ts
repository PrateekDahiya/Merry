import { describe, it, expect } from 'vitest';

describe('Multi-bot token config', () => {
  it('additionalBotTokens parses comma-separated tokens', async () => {
    // Test the transform directly via config loading
    const originalToken = process.env['TELEGRAM_BOT_TOKEN'];
    const originalAdditional = process.env['TELEGRAM_ADDITIONAL_TOKENS'];

    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env['TELEGRAM_ADDITIONAL_TOKENS'] = 'tokenA,tokenB,tokenC';

    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();
    expect(config.additionalBotTokens).toEqual(['tokenA', 'tokenB', 'tokenC']);

    process.env['TELEGRAM_BOT_TOKEN'] = originalToken ?? '';
    if (originalAdditional !== undefined) {
      process.env['TELEGRAM_ADDITIONAL_TOKENS'] = originalAdditional;
    } else {
      delete process.env['TELEGRAM_ADDITIONAL_TOKENS'];
    }
  });

  it('additionalBotTokens is empty array when not set', async () => {
    const originalToken = process.env['TELEGRAM_BOT_TOKEN'];
    const originalAdditional = process.env['TELEGRAM_ADDITIONAL_TOKENS'];

    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    delete process.env['TELEGRAM_ADDITIONAL_TOKENS'];

    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();
    expect(config.additionalBotTokens).toEqual([]);

    process.env['TELEGRAM_BOT_TOKEN'] = originalToken ?? '';
    if (originalAdditional !== undefined) {
      process.env['TELEGRAM_ADDITIONAL_TOKENS'] = originalAdditional;
    }
  });

  it('additionalBotTokens trims whitespace', async () => {
    const originalToken = process.env['TELEGRAM_BOT_TOKEN'];
    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env['TELEGRAM_ADDITIONAL_TOKENS'] = ' token1 , token2 ';

    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();
    expect(config.additionalBotTokens).toEqual(['token1', 'token2']);

    process.env['TELEGRAM_BOT_TOKEN'] = originalToken ?? '';
    delete process.env['TELEGRAM_ADDITIONAL_TOKENS'];
  });
});
