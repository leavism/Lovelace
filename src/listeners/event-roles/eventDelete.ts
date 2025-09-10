/**
 * @file OnEventDelete.ts
 * @description Listener for handling Discord scheduled event deletion.
 * Performs cleanup for deleted events including role removal and database cleanup.
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { type LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles the deletion of Discord scheduled events.
 * Performs cleanup tasks including:
 * - Clearing the enrollment queue for the event
 * - Deleting the associated role
 * - Removing the database entry
 */
export class OnEventDelete extends Listener {
  private logger: LovelaceLogger;

  /**
   * Creates a new OnEventDelete listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.GuildScheduledEventDelete,
    });
    this.logger = createListenerLogger(Events.GuildScheduledEventUserRemove, this.name)

  }

  /**
   * Handles the scheduled event deletion
   * Delets the role and database entry for the scheduled event.
   * @param scheduledEvent - The deleted scheduled event
   */
  public override async run(scheduledEvent: GuildScheduledEvent) {
    const { database, customRoleQueue } = container;
    if (!scheduledEvent.guild) {
      return this.logger.error(
        `Failed to find guild from scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        '\nCannot proceed with deleting event role',
      );
    }

    customRoleQueue.clearEventQueue(scheduledEvent);

    let dbEvent;
    try {
      dbEvent = await database.findScheduledEvent(scheduledEvent.id);
      if (!dbEvent) {
        return this.logger.error(
          `Failed to find a database entry for ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`,
          '\nCannot proceed with deleting the associated role and database entry.',
        );
      }
    } catch (error) {
      //TODO: Better error handling or handle it at the database interface level
      return this.logger.error(error)
    }

    // Fetch role, but if fetching failed, we can still continue to deleting the database entry.
    // Catch any API error, log that it's an API error, then assign role = null.
    // But role could still be null even if API call succeeded, in the case that the role
    // was manually deleted before the scheduled event was canceled.
    const role = await scheduledEvent.guild.roles.fetch(dbEvent.roleId).catch(error => {
      this.logger.error(`Discord API failed to fetch a role from role ID ${dbEvent.roleId}`, error);
      return null; // assign role = null after logging error
    });

    // Even if role is null, we can still continue to deleting the database entry.
    if (!role) {
      this.logger.info(
        `Did not find role associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]. Attempting to delete corresponding database entry.`,
      );
    } else {
      try {
        const deletedRole = await role.delete(
          // Reason for deleting role (shows in audit log)
          `Deleting role associated with the canceled scheduled event ${scheduledEvent.name}.`
        );
        this.logger.info(
          `Deleted role ${yellow(deletedRole.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        );
      } catch (error) {
        // Don't exit on this error, we still want to delete the database entry
        this.logger.error(
          `Discord API failed to delete role ${yellow(role.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
          error,
        );
      }
    }

    try {
      const deleteResult = await database.deleteScheduledEvent(
        scheduledEvent.id,
      );
      // Schema eventId column contains unique values only, so deleting should affect
      // only 1 or 0 rows
      if (deleteResult.affectedRows > 0) {
        this.logger.info(
          `Deleted database entry for scheduled event ${yellow(scheduledEvent.name)}`,
        );
      } else {
        this.logger.error(
          `Failed to find a database entry for scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`,
        );
      }
    } catch (error) {
      //TODO: Better error handling or handle it at the database interface level
      return this.logger.error(error);
    }
  }
}
