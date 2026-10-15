import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { DEMO_EVENT_ID } from './seed.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const app = createApp({ config, clock: { now: Date.now }, logger });

const timers = app.loops.map(({ name, everyMs, run }) =>
  setInterval(() => {
    try {
      run();
    } catch (err) {
      logger.error('background loop failed', { loop: name, error: err.message, stack: err.stack });
    }
  }, everyMs),
);

const server = createServer(app.handler);
server.listen(config.port, config.host, () => {
  logger.info('ticketing mock backend listening', { url: `http://${config.host}:${server.address().port}`, demoEventId: DEMO_EVENT_ID });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    timers.forEach(clearInterval);
    server.close(() => process.exit(0));
  });
}
