import * as pg from 'pg';
import { PoolClient } from 'pg';

type Handler<T> = (notification: T, context: HandlerContext) => void | Promise<void>;
declare class Filby {
    static HOOK_MAX_ATTEMPTS_EXHAUSTED: string;
    static NOTIFICATION_ERROR: string;
    static MIGRATION_LOCK_KEY: number;
    constructor(config: Config);
    get config(): Config;
    init({ migrate }?: {
        migrate?: boolean;
    }): Promise<void>;
    startNotifications(): Promise<void>;
    stopNotifications(): Promise<void>;
    subscribe<T>(event: string, handler: Handler<T>): void;
    unsubscribe<T>(event: string, handler?: Handler<T>): void;
    unsubscribeAll(): void;
    stop(): Promise<void>;
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getProjections(): Promise<Projection[]>;
    getProjection(name: string, version: number): Promise<Projection | undefined>;
    getChangeLog(projection: Projection, { since }?: {
        since?: number;
    }): Promise<ChangeSet[]>;
    getCurrentChangeSet(projection: Projection): Promise<ChangeSet | undefined>;
    getChangeSet(changeSetId: number): Promise<ChangeSet | undefined>;
    getNotificationStatus(): Promise<NotificationStatus>;
    getAggregates<T>(changeSetId: number, name: string, version: number): Promise<T[]>;
    getDocuments<T>(projection: Projection, changeSetId: number, options?: DocumentOptions): Promise<Documents<T>>;
    fetch(request: Request, options?: FetchOptions): Promise<Response>;
    #private;
}

type PoolConfig = pg.PoolConfig;
type Config = {
    database?: PoolConfig;
    localDateTypes?: "string" | "pg";
    migrations?: string[];
    notifications?: {
        interval?: string;
        initialDelay?: string;
        maxAttempts?: number;
        maxRescheduleDelay?: string;
        handlerTimeout?: string;
        listen?: boolean;
    };
};
type HandlerContext = {
    signal: AbortSignal;
};
type Projection = {
    id: number;
    name: string;
    version: number;
    key: string;
};
type DocumentOptions = {
    parameters?: Record<string, unknown>;
    pageOffset?: number;
    pageSize?: number;
};
type FetchOptions = {
    basePath?: string;
    info?: {
        title: string;
        version: string;
        description?: string;
    };
};
type ChangeSet = {
    id: number;
    effective: Date;
    description: string;
    lastModified: Date;
    entityTag: string;
    reissuedFrom?: number;
};
type Hook = {
    name: string;
    event: string;
};
type Notification = {
    id: number;
    hook: Hook;
    projection: Omit<Projection, "id">;
    attempts: number;
};
type NotificationError = {
    error: Error;
    notification?: Notification;
};
type NotificationStatus = {
    started: boolean;
    poller?: "idle" | "running" | "stopped";
    lastSuccessfulPollAt?: Date;
    failuresSinceLastSuccess: number;
    lastError?: {
        at: Date;
        message: string;
    };
    pending: number;
    claimed: number;
    overdue: number;
    exhausted: number;
};
type Entity = {
    name: string;
    version: number;
};
type Documents<T> = {
    documents: T[];
    total: number;
};

export { Filby };
export type { ChangeSet, Config, DocumentOptions, Documents, Entity, FetchOptions, HandlerContext, Hook, Notification, NotificationError, NotificationStatus, PoolConfig, Projection };
