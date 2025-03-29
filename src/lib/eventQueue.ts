import { container } from '@sapphire/framework';
import { cyan, yellow } from 'colorette';
import { GuildScheduledEvent, User } from 'discord.js';

type QueuedEnrollment = {
  scheduledEvent: GuildScheduledEvent;
  user: User;
  attempts: number;
  maxAttempts: number;
};

export class EventQueue {
  private enrollmentQueue: Map<string, QueuedEnrollment[]> = new Map();
  private processing: boolean = false;
  private readonly processInterval: number = 1000;

  constructor() {
    setInterval(() => this.processQueue(), this.processInterval);
  }

  /**
   * queueEnrollment
   */
  public queueEnrollment(scheduledEvent: GuildScheduledEvent, user: User) {
    const eventId = scheduledEvent.id;
    if (!this.enrollmentQueue.has(eventId)) {
      this.enrollmentQueue.set(eventId, []);
    }

    this.enrollmentQueue.get(eventId)?.push({
      scheduledEvent,
      user,
      attempts: 0,
      maxAttempts: 5,
    });
    container.client.logger.info(
      `Queued enrollment for user ${yellow(user.username)}[${cyan(user.id)}] in event ${yellow(scheduledEvent.name)}[${eventId}]`,
    );
  }

  /**
   * markEventReady
   */
  public markEventReady() {
    this.processQueue();
  }

  /**
   * removeEnrollment
   */
  public removeEnrollment(scheduledEvent: GuildScheduledEvent, user: User) {
    if (!this.enrollmentQueue.has(scheduledEvent.id)) return;

    const queue = this.enrollmentQueue.get(scheduledEvent.id);
    if (!queue) return;

    const index = queue.findIndex(item => item.user.id === user.id)
    if (index !== -1) {
      queue.slice(index, 1)
      container.client.logger.info(
        `Removed pending enrollment for user ${yellow(user.username)}[${cyan(user.id)}] from the event queue for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`
      )
      if (queue.length === 0) {
        this.enrollmentQueue.delete(scheduledEvent.id)
      }
    }
  }

  /**
   * clearEventQueue Clear all pending enrollments for an event
   */
  public clearEventQueue(scheduledEvent: GuildScheduledEvent) {
    if (this.enrollmentQueue.has(scheduledEvent.id)) {
      const count = this.enrollmentQueue.get(scheduledEvent.id)?.length || 0;
      this.enrollmentQueue.delete(scheduledEvent.id)

      if (count > 0) {
        container.client.logger.info(
          `Cleared ${count} pending enrolls for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}`
        )
      }
    }
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      const { database, client } = container;

      for (const [eventId, queue] of this.enrollmentQueue.entries()) {
        // skip empty queues
        if (queue.length === 0) {
          this.enrollmentQueue.delete(eventId)
          continue;
        }

        const dbEvent = await database.findScheduledEvent(eventId)
        // DB entry for event not ready, log and try again
        if (!dbEvent) {
          for (const item of queue) {
            item.attempts++;
            // Once max attempts is hit, log failure and remove from queue
            if (item.attempts >= item.maxAttempts) {
              client.logger.error(
                `Failed to process enrollment for user ${yellow(item.user.username)} for scheduled event ${yellow(item.scheduledEvent.name)}[${cyan(item.scheduledEvent.id)}] `
              )
              // 
              const index = queue.indexOf(item)
              if (index > -1) queue.splice(index, 1)
            }
          }
        }
      }


    } catch (error) {
      container.client.logger.error(error)
    }
  }
}
