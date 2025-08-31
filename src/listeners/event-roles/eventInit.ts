/**
 * @file eventInit.ts
 * @description Listener for processing scheduled events are not already in the database.
 * This is mostly scheduled events made while the bot was offline.
 * Initializes scheduled events processing on bot startup.
 */

import { Listener, container } from '@sapphire/framework';
import { Events } from 'discord.js';
import { yellow, cyan } from 'colorette';

/**
 * Listener that handles the Discord client ready event.
 * When the bot starts up, this fetches all scheduled events for the configured guild
 * and processes them through the scheduledEventsService.
 */
export class OnClientReady extends Listener {
  /**
   * Creates a new OnClientReady listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.ClientReady,
    });
  }

  /**
   * Handles the client ready event
   * Fetches all scheduled events from the configured guild and processes them in batch
   */
  public override async run() {
    const { client, scheduledEventsService, customRoleQueue } = container;
    // TODO: Only works for the ACM blue Discord server. Make it work for
    // multiple servers?

    // EventInit runs on bot startup, nothing is cached so we need to
    // fetch server, events, and members
    const acmguild = await client.guilds.fetch(`${process.env.GUILD}`);
    const events = await acmguild.scheduledEvents.fetch();
    const processedEvents =
      await scheduledEventsService.batchProcessEvents(events);

    for (const event of processedEvents) {
      if (!event) {
        client.logger.error(
          `Failed to process scheduled event during initialization.`,
          '\nSkipping this event for event initialization.',
        );
        continue;
      }

      // Get the role ID from the database
      const roleId = await scheduledEventsService.getEventRoleId(event.id);
      if (!roleId) {
        client.logger.error(
          `Failed to find role ID for scheduled event ${yellow(event.name)}[${cyan(event.id)}].`,
          '\nSkipping this event for event initialization.',
        );
        continue;
      }

      const subscribers = await event.fetchSubscribers({ withMember: true });
      for (const [_userID, subscriber] of subscribers) {
        let { member } = subscriber;
        if (!member) {
          client.logger.error(
            `Failed to find member in guild ${acmguild.name}.`,
            '\nSkipping this member for event initialization.',
          );
          continue;
        }

        member = await member.fetch();
        const hasRole = member.roles.cache.find((role) => role.id === roleId);
        if (!hasRole) {
          customRoleQueue.queueAssignment(event, member.user);
        }
      }
    }
  }
}
