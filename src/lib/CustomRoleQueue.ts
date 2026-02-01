/**
 * @file CustomRoleQueue.ts
 * @description Queue system for processing custom role assignments for Discord scheduled event.
 * Prevents race conditions with the database by handling role assignments asynchronously.
 */

import { container } from '@sapphire/framework';
import { cyan, yellow } from 'colorette';
import { GuildScheduledEvent, User } from 'discord.js';

/**
 * Properties for items in the event queue
 */
type customRoleQueuesProp = {
  scheduledEvent: GuildScheduledEvent;
  user: User;
  attempts: number;
  maxAttempts: number;
  lastFailureReason?: string;
};

/**
 * This queue processes the assignment of custom roles to people that enrolled into a Discord
 * scheduled event. We use this queue to prevent race conditions with the database by handling
 * finding the role and assigning it asynchronously.
 */
export class CustomRoleQueue {
  /**
   * Map of event queues, keyed by event ID
   */
  private eventQueues: Map<string, customRoleQueuesProp[]> = new Map();

  /**
   * Flag indicating whether queue processing is currently active
   */
  private processing: boolean = false;

  /**
   * Interval in milliseconds between queue processing attempts
   */
  private readonly processInterval: number = 10000;

  /**
   * Creates a new custom role assignment queue and starts the processing interval
   * @constructor
   */
  constructor() {
    setInterval(() => this.processQueues(), this.processInterval);
  }

  /**
   * Adds a user to the role assignment queue
   * @param scheduledEvent - The Discord scheduled event
   * @param user - The user to be assigned a role
   */
  public queueAssignment(scheduledEvent: GuildScheduledEvent, user: User) {
    const eventId = scheduledEvent.id;
    if (!this.eventQueues.has(eventId)) {
      this.eventQueues.set(eventId, []);
    }

    this.eventQueues.get(eventId)?.push({
      scheduledEvent,
      user,
      attempts: 0,
      maxAttempts: 5,
    });
    container.client.logger.info(
      `Queued enrollment for user ${yellow(user.username)}[${cyan(user.id)}] for scheduled event ${yellow(scheduledEvent.name)}[${cyan(eventId)}]`,
    );
  }

  /**
   * Removes a user from the role assignment queue
   * @param scheduledEvent - The Discord scheduled event
   * @param user - The user to be removed from the queue
   */
  public removeAssignment(scheduledEvent: GuildScheduledEvent, user: User) {
    if (!this.eventQueues.has(scheduledEvent.id)) return;

    const queue = this.eventQueues.get(scheduledEvent.id);
    if (!queue) return;

    const index = queue.findIndex((item) => item.user.id === user.id);
    if (index !== -1) {
      queue.splice(index, 1);
      container.client.logger.info(
        `Removed pending user ${yellow(user.username)}[${cyan(user.id)}] from the role assignment queue for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`,
      );
      // Delete the event from queue if no one else needs a role
      if (queue.length === 0) {
        this.eventQueues.delete(scheduledEvent.id);
      }
    }
  }

  /**
   * Clears all pending users for a specific event in the role assignment queue
   * @param scheduledEvent - The Discord scheduled event to clear role assignments for
   */
  public clearEventQueue(scheduledEvent: GuildScheduledEvent) {
    if (this.eventQueues.has(scheduledEvent.id)) {
      const count = this.eventQueues.get(scheduledEvent.id)?.length || 0;
      this.eventQueues.delete(scheduledEvent.id);
      container.logger.info(
        `Cleared ${count} pending enrollments for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`,
      );
    } else {
      // processQueues() deletes empty queues, so a queue may not exist for a scheduled
      // event until someone is queued up for a role
      container.logger.info(
        `There wasn't an custom role assignment queue for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`,
      );
    }
  }

  /**
   * Persists a failed assignment to the database dead letter queue.
   * @private
   * @async
   * @param item - The queue item that failed
   */
  private async persistFailedAssignment(item: customRoleQueuesProp): Promise<void> {
    const { database, client } = container;
    try {
      await database.createFailedAssignment({
        eventId: item.scheduledEvent.id,
        userId: item.user.id,
        eventName: item.scheduledEvent.name,
        userName: item.user.username,
        failureReason: item.lastFailureReason || 'Unknown failure',
        attemptCount: item.attempts,
      });
      client.logger.warn(
        `Persisted failed assignment for user ${yellow(item.user.username)}[${cyan(item.user.id)}] ` +
        `to dead letter queue for manual recovery.`,
      );
    } catch (error) {
      client.logger.error(
        `Failed to persist failed assignment to database for user ${yellow(item.user.username)}[${cyan(item.user.id)}]`,
        error,
      );
    }
  }

