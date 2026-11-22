import { PoolClient } from 'pg';
import { ChangeSet, Config, DocumentOptions, Documents, Entity, FetchOptions, Filby, HandlerContext, Hook, Notification, NotificationError, NotificationStatus, PoolConfig, Projection } from '../..';

const database: PoolConfig = { host: 'localhost', port: 5432 };

const config: Config = {
  database,
  localDateTypes: 'string',
  migrations: ['migrations'],
  notifications: {
    interval: '1m',
    initialDelay: '10s',
    maxAttempts: 10,
    maxRescheduleDelay: '1h',
    handlerTimeout: '30s',
    listen: true,
  },
};

type Park = { code: string; name: string };

async function usage(): Promise<void> {
  const filby = new Filby(config);
  const sameConfig: Config = filby.config;
  const events: string[] = [Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, Filby.NOTIFICATION_ERROR];
  const lockKey: number = Filby.MIGRATION_LOCK_KEY;

  await filby.init();
  await filby.init({ migrate: false });
  await filby.startNotifications();
  await filby.stopNotifications();
  const status: NotificationStatus = await filby.getNotificationStatus();

  const handler = (notification: Notification, { signal }: HandlerContext) => {
    const hook: Hook = notification.hook;
    signal.throwIfAborted();
  };
  const onError = async ({ error, notification }: NotificationError) => {};
  filby.subscribe('park-change', handler);
  filby.subscribe(Filby.NOTIFICATION_ERROR, onError);
  filby.unsubscribe('park-change', handler);
  filby.unsubscribe(Filby.NOTIFICATION_ERROR);
  filby.unsubscribeAll();

  const count: number = await filby.withTransaction(async (client: PoolClient) => (await client.query('SELECT 1')).rowCount ?? 0);

  const projections: Projection[] = await filby.getProjections();
  const projection: Projection | undefined = await filby.getProjection('Parks', 1);
  if (!projection) return;
  const changeLog: ChangeSet[] = await filby.getChangeLog(projection);
  const since: ChangeSet[] = await filby.getChangeLog(projection, { since: 1 });
  const current: ChangeSet | undefined = await filby.getCurrentChangeSet(projection);
  const changeSet: ChangeSet | undefined = await filby.getChangeSet(1);
  const aggregates: Park[] = await filby.getAggregates<Park>(1, 'Park', 1);
  const options: DocumentOptions = { parameters: { code: 'DC' }, pageOffset: 0, pageSize: 10 };
  const { documents, total }: Documents<Park> = await filby.getDocuments<Park>(projection, 1, options);

  const fetchOptions: FetchOptions = { basePath: '/api', info: { title: 'Parks', version: '1.0.0', description: 'Holiday parks' } };
  const response: Response = await filby.fetch(new Request('http://localhost/api/projections'), fetchOptions);

  const entity: Entity = { name: 'Park', version: 1 };
  await filby.stop();
}
