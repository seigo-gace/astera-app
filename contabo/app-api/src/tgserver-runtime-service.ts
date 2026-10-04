import type { RuntimeConfig } from './config.js';
import { AsteraRuntimeService, type RuntimeCreateRequest } from './index.js';
import type { AsteraAppRuntimeLogger } from './tgserver-zero-log.js';

export class TgServerObservedAsteraRuntimeService extends AsteraRuntimeService {
  constructor(config: RuntimeConfig, private readonly runtimeLogger: AsteraAppRuntimeLogger) {
    super(config);
  }

  override async execute(input: RuntimeCreateRequest): Promise<void> {
    const jobId = input.job_id;
    await super.execute(input);
    const job = await this.database.get(jobId).catch(() => null);
    if (!job) return;
    if (job.state === 'completed') {
      this.runtimeLogger.log({ level: 'info', event: 'runtime_job_completed' });
      return;
    }
    if (job.state === 'partially_completed') {
      this.runtimeLogger.log({ level: 'warn', event: 'runtime_job_partially_completed' });
      return;
    }
    if (job.state === 'failed') {
      this.runtimeLogger.log({ level: 'error', event: 'runtime_job_failed', code: job.error_code });
      return;
    }
    if (job.state === 'cancelled') {
      this.runtimeLogger.log({ level: 'info', event: 'runtime_job_cancelled', code: job.error_code });
    }
  }

  override async cancel(jobId: string, correlationId: string) {
    const job = await super.cancel(jobId, correlationId);
    if (job.state === 'cancelled') {
      this.runtimeLogger.log({ level: 'info', event: 'runtime_job_cancelled', code: job.error_code });
    }
    return job;
  }
}
