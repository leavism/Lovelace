/**
 * @file ScheduleEventsService.ts
 * @description Service for processing Discord scheduled events.
 * Handles creating roles and database entries for scheduled events.
 */

import { container } from '@sapphire/framework';
import { GuildScheduledEvent, Role } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { Timestamp } from '@sapphire/timestamp';
import { reasonableTruncate } from './utils';
import { LovelaceLogger, createLogger } from './LovelaceLogger';

/**
 * Custom error for scheduled event service that provides additional context for each event
 */
export class ScheduledEventsServiceError extends Error {
  constructor(
    message: string,
    public readonly eventId: string,
    public readonly eventName: string,
    override cause?: unknown,
  ) {
    super(message);
    this.name = 'ScheduledEventsServiceError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScheduledEventsServiceError)
    }
  }
}

/**
 * Result type for batch processing scheduled events
 */
export interface ProcessEventResult {
  event: GuildScheduledEvent | null;
  error?: Error;
}

/**
 * Result type for event cleanup operations
 */
export interface CleanupEventResult {
  roleDeleted: boolean;
  dbEntryDeleted: boolean;
  queueCleared: boolean;
  failedAssignmentsCleared: boolean;
  errors: string[];
}

/**
 * Service to process Discord scheduled events, such as creation of custom roles and database entries for events,
 */
export class ScheduledEventsService {
  private logger: LovelaceLogger = createLogger("Scheduled Event Service")

  /**
   * Processed a guild scheduled event for Lovelace. It creates a custom role and database entry.
   * @param scheduledEvent - The Discord scheduled event to process.
   * @returns {GuildScheduledEvent} A promise that resolves to the {GuildScheduledEvent} if successful, {null} otherwise.
   * @throws {ScheduledEventsServiceError} When the event cannot be proccessed (missing guild, role couldn't be made, write to database failed)
   */
  public async processEvent(
    scheduledEvent: GuildScheduledEvent,
  ): Promise<GuildScheduledEvent> {
    // We primarily catch errors to add additional context for logging.
    // Error handling flow:
    // - Validation errors: throw SheduledEventServiceError immediately
    // - Event already in db means it was already processed: return early
    // - Role creation fails: Discord.js error, wrap error to add more context
    const { database, customRoleQueue } = container;
    if (!scheduledEvent.guild) {
      throw new ScheduledEventsServiceError(
        'Failed to fetch a guild from the scheduled event.',
        scheduledEvent.id,
        scheduledEvent.name
      )
    }

    const dbEvent = await database.findScheduledEvent(scheduledEvent.id);
    if (dbEvent) {
      this.logger.info(
        `Scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)} already exists in the database. Skipping...`,
      );
      return scheduledEvent;
    }

    let role: Role;
    try {
      role = await this.createCustomRole(scheduledEvent);
    } catch (error) {
      throw new ScheduledEventsServiceError(
        'Failed to create custom role',
        scheduledEvent.id,
        scheduledEvent.name
      )
    }

    this.logger.info(
      `Created role ${yellow(role.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`
    );

    const dbEntry = await database.createScheduledEvent(
      scheduledEvent.id,
      role.id,
    );
    if (!dbEntry) {
      throw new ScheduledEventsServiceError(
        'Failed to create database entry for scheduled event',
        scheduledEvent.id,
        scheduledEvent.name
      );
    }

    customRoleQueue.processQueues();
    // Don't need to manually queue the event creator into customRoleQueue. They trigger the GuildScheduledEventCreate listener which queues
    // the creator then.
    this.logger.info(
      `Wrote scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}] into the database.`,
      'Marked scheduled event ready for custom role assignment queue.',
    );
    return scheduledEvent;
  }


