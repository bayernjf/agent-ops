import { startDaemon } from './index.js';

void startDaemon()
  .then(({ port, databasePath }) => {
    console.log(`Agent Ops daemon listening at http://localhost:${port}`);
    console.log(`Agent Ops state database: ${databasePath}`);
  })
  .catch(error => {
    console.error(`Agent Ops daemon failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
