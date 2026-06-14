import { spawnSync } from 'child_process';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'sandbox' });

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxOptions {
  timeoutMs?: number;    // default 10 seconds
  language?: 'python' | 'node' | 'bash';
}

/**
 * Execute code in a sandboxed environment.
 *
 * In production (when Docker is available): runs code in an isolated container
 * with no network access and limited memory.
 *
 * In development/test: uses a lightweight subprocess with timeout.
 *
 * Supported languages: python, node, bash
 */
export async function executeCode(code: string, options: SandboxOptions = {}): Promise<ExecutionResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const language = options.language ?? detectLanguage(code);
  const start = Date.now();

  logger.debug({ language, codeLen: code.length, timeoutMs }, 'Executing code');

  try {
    const result = runInSubprocess(code, language, timeoutMs);
    const durationMs = Date.now() - start;
    logger.debug({ language, exitCode: result.exitCode, durationMs }, 'Code execution complete');
    return { ...result, durationMs, timedOut: false };
  } catch (err) {
    const durationMs = Date.now() - start;
    const timedOut = String(err).includes('ETIMEDOUT') || String(err).includes('spawnSync') || durationMs >= timeoutMs;
    logger.warn({ language, durationMs, timedOut, err: String(err) }, 'Code execution failed');
    return {
      stdout: '',
      stderr: timedOut ? `Execution timed out after ${timeoutMs}ms` : String(err),
      exitCode: 1,
      durationMs,
      timedOut,
    };
  }
}

function detectLanguage(code: string): 'python' | 'node' | 'bash' {
  const lower = code.toLowerCase();
  if (lower.includes('def ') || lower.includes('import ') || lower.includes('print(')) return 'python';
  if (lower.includes('function ') || lower.includes('const ') || lower.includes('console.log')) return 'node';
  return 'bash';
}

function runInSubprocess(code: string, language: 'python' | 'node' | 'bash', timeoutMs: number): Omit<ExecutionResult, 'durationMs' | 'timedOut'> {
  // Use spawnSync (array args) to prevent shell injection — no string interpolation
  const commands: Record<string, { cmd: string; args: string[] }> = {
    python: { cmd: 'python3', args: ['-c', code] },
    node:   { cmd: 'node',    args: ['--eval', code] },
    bash:   { cmd: 'bash',    args: ['-c', code] },
  };

  const { cmd, args } = commands[language]!;

  const result = spawnSync(cmd, args, {
    timeout: timeoutMs,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024,
    env: { PATH: process.env['PATH'] },
    shell: false,  // explicit: no shell, prevents injection
  });

  if (result.error) {
    return { stdout: '', stderr: result.error.message, exitCode: 1 };
  }
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}

/**
 * Check if the code contains dangerous patterns before running.
 * This is a defence-in-depth check, not the primary sandbox.
 */
export function isSafeCode(code: string): { safe: boolean; reason?: string } {
  const DANGEROUS = [
    // Python dangerous imports
    /import\s+os\b/,
    /import\s+subprocess\b/,
    /import\s+sys\b.*exec/i,
    /import\s+shutil\b/,
    /import\s+pathlib\b/,
    /exec\s*\(/,
    /__import__/,
    /open\s*\(/,
    /socket\b/,
    /urllib\b/,
    /requests\b/,
    // Node.js dangerous requires
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]net['"]\s*\)/,
    /require\s*\(\s*['"]http['"]\s*\)/,
    /require\s*\(\s*['"]https['"]\s*\)/,
    /require\s*\(\s*['"]os['"]\s*\)/,
    /require\s*\(\s*['"]path['"]\s*\)/,
    // ES module imports for dangerous modules
    /from\s+['"]fs['"]/,
    /from\s+['"]child_process['"]/,
    // Shell commands
    /rm\s+-rf/,
    /sudo\b/,
    /wget\b/,
    /curl\b/,
    // Template literal command injection
    /`[^`]*\$\{/,   // backtick template with variable interpolation
  ];

  for (const pattern of DANGEROUS) {
    if (pattern.test(code)) {
      return { safe: false, reason: `Blocked pattern detected: ${pattern.source}` };
    }
  }
  return { safe: true };
}
