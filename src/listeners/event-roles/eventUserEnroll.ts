/**
 * @file OnEventEnroll.ts
 * @description Listener for handling users joining Discord scheduled events.
 * Queues users for role assignment when they join an event.
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent, User } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { type LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles users joining Discord scheduled events.
 * Forwards user enrollment to the custom role assignment queue for processing.
 */
export class OnEventUserEnroll extends Listener {
  private logger: LovelaceLogger;

  /**
   * Creates a new OnEventEnroll listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      name: "EventUserEnroll",
      event: Events.GuildScheduledEventUserAdd,
    });
    this.logger = createListenerLogger(Events.GuildScheduledEventUserRemove, this.name)

  }

  /**
   * Handles a user joining a scheduled event
   * Adds the user to the custom role assignment queue
   * @param scheduledEvent - The scheduled event the user joined
   * @param user - The user who joined the event
   */
  public override async run(scheduledEvent: GuildScheduledEvent, user: User) {
    const { customRoleQueue } = container;
    if (!scheduledEvent.guild) {
      return this.logger.error(
        `Failed to find guild from scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        'Cannot proceed with assigning event role.',
      );
    }

    if (!user) {
      return this.logger.error(
        `Failed to find user enrolling into scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        'Cannot proceed with assigning event role.',
      );
    }

    customRoleQueue.queueAssignment(scheduledEvent, user);
  }
}
