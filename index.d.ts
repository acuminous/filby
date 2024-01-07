import { EventEmitter2 as EventEmitter } from 'eventemitter2';
import { PoolClient, PoolConfig } from 'pg';

export default class Filby extends EventEmitter {
  constructor(config: RdfConfig);
  init(): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  stop(): Promise<void>;
  withTransaction(callback: (client: PoolClient) => Promise<any>);
  getProjections(): Promise<RdfProjection[]>;
  getProjection(name: string, version: number): Promise<RdfProjection>;
  getChangeLog(projection: RdfProjection): Promise<RdfChangeSet[]>;
  getChangeSet(id: number): Promise<RdfChangeSet>;
};

export type RdfConfig = {
  migrations?: string;
  database?: PoolConfig;
  notification?: {
    interval?: string;
    delay?: string;
    maxAttempts?: number;
  }
};

export type RdfProjection = {
  id: number;
  name: string;
  version: number;
};

export type RdfChangeSet = {
  id: number;
  effective: Date;
  notes: string;
  lastModified: Date;
  entityTag: string;
};

export type RdfEvent = {
  event: string;
} & RdfProjection;

export type RdfEntity = {
  name: string;
  version: number;
};