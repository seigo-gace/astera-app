import type { RuntimeConfig } from './config.js';
import type { VerifiedFileMaterial } from './core-process-adapter.js';
import { AsteraRuntimeService, type RuntimeCreateRequest } from './index.js';
import type { PrivateFileMaterializer } from './private-file-materializer.js';

type RuntimeError = Error & { code?: string; retryable?: boolean };
export type PrivateObjectDestroyer = (input: { objectId: string; tenantId: string; userId: string }) => Promise<void>;

type MaterializedRuntimeCreateRequest = RuntimeCreateRequest & {
  verified_file_materials?: VerifiedFileMaterial[];
};

function wipeMaterials(materials: VerifiedFileMaterial[] | null): void {
  if (!materials) return;
  for (const material of materials) {
    material.extractedText = '';
    material.inspection.reasons.length = 0;
  }
  materials.length = 0;
}

function scrubInput(input: RuntimeCreateRequest): void {
  input.prompt = '';
  input.purpose_text = null;
  input.files.length = 0;
  input.options.length = 0;
}

export class PrivateMaterializingRuntimeService extends AsteraRuntimeService {
  constructor(
    config: RuntimeConfig,
    private readonly materializer: Pick<PrivateFileMaterializer, 'materialize'>,
    private readonly destroyPrivateObject: PrivateObjectDestroyer,
  ) {
    super(config);
    this.bindPrivateObjectDestroyer(destroyPrivateObject);
  }

  private async destroyInputFiles(input: RuntimeCreateRequest): Promise<void> {
    const objectIds = [...new Set(input.files.map((file) => file.upload_id))];
    for (const objectId of objectIds) {
      await this.destroyPrivateObject({ objectId, tenantId: input.tenant_id, userId: input.user_id });
    }
  }

  override async execute(input: RuntimeCreateRequest): Promise<void> {
    if (!input.private_mode || input.files.length === 0) {
      await super.execute(input);
      return;
    }
    if (this.active.has(input.job_id)) return;

    const controller = new AbortController();
    let materials: VerifiedFileMaterial[] | null = null;
    this.active.set(input.job_id, controller);
    try {
      const current = await this.database.transition(
        input.job_id,
        ['queued', 'running'],
        'running',
        input.correlation_id,
        { private_file_materialization: true },
      );
      if (!current || ['completed', 'partially_completed', 'failed', 'cancelled'].includes(current.state)) {
        await this.destroyInputFiles(input);
        scrubInput(input);
        return;
      }
      if (current.state === 'cancel_requested') {
        await this.destroyInputFiles(input);
        await this.database.finish(input.job_id, {
          state: 'cancelled',
          errorCode: 'JOB_CANCELLED',
          errorMessage: 'File Security Pipeline開始前にJobを取り消しました。',
          retryable: false,
        }, input.correlation_id);
        scrubInput(input);
        return;
      }

      materials = await this.materializer.materialize(input, controller.signal);
      if (controller.signal.aborted) {
        throw Object.assign(new Error('File Security Pipeline実行中にJobを取り消しました。'), {
          code: 'JOB_CANCELLED',
          retryable: false,
        });
      }
    } catch (caught) {
      let error = caught as RuntimeError;
      let cleanupFailed = false;
      try {
        await this.destroyInputFiles(input);
      } catch {
        cleanupFailed = true;
        error = Object.assign(new Error('Private Object Cleanupに失敗しました。'), {
          code: 'PRIVATE_OBJECT_CLEANUP_FAILED',
          retryable: true,
        });
      }
      const cancelled = !cleanupFailed && (error.code === 'JOB_CANCELLED' || controller.signal.aborted);
      const code = cancelled ? 'JOB_CANCELLED' : (error.code || 'PRIVATE_PIPELINE_UNAVAILABLE');
      await this.database.finish(input.job_id, {
        state: cancelled ? 'cancelled' : 'failed',
        errorCode: code,
        errorMessage: cancelled ? 'File Security Pipeline実行中にJobを取り消しました。' : (error.message || 'Private File Security Pipelineに失敗しました。'),
        retryable: cancelled ? false : error.retryable === true,
      }, input.correlation_id).catch(() => undefined);
      wipeMaterials(materials);
      scrubInput(input);
      return;
    } finally {
      this.active.delete(input.job_id);
    }

    const enriched = input as MaterializedRuntimeCreateRequest;
    enriched.verified_file_materials = materials ?? [];
    try {
      await super.execute(input);
    } finally {
      wipeMaterials(materials);
      delete enriched.verified_file_materials;
    }
  }
}
