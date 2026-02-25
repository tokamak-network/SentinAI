import { format } from 'node:util';

function emit(level, args) {
  if (!args.length) return;
  const line = `[${new Date().toISOString()}] ${format(...args)}`;
  console[level](line);
}

export const tsConsole = {
  log: (...args) => emit('log', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  debug: (...args) => emit('debug', args),
};
