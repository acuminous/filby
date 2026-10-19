import { PoolClient, PoolConfig } from 'pg';

export { PoolConfig };

export class Filby {
  static HOOK_MAX_ATTEMPTS_EXHAUSTED: string;
  static NOTIFICATION_ERROR: string;
  constructor(config: Config);
  init(): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  subscribe<T>(event: string, handler: (notification: T, context: HandlerContext) => Promise<void>);
  unsubscribe<T>(event: string, handler?: (notification: T, context: HandlerContext) => Promise<void>);
  unsubscribeAll();
  stop(): Promise<void>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  getProjections(): Promise<Projection[]>;
  getProjection(name: string, version: number): Promise<Projection>;
  getChangeLog(projection: Projection, options?: { since?: number }): Promise<ChangeSet[]>;
  getCurrentChangeSet(projection: Projection): Promise<ChangeSet>;
  getChangeSet(id: number): Promise<ChangeSet>;
  getAggregates<T>(changeSetId: number, name: string, version: number): Promise<T[]>;
}

export type Config = {
  database?: PoolConfig;
  migrations?: string[];
  notifications?: {
    interval?: string;
    initialDelay?: string;
    maxAttempts?: number;
    maxRescheduleDelay?: string;
    handlerTimeout?: string;
  }
};

export type HandlerContext = {
  signal: AbortSignal;
};

export type Projection = {
  name: string;
  version: number;
  key: string;
};

export type ChangeSet = {
  id: number;
  effective: Date;
  description: string;
  lastModified: Date;
  entityTag: string;
  reissuedFrom?: number;
};

export type Hook = {
  name: string;
  event: string;
}

export type Notification = {
  hook: Hook;
  projection: Projection;
  attempts: number;
};

export type ErrorNotification<T> = {
  err: T extends Error ? T : never;
} & Notification;

export type NotificationError = {
  error: Error;
};

export type Entity = {
  name: string;
  version: number;
};