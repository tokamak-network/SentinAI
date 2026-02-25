import { format } from 'util';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

function emit(level: ConsoleLevel, args: unknown[]): void {
  if (args.length === 0) return;
  const line = `[${new Date().toISOString()}] ${format(...(args as Parameters<typeof format>))}`;
  (console[level] as (...items: unknown[]) => void)(line);
}

export const tsConsole = {
  log: (...args: unknown[]) => emit('log', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
  debug: (...args: unknown[]) => emit('debug', args),
};
