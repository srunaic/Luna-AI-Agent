import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Cursor-like Agent');
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  public debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  public info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  public error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const formattedMessage = `[${timestamp}] [${levelName}] ${message}`;

    this.outputChannel.appendLine(formattedMessage);

    if (args.length > 0) {
      this.outputChannel.appendLine(`  ${JSON.stringify(args, null, 2)}`);
    }

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(formattedMessage, ...args);
    }
  }

  public show(): void {
    this.outputChannel.show();
  }
}

// Convenience functions
export const logger = Logger.getInstance();

export function debug(message: string, ...args: any[]): void {
  logger.debug(message, ...args);
}

export function info(message: string, ...args: any[]): void {
  logger.info(message, ...args);
}

export function warn(message: string, ...args: any[]): void {
  logger.warn(message, ...args);
}

export function error(message: string, ...args: any[]): void {
  logger.error(message, ...args);
}



