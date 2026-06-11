import pino from 'pino';
import { Config } from '../config/config.js';

let loggerInstance: pino.Logger | null = null;

export function initializeLogger(config: Config): pino.Logger {
  const isProduction = config.nodeEnv === 'production';

  const logger = pino(
    {
      level: config.logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    isProduction
      ? pino.destination(1) // stdout
      : pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
          },
        })
  );

  loggerInstance = logger;
  return logger;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = pino({ level: 'info' });
  }
  return loggerInstance;
}

export function createChildLogger(labels: Record<string, string | number>): pino.Logger {
  return getLogger().child(labels);
}