  /**
   * Processes multiple scheduled events in batch.
   * @param events - Map of Discord scheduled events to process
   * @returns A promise that resolves to an array of successfully processed events (or null for failures)
   */
  public async batchProcessEvents(
    events: Map<string, GuildScheduledEvent>,
  ): Promise<ProcessEventResult[]> {
    const results: ProcessEventResult[] = [];
    for (const [_id, event] of events) {
      try {
        const processedEvent = await this.processEvent(event);
        results.push({ event: processedEvent });
      } catch (error) {
        // Catch here to continue with other events in this batch operation
        // Include the failed event in result
        this.logger.error(
          `Failed to process a scheduled event ${yellow(event.name)}[${cyan(event.id)}] in batch operation.`, error
        );
        results.push({
          event: null,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }
    return results;
  }

  /**
   * Gets the role ID associated with a scheduled event from the database.
   * @param eventId - The Discord scheduled event ID
   * @returns Promise resolving to the role ID or null if not found
   */
  public async getEventRoleId(eventId: string): Promise<string | null> {
    const { database } = container;
    const dbEvent = await database.findScheduledEvent(eventId);
    return dbEvent?.roleId || null;
  }

  /**
   * Cleans up a scheduled event by removing its role, database entry, and queue entries.
   * This is called when an event is deleted or completed.
   * @param scheduledEvent - The Discord scheduled event to clean up
   * @param reason - The reason for cleanup (shown in Discord audit log)
   * @returns Promise resolving to a CleanupEventResult indicating what was cleaned up
   */
  public async cleanupEvent(
    scheduledEvent: GuildScheduledEvent,
    reason: string,
  ): Promise<CleanupEventResult> {
    const { database, customRoleQueue } = container;
    const result: CleanupEventResult = {
      roleDeleted: false,
      dbEntryDeleted: false,
      queueCleared: false,
      failedAssignmentsCleared: false,
      errors: [],
    };

    // 1. Clear the role assignment queue
    try {
      customRoleQueue.clearEventQueue(scheduledEvent);
      result.queueCleared = true;
    } catch (error) {
      result.errors.push(`Failed to clear queue: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. Clear any failed assignments for this event
    try {
      await database.deleteFailedAssignmentsByEvent(scheduledEvent.id);
      result.failedAssignmentsCleared = true;
    } catch (error) {
      result.errors.push(`Failed to clear failed assignments: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Find the database entry
    let dbEntry;
    try {
      dbEntry = await database.findScheduledEvent(scheduledEvent.id);
      if (!dbEntry) {
        this.logger.warn(
          `No database entry found for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]. ` +
          `Skipping role and database cleanup.`,
        );
        return result;
      }
    } catch (error) {
      result.errors.push(`Failed to find database entry: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }

    // 4. Delete the role if it exists
    if (scheduledEvent.guild) {
      try {
        const role = await scheduledEvent.guild.roles.fetch(dbEntry.roleId);
        if (role) {
          await role.delete(reason);
          result.roleDeleted = true;
          this.logger.info(
            `Deleted role ${yellow(role.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
          );
        } else {
          this.logger.info(
            `Role with ID ${dbEntry.roleId} not found for event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]. ` +
            `Role may have been manually deleted.`,
          );
        }
      } catch (error) {
        result.errors.push(`Failed to delete role: ${error instanceof Error ? error.message : String(error)}`);
        this.logger.error(
          `Discord API failed to delete role with ID ${dbEntry.roleId} for event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
          error,
        );
      }
    } else {
      result.errors.push('Guild not available from scheduled event');
    }

    // 5. Delete the database entry (always attempt this, even if role deletion failed)
    try {
      const deleteResult = await database.deleteScheduledEvent(scheduledEvent.id);
      if (deleteResult && deleteResult.affectedRows > 0) {
        result.dbEntryDeleted = true;
        this.logger.info(
          `Deleted database entry for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        );
      } else {
        this.logger.warn(
          `No database entry was deleted for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        );
      }
    } catch (error) {
      result.errors.push(`Failed to delete database entry: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.error(
        `Failed to delete database entry for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        error,
      );
    }

    return result;
  }

  /**
   * Creates a custom role for a scheduled event.
   * @param scheduledEvent - The Discord scheduled event to create a role for.
   * Must have valind guild, scheduledEvent.guild must be non-null.
   * @returns A promise that resolves to the created role
   */
  private async createCustomRole(
    scheduledEvent: GuildScheduledEvent,
  ): Promise<Role> {
    let name: string;
    // Determine datetime or recurrency for role name
    if (!scheduledEvent.recurrenceRule) {
      const startTime = scheduledEvent.scheduledStartAt || new Date(0);
      const timestamp = new Timestamp('MMM-DD HH:mm')
      name = `${reasonableTruncate(scheduledEvent.name)} [${timestamp.display(startTime)}]`;
    } else {
      const { frequency } = scheduledEvent.recurrenceRule;
      let freqString = ['Yearly', 'Monthly', 'Weekly', 'Daily'];
      name = `${reasonableTruncate(scheduledEvent.name)} [${freqString[frequency]}]`;
    }

    return await scheduledEvent.guild!.roles.create({
      name: name,
      mentionable: true,
      reason: `Role for the scheduled event ${scheduledEvent.name}.`,
      permissions: [], // Empty permissions array indicates no additional permissions for role
    });
  }
}
