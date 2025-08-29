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

/**
 * Service that processes Discord scheduled events.
 * Handles creation of custom roles and database entries for events,
 * as well as batch processing multiple events.
 */
export class ScheduleEventsService {
	/**
	 * Processes a single scheduled event, creating a custom role and database entry.
	 * @param scheduledEvent - The Discord scheduled event to process.
	 * @returns A promise that resolves to the scheduled event if successful, null otherwise.
	 */
	public async processEvent(
		scheduledEvent: GuildScheduledEvent,
	): Promise<GuildScheduledEvent | null> {
		const { client, database } = container;
		try {
			if (!scheduledEvent.guild) {
				client.logger.error(
					`Failed to find guild from scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
					'\nCannot proceed with creating scheduled event role.',
				);
				return null;
			}
			const dbEvent = await database.findScheduledEvent(scheduledEvent.id);
			if (dbEvent) {
				client.logger.info(
					`Scheduled event ${yellow(scheduledEvent.name)} already exists in the database. Skipping processing in scheduled events service.`,
				);
				return scheduledEvent;
			}
			const role = await this.createCustomRole(scheduledEvent);
			if (!role) {
				client.logger.error(
					`Failed to create role associated with scheduled event ${yellow(scheduledEvent.name)}.`,
				);
				return null;
			}
			client.logger.info(
				`Created role ${yellow(role.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
			);
			const newDbEntry = await this.createEventDBEntry(scheduledEvent, role.id);
			if (!newDbEntry) {
				client.logger.error(
					`Failed to write scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}] into the database.`,
				);
				return null;
			}
			client.logger.info(
				`Wrote scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}] into the database.`,
				'Marked scheduled event ready for custom role assignment queue.',
			);
			return scheduledEvent;
		} catch (error) {
			client.logger.warn(
				'Failed to process a scheduled event in the scheduled events service.',
			);
			client.logger.error(error);
			return null;
		}
	}

	/**
	 * Processes multiple scheduled events in batch.
	 * @param events - Map of Discord scheduled events to process
	 * @returns A promise that resolves to an array of successfully processed events (or null for failures)
	 */
	public async batchProcessEvents(
		events: Map<string, GuildScheduledEvent>,
	): Promise<(GuildScheduledEvent | null)[]> {
		const { client } = container;
		const result: (GuildScheduledEvent | null)[] = [];
		for (const [_id, event] of events) {
			try {
				const processedEvent = await this.processEvent(event);
				result.push(processedEvent);
			} catch (error) {
				client.logger.warn(
					`Failed to process a scheduled event ${yellow(event.name)}[${cyan(event.id)}] in the scheduled events service.`,
				);
				client.logger.error(error);
				result.push(null);
			}
		}
		return result;
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
	 * Gets the role object associated with a scheduled event.
	 * @param scheduledEvent - The Discord scheduled event
	 * @returns Promise resolving to the Role object or null if not found
	 */
	public async getEventRole(
		scheduledEvent: GuildScheduledEvent,
	): Promise<Role | null> {
		if (!scheduledEvent.guild) return null;

		const roleId = await this.getEventRoleId(scheduledEvent.id);
		if (!roleId) return null;

		try {
			return await scheduledEvent.guild.roles.fetch(roleId);
		} catch (error) {
			container.client.logger.error(
				`Failed to fetch role ${roleId} for event ${scheduledEvent.name}[${scheduledEvent.id}]`,
				error,
			);
			return null;
		}
	}

	/**
	 * Creates a custom role for a scheduled event.
	 * @param scheduledEvent - The Discord scheduled event to create a role for
	 * @returns A promise that resolves to the created role, or undefined if creation failed
	 */
	private async createCustomRole(
		scheduledEvent: GuildScheduledEvent,
	): Promise<Role | undefined> {
		let name: string;
		if (scheduledEvent.recurrenceRule == null) {
			const startTime = scheduledEvent.scheduledStartTimestamp || new Date(0);
			const timestamp = new Timestamp('MMM-DD HH:mm');
			name = `${reasonableTruncate(scheduledEvent.name)} [${timestamp.display(startTime)}]`;
		} else {
			const { frequency } = scheduledEvent.recurrenceRule;
			let freqString = '';
			switch (frequency) {
				case 0:
					freqString = 'Yearly';
					break;
				case 1:
					freqString = 'Monthly';
					break;
				case 2:
					freqString = 'Weekly';
					break;
				case 3:
					freqString = 'Daily';
					break;
			}
			name = `${reasonableTruncate(scheduledEvent.name)} [${freqString}]`;
		}
		const role = await scheduledEvent.guild?.roles.create({
			name: name,
			mentionable: true,
			reason: `Role for the scheduled event ${scheduledEvent.name}.`,
			permissions: [], // Empty permissions array indicates no additional permissions for role
		});
		return role;
	}

	/**
	 * Creates a database entry for a scheduled event and queues the event creator for role assignment.
	 * @param scheduledEvent - The Discord scheduled event to create a database entry for
	 * @param roleId - The ID of the role associated with the event
	 * @returns A promise that resolves to true if the database entry was created successfully, false otherwise
	 */
	private async createEventDBEntry(
		scheduledEvent: GuildScheduledEvent,
		roleId: string,
	): Promise<boolean> {
		const { database, customRoleQueue } = container;
		const response = await database.createScheduledEvent(
			scheduledEvent.id,
			roleId,
		);
		// Once db entry for event is created, mark it as ready in custom role assignment queue
		// for processing, then queue the event author.
		if (response.affectedRows > 0) {
			customRoleQueue.processQueues();
			return true;
		} else {
			return false;
		}
	}
}
