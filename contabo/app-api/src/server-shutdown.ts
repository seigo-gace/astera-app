export type ShutdownFailureEvent = 'private_broker_cleanup_failed' | 'database_close_failed';

export type ShutdownFailure = Readonly<{
  event: ShutdownFailureEvent;
  code: string;
}>;

export type ShutdownCloseResult = Readonly<{
  ok: boolean;
  exitCode: 0 | 1;
  failures: readonly ShutdownFailure[];
}>;

type CloseableResource = Readonly<{
  close(): Promise<void>;
}>;

function safeErrorCode(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const raw = (error as { code?: unknown }).code;
  if (typeof raw !== 'string') return fallback;
  const code = raw.trim();
  return /^[A-Z0-9_:-]{1,128}$/.test(code) ? code : fallback;
}

export async function closeRuntimeResources(
  privateDataBroker: CloseableResource,
  database: CloseableResource,
): Promise<ShutdownCloseResult> {
  const failures: ShutdownFailure[] = [];

  try {
    await privateDataBroker.close();
  } catch (error) {
    failures.push({
      event: 'private_broker_cleanup_failed',
      code: safeErrorCode(error, 'PRIVATE_OBJECT_CLEANUP_FAILED'),
    });
  }

  try {
    await database.close();
  } catch (error) {
    failures.push({
      event: 'database_close_failed',
      code: safeErrorCode(error, 'DATABASE_CLOSE_FAILED'),
    });
  }

  return {
    ok: failures.length === 0,
    exitCode: failures.length === 0 ? 0 : 1,
    failures,
  };
}
