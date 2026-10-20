const path = require('node:path');

module.exports = {
  server: {
    port: 3000,
  },
  filby: {
    database: {
      port: 5433,
      user: 'fby_example',
      password: 'fby_example',
    },
    migrations: [
      path.resolve(__dirname, '..', 'migrations'),
    ],
    notifications: {
      interval: '5s',
      initialDelay: '1s',
      maxAttempts: 20,
      maxRescheduleDelay: '30s',
      handlerTimeout: '10s',
      listen: false,
    },
  },
  webhooks: {
    'httpbin/add-projection': 'https://httpbin.org/status/200',
    'httpbin/drop-projection': 'https://httpbin.org/status/200',
    'httpbin/add-change-set/park-v1': 'https://httpbin.org/status/200',
    'httpbin/add-change-set/*': 'https://httpbin.org/status/500',
  },
};
