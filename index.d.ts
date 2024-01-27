import { PoolClient, PoolConfig } from 'pg';

export { PoolConfig };

export class Filby {
  static HOOK_MAX_ATTEMPTS_EXHAUSTED: string;
  constructor(config: Config);
  init(): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  subscribe<T>(event: string, handler: (notification: T) => Promise<void>);
  unsubscribe<T>(event: string, handler?: (notification: T) => Promise<void>);
  unsubscribeAll();
  stop(): Promise<void>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  getProjections(): Promise<Projection[]>;
  getProjection(name: string, version: number): Promise<Projection>;
  getChangeLog(projection: Projection): Promise<ChangeSet[]>;
  getCurrentChangeSet(projection: Projection): Promise<ChangeSet>;
  getChangeSet(id: number): Promise<ChangeSet>;
  getAggregates<T>(changeSetId: number, name: string, version: number): Promise<T[]>;
}

export type Migration = {
  path: string;
  permissions: string[];
};

export type Config = {
  migrations?: Migration[];
  database?: PoolConfig;
  notification?: {
    interval?: string;
    delay?: string;
    maxAttempts?: number;
  }
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

export type Entity = {
  name: string;
  version: number;
};