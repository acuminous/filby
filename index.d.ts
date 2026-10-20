import { PoolClient, PoolConfig } from 'pg';

export { PoolConfig };

export class Filby {
  static HOOK_MAX_ATTEMPTS_EXHAUSTED: string;
  static NOTIFICATION_ERROR: string;
  static MIGRATION_LOCK_KEY: number;
  readonly config: Config;
  constructor(config: Config);
  init(): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  getNotificationStatus(): Promise<NotificationStatus>;
  subscribe<T>(event: string, handler: (notification: T, context: HandlerContext) => Promise<void>): void;
  unsubscribe<T>(event: string, handler?: (notification: T, context: HandlerContext) => Promise<void>): void;
  unsubscribeAll(): void;
  stop(): Promise<void>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  getProjections(): Promise<Projection[]>;
  getProjection(name: string, version: number): Promise<Projection | undefined>;
  getChangeLog(projection: Projection, options?: { since?: number }): Promise<ChangeSet[]>;
  getCurrentChangeSet(projection: Projection): Promise<ChangeSet | undefined>;
  getChangeSet(id: number): Promise<ChangeSet | undefined>;
  getAggregates<T>(changeSetId: number, name: string, version: number): Promise<T[]>;
  getDocuments<T>(projection: Projection, changeSetId: number, options?: DocumentOptions): Promise<Documents<T>>;
  fetch(request: Request, options?: FetchOptions): Promise<Response>;
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
    listen?: boolean;
  }
};

export type HandlerContext = {
  signal: AbortSignal;
};

export type Projection = {
  id: number;
  name: string;
  version: number;
  key: string;
};

export type DocumentOptions = {
  parameters?: Record<string, unknown>;
  pageOffset?: number;
  pageSize?: number;
};

export type Documents<T> = {
  documents: T[];
  total: number;
};

export type FetchOptions = {
  basePath?: string;
  info?: {
    title: string;
    version: string;
    description?: string;
  };
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
  id: number;
  hook: Hook;
  projection: Omit<Projection, 'id'>;
  attempts: number;
};

export type NotificationError = {
  error: Error;
  notification?: Notification;
};

export type NotificationStatus = {
  started: boolean;
  poller?: 'idle' | 'running' | 'stopped' | 'disabled';
  lastSuccessfulPollAt?: Date;
  failuresSinceLastSuccess: number;
  lastError?: {
    at: Date;
    message: string;
  };
  pending: number;
  overdue: number;
  exhausted: number;
};

export type Entity = {
  name: string;
  version: number;
};