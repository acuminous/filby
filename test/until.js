const { setTimeout: sleep } = require('node:timers/promises');

async function until(predicate, { timeout = 5000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeout}ms`);
    await sleep(interval);
  }
}

function once(filby, event, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} not received within ${timeout}ms`)), timeout);
    filby.subscribe(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

module.exports = { until, once };
