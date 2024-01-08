import { EventEmitter2 as EventEmitter } from 'eventemitter2';
import { PoolClient, PoolConfig } from 'pg';

export default class Filby extends EventEmitter {
  constructor(config: Config);
  init(): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  stop(): Promise<void>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  getProjections(): Promise<Projection[]>;
  getProjection(name: string, version: number): Promise<Projection>;
  getChangeLog(projection: Projection): Promise<ChangeSet[]>;
  getChangeSet(id: number): Promise<ChangeSet>;
  getAggregates<T>(changeSetId: number, name: string, version: number): Promise<T[]>;
};

export type Config = {
  migrations?: string;
  database?: PoolConfig;
  notification?: {
    interval?: string;
    delay?: string;
    maxAttempts?: number;
  }
};

export type Projection = {
  id: number;
  name: string;
  version: number;
};

export type ChangeSet = {
  id: number;
  effective: Date;
  description: string;
  lastModified: Date;
  entityTag: string;
};

export type Event = {
  event: string;
} & Projection;

export type Entity = {
  name: string;
  version: number;
};