import pino, { type Logger as PinoLogger } from 'pino';
import { format } from 'util';

const isDev = process.env.NODE_ENV !== 'production';

const baseLogger = pino({
  level: isDev ? 'debug' : 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});

type LogMethod = (...args: unknown[]) => void;

export interface AppLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  child: (bindings: Record<string, unknown>) => AppLogger;
}

function writeLog(target: PinoLogger, level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
  if (args.length === 0) return;
  target[level](format(...(args as Parameters<typeof format>)));
}

function wrapLogger(target: PinoLogger): AppLogger {
  return {
    debug: (...args: unknown[]) => writeLog(target, 'debug', args),
    info: (...args: unknown[]) => writeLog(target, 'info', args),
    warn: (...args: unknown[]) => writeLog(target, 'warn', args),
    error: (...args: unknown[]) => writeLog(target, 'error', args),
    child: (bindings: Record<string, unknown>) => wrapLogger(target.child(bindings)),
  };
}

const logger = wrapLogger(baseLogger);

// Create a child logger with module name
export function createLogger(name: string): AppLogger {
  return logger.child({ name });
}

export default logger;
