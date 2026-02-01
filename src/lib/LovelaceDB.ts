/**
 * @file LovelaceDB.ts
 * @description Singleton database connector for MySQL integration using Drizzle ORM.
 * This class provides a centralized interface for database operations.
 */

// import { container } from '@sapphire/framework';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import * as schema from '../db/schema/schema';
import { ScheduledEventDBEntry, FailedAssignmentDBEntry } from '../db/schema/schema';

/**
 * Singleton database connector that should only be initialized inside LovelaceClient.
 * Provides methods for common database operations and maintains a single database connection.
 * @class
 */
export class LovelaceDB {
  /**
   * Stores the singleton instance of LovelaceDB.
   */
  private static instance: LovelaceDB | null = null;
  /**
   * Stores the MySQL connection pool.
   */
  private static mysqlPool: mysql.Pool | null = null;
  /**
   * The Drizzle ORM database instance.
   */
  private db: ReturnType<typeof drizzle>;

  /**
   * Private constructor to prevent direct instantiation.
   * Initializes the Drizzle ORM with the provided MySQL connection.
   * @private
   * @constructor
   * @param connection - An active MySQL connection
   */
  private constructor(pool: mysql.Pool) {
    this.db = drizzle({ client: pool, schema, mode: 'default' });
  }

  /**
   * Gets the singleton instance of LovelaceDB.
   * Creates a new instance if one doesn't exist.
   * @static
   * @async
   * @returns The singleton instance of LovelaceDB
   */
  public static async getInstance(): Promise<LovelaceDB> {
    if (!LovelaceDB.instance) {
      LovelaceDB.mysqlPool = mysql.createPool({
        uri: process.env.DATABASE_URL,
      });
      LovelaceDB.instance = new LovelaceDB(LovelaceDB.mysqlPool);
    }
    return LovelaceDB.instance;
  }

  /**
   * Closes the MySQL connection and resets the instance.
   * @static
   * @async
   */
  public static async destroy() {
    if (LovelaceDB.mysqlPool) {
      await LovelaceDB.mysqlPool.end();
      LovelaceDB.mysqlPool = null;
      LovelaceDB.instance = null;
    }
  }

  /**
   * Creates a new user in the database.
   * @async
   * @param discordId - The Discord ID of the user
   * @returns The result of the insert operation
   */
  public async createUser(discordId: string) {
    return await this.db.insert(schema.users).values({ discordId });
  }

  /**
   * Creates a new scheduled event in the database.
   * @async
   * @param eventId - The ID of the event
   * @param roleId - The role ID associated with the event
   * @returns The first result of the insert operation or null
   */
  public async createScheduledEvent(eventId: string, roleId: string) {
    const result = await this.db.insert(schema.scheduledEvents).values({
      eventId,
      roleId,
    });
    return result[0] || null;
  }

  /**
   * Finds a scheduled event by its ID.
   * @async
   * @param eventId - The ID of the event to find
   * @returns The first matching event or null if not found
   */
  public async findScheduledEvent(
    eventId: string,
  ): Promise<ScheduledEventDBEntry | null> {
    const results = await this.db
      .select()
      .from(schema.scheduledEvents)
      .where(eq(schema.scheduledEvents.eventId, eventId));
    return results[0] || null;
  }

  /**
   * Deletes a scheduled event by its ID.
   * @async
   * @param eventId - The ID of the event to delete
   * @returns The result of the delete operation or null
   */
  public async deleteScheduledEvent(eventId: string) {
    const result = await this.db
      .delete(schema.scheduledEvents)
      .where(eq(schema.scheduledEvents.eventId, eventId));
    return result[0] || null;
  }

  // ==================== Failed Assignments (Dead Letter Queue) ====================

  /**
   * Creates a failed assignment record for manual recovery.
   * @async
   * @param params - The failed assignment details
   * @returns The result of the insert operation or null
   */
  public async createFailedAssignment(params: {
    eventId: string;
    userId: string;
    eventName: string;
    userName: string;
    failureReason: string;
    attemptCount: number;
  }) {
    const result = await this.db.insert(schema.failedAssignments).values({
      eventId: params.eventId,
      userId: params.userId,
      eventName: params.eventName,
      userName: params.userName,
      failureReason: params.failureReason,
      attemptCount: params.attemptCount,
    });
    return result[0] || null;
  }

  /**
   * Finds all failed assignments, optionally filtered by event ID.
   * @async
   * @param eventId - Optional event ID to filter by
   * @returns Array of failed assignment records
   */
  public async findFailedAssignments(
    eventId?: string,
  ): Promise<FailedAssignmentDBEntry[]> {
    if (eventId) {
      return await this.db
        .select()
        .from(schema.failedAssignments)
        .where(eq(schema.failedAssignments.eventId, eventId));
    }
    return await this.db.select().from(schema.failedAssignments);
  }

  /**
   * Deletes a failed assignment by its ID.
   * @async
   * @param id - The ID of the failed assignment to delete
   * @returns The result of the delete operation
   */
  public async deleteFailedAssignment(id: number) {
    const result = await this.db
      .delete(schema.failedAssignments)
      .where(eq(schema.failedAssignments.id, id));
    return result[0] || null;
  }

  /**
   * Deletes all failed assignments for a specific event.
   * Used during event cleanup to remove stale records.
   * @async
   * @param eventId - The event ID to delete failed assignments for
   * @returns The result of the delete operation
   */
  public async deleteFailedAssignmentsByEvent(eventId: string) {
    const result = await this.db
      .delete(schema.failedAssignments)
      .where(eq(schema.failedAssignments.eventId, eventId));
    return result[0] || null;
  }
}