  /**
   * Processes all queued enrollments
   * @private
   * @async
   */
  public async processQueues() {
    if (this.processing) return;
    this.processing = true;
    try {
      const { database, client } = container;
      for (const [eventId, queue] of this.eventQueues.entries()) {
        // Delete empty queues
        if (queue.length === 0) {
          this.eventQueues.delete(eventId);
          continue;
        }
        const dbEvent = await database.findScheduledEvent(eventId);
        // DB entry for event not ready, log attempt and try again
        if (!dbEvent) {
          // Increment attempt and then skip the entry
          for (const item of queue) {
            item.attempts++;
            item.lastFailureReason = 'Database entry for scheduled event not found';
            // Once max attempts is hit, persist to dead letter queue and remove from queue
            if (item.attempts >= item.maxAttempts) {
              client.logger.error(
                `Failed to assign a custom role to user ${yellow(item.user.username)}[${cyan(item.user.id)}] for scheduled event ${yellow(item.scheduledEvent.name)}[${cyan(item.scheduledEvent.id)}]`,
              );
              await this.persistFailedAssignment(item);
              const index = queue.indexOf(item);
              if (index > -1) queue.splice(index, 1);
            }
          }
          continue;
        }

        // Process each user in the queue for this event
        for (const item of queue) {
          const { scheduledEvent, user } = item;
          try {
            if (!scheduledEvent.guild) {
              item.attempts++;
              item.lastFailureReason = 'Guild not found from scheduled event';
              client.logger.error(
                `Failed to find guild from scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
              );
              if (item.attempts >= item.maxAttempts) {
                await this.persistFailedAssignment(item);
                const index = queue.indexOf(item);
                if (index > -1) queue.splice(index, 1);
              }
              continue;
            }

            const role = await scheduledEvent.guild.roles.fetch(dbEvent.roleId);
            if (!role) {
              item.attempts++;
              item.lastFailureReason = `Role with ID ${dbEvent.roleId} not found`;
              client.logger.error(
                `Failed to find role associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
              );
              if (item.attempts >= item.maxAttempts) {
                await this.persistFailedAssignment(item);
                const index = queue.indexOf(item);
                if (index > -1) queue.splice(index, 1);
              }
              continue;
            }

            const member = await scheduledEvent.guild.members.fetch(user.id);
            if (!member) {
              item.attempts++;
              item.lastFailureReason = `Member with ID ${user.id} not found in guild`;
              client.logger.error(
                `Failed to find member in guild ${yellow(scheduledEvent.guild.name)}[${cyan(scheduledEvent.guild.id)}] from user ${yellow(user.username)}[${cyan(user.id)}]`,
              );
              if (item.attempts >= item.maxAttempts) {
                await this.persistFailedAssignment(item);
                const index = queue.indexOf(item);
                if (index > -1) queue.splice(index, 1);
              }
              continue;
            }

            await member.roles.add(role);
            client.logger.info(
              `Assigned role ${yellow(role.name)} to guild member ${yellow(member.displayName)}[${cyan(member.id)}].`,
              'Removing them from the custom role assignment queue.',
            );
            const index = queue.indexOf(item);
            if (index > -1) queue.splice(index, 1);
          } catch (error) {
            item.attempts++;
            item.lastFailureReason = error instanceof Error ? error.message : String(error);
            client.logger.error(
              `Error processing role assignment for ${yellow(user.username)}[${cyan(user.id)}]:`,
              error,
            );
            if (item.attempts >= item.maxAttempts) {
              await this.persistFailedAssignment(item);
              const index = queue.indexOf(item);
              if (index > -1) queue.splice(index, 1);
            }
          }
        }
      }
    } catch (error) {
      container.client.logger.warn(
        'Failed to process a scheduled event in the custom role assignment queue.',
      );
      container.client.logger.error(error);
    } finally {
      this.processing = false;
    }
  }
}
