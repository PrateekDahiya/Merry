import { TaskStore, ResultStore, ChatMetadataStore, InMemoryStore, initializeStore } from './store.js';
import { FileStore } from './file-store.js';
import { SqliteStore } from './sqlite-store.js';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

export type PersistenceType = 'memory' | 'file' | 'sqlite';

export type AnyStore = TaskStore & ResultStore & ChatMetadataStore;

export function createStore(type: PersistenceType, dbPath: string): AnyStore {
  if (type === 'sqlite') {
    const sqlitePath = dbPath.replace(/\.json$/, '.sqlite');
    logger.info({ dbPath: sqlitePath }, 'Using SQLite persistent store (WAL mode)');
    return new SqliteStore(sqlitePath);
  }

  if (type === 'file') {
    logger.info({ dbPath }, 'Using file-backed persistent store');
    return new FileStore(dbPath);
  }

  logger.info('Using in-memory store (data lost on restart)');
  return initializeStore() as AnyStore;
}

export { InMemoryStore, FileStore, SqliteStore };
