import { LogLevel, container, type ILogger } from '@sapphire/framework'
import { Events } from 'discord.js'

export class LovelaceLogger implements ILogger {
  public constructor(
    private readonly scope: string,
    private readonly baseLogger: ILogger = container.logger,
  ) { }

  // Implement all ILogger interface methods to include the scope of the logger
  public trace(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.trace(this.formatMessage(message), ...values)
  }

  public has(level: LogLevel): boolean {
    return this.baseLogger.has(level);
  }

  public debug(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.debug(this.formatMessage(message), ...values)
  }

  public info(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.debug(this.formatMessage(message), ...values)
  }

  public warn(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.debug(this.formatMessage(message), ...values)
  }

  public error(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.debug(this.formatMessage(message), ...values)
  }

  public fatal(message: unknown, ...values: readonly unknown[]): void {
    this.baseLogger.debug(this.formatMessage(message), ...values)
  }

  public write(level: LogLevel, ...values: readonly unknown[]): void {
    // Applies scope formatting to the first message, if there is a message
    if (values.length > 0) {
      this.baseLogger.write(level, this.formatMessage(values[0]), ...values.slice(1))
    } else {
      this.baseLogger.write(level, ...values)
    }
  }

  /**
  * Formats an error message to include the scope at the beginning
  * @param message - Message from the ILogger interface methods is passed in.
  * @returns The message with the scope of the logger.
  *          Ex. ERROR \[Scheduled Event Listener\] - Failed to write to database.
  */
  private formatMessage(message: unknown): string {
    const msgString = typeof message === 'string' ? message : String(message);
    return `[${this.scope}] ${msgString}`
  }

}
/**
 * Creates an ILogger that will include a provided scope when logs are printed.
 * @param scope - The name of the scope.
 * @returns A LovelaceLogger that implements ILogger
 */
export function createLogger(scope: string): LovelaceLogger {
  return new LovelaceLogger(scope);
}

export function createCommandLogger(commandName: string): LovelaceLogger {
  if (commandName.includes(" ")) throw new Error("Command name should not contain spaces.")
  return new LovelaceLogger(`Command:${commandName}`)
}

/**
 * Creates an ILogger that will include a provided listener scope.
 * @param event - The event enum of the listener.
 * @param scope - The name of the scope.
 * @returns A LovelaceLogger that implemented ILogger.
 */
export function createListenerLogger(event: Events, scope: string): LovelaceLogger;

/**
 * Creates an ILogger that will include a provided listener scope.
 * @param event - The string or symbol value of the event enum.
 * @param scope - The name of the scope.
 * @returns A LovelaceLogger that implemented ILogger.
 */
export function createListenerLogger(event: string | symbol, scope: string): LovelaceLogger

export function createListenerLogger(event: string | symbol | Events, scope: string): LovelaceLogger {
  if (typeof event === "string" || typeof event === 'symbol') {
    if (!Object.values(Events).includes(event as Events)) {
      throw new Error(`Invalid event: ${String(event)} is not a valid Events enum value`);
    }
    return new LovelaceLogger(`Listener\:${String(event)}:${scope}`)
  } else {
    return new LovelaceLogger(`Listener:${String(event)}:${scope}`)
  }
}
