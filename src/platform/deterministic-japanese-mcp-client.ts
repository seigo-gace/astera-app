import type {
  DeterministicJapaneseMcpConnectionPolicy,
  DeterministicJapaneseMcpResponse,
} from '../../packages/contracts/src/mcp';

export class DeterministicJapaneseMcpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'DeterministicJapaneseMcpError';
  }
}

function assertValidResponse(
  response: DeterministicJapaneseMcpResponse,
  policy: DeterministicJapaneseMcpConnectionPolicy,
): void {
  if (response.schemaVersion !== policy.expectedSchemaVersion) {
    throw new DeterministicJapaneseMcpError('MCP_SCHEMA_MISMATCH', 'MCP Schema Versionが一致しません。');
  }
  if (response.parserVersion !== policy.pinnedParserVersion) {
    throw new DeterministicJapaneseMcpError('MCP_VERSION_MISMATCH', '固定Parser Versionと一致しません。');
  }
  if (!response.requestId || !Array.isArray(response.meaningGraph?.nodes) || !Array.isArray(response.meaningGraph?.edges)) {
    throw new DeterministicJapaneseMcpError('MCP_RESPONSE_INVALID', 'Meaning Graphが不正です。');
  }
  if (!Array.isArray(response.taskGraph?.orderedTaskIds) || !Array.isArray(response.taskGraph?.prohibitedTaskIds)) {
    throw new DeterministicJapaneseMcpError('MCP_TASK_GRAPH_INVALID', 'Task Graphが不正です。');
  }
}

export async function parseJapaneseDeterministically(
  input: string,
  requestId: string,
  policy: DeterministicJapaneseMcpConnectionPolicy,
  externalSignal?: AbortSignal,
): Promise<DeterministicJapaneseMcpResponse> {
  if (!input.trim()) throw new DeterministicJapaneseMcpError('MCP_INPUT_REQUIRED', '解析対象が空です。');
  if (!requestId) throw new DeterministicJapaneseMcpError('MCP_REQUEST_ID_REQUIRED', 'Request IDが必要です。');

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), policy.timeoutMs);
  const abortFromExternal = () => controller.abort(externalSignal?.reason ?? 'cancelled');
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    const httpResponse = await fetch(policy.endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        requestId,
        input,
        expectedSchemaVersion: policy.expectedSchemaVersion,
        pinnedParserVersion: policy.pinnedParserVersion,
      }),
      signal: controller.signal,
    });

    if (!httpResponse.ok) {
      throw new DeterministicJapaneseMcpError(
        'MCP_HTTP_FAILED',
        `MCP接続に失敗しました。HTTP ${httpResponse.status}`,
      );
    }

    const payload = await httpResponse.json() as DeterministicJapaneseMcpResponse;
    assertValidResponse(payload, policy);
    return payload;
  } catch (error) {
    if (error instanceof DeterministicJapaneseMcpError) throw error;
    if (controller.signal.aborted) {
      throw new DeterministicJapaneseMcpError('MCP_TIMEOUT_OR_CANCELLED', 'MCP処理を安全停止しました。', error);
    }
    throw new DeterministicJapaneseMcpError('MCP_CONNECTION_FAILED', 'MCPへ接続できないため安全停止しました。', error);
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}
