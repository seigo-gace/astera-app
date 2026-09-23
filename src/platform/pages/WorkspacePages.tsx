import { useRef, useState } from 'react';
import { ApiError, apiBinaryRequest, apiRequest, apiUrl, asArray, asRecord, recordText } from '../api-client';
import { nativeCallback, openExternalUrl } from '../external-navigation';
import type { RouteMatch } from '../route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, RecordList, submitForm, useResource, type SubmitState } from './page-kit';

const STORAGE_FILE_MAX_BYTES = 1024 * 1024 * 1024;
const STORAGE_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;

function bytesLabel(value: unknown): string {
  const bytes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0]!;
  for (let index = 0; index < units.length; index += 1) {
    unit = units[index]!;
    if (size < 1024 || index === units.length - 1) break;
    size /= 1024;
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

function storageStatusLabel(value: unknown): string {
  switch (typeof value === 'string' ? value : '') {
    case 'stored': return '保存済み';
    case 'pending': return 'Upload処理中';
    case 'error': return '保存失敗';
    case 'corrupt': return '整合性Error';
    default: return typeof value === 'string' && value ? value : '状態不明';
  }
}

function errorState(error: unknown, fallback: string): SubmitState {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : fallback,
    code: error instanceof ApiError ? error.code : 'UNKNOWN_ERROR',
  };
}

function StorageDestinationsPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/storage/destinations');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const authorize = async (provider: string) => {
    const payload = await submitForm('/api/storage/destinations/authorize', {
      provider,
      return_to: window.location.pathname,
      native_callback: nativeCallback('/app/settings/storage-destinations'),
    }, setState, { success: '認証画面を開きます。', idempotent: true });
    const url = recordText(asRecord(payload), ['authorization_url', 'url', 'redirect_url']);
    if (!url) {
      setState({ type: 'error', message: 'Authorization URLがありません。', code: 'STORAGE_AUTH_URL_MISSING' });
      return;
    }
    try {
      await openExternalUrl(url);
      setState({ type: 'idle' });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : '認証画面を開けませんでした。', code: 'STORAGE_AUTH_OPEN_FAILED' });
    }
  };
  return <ResponsivePageShell route={route} description="Google Drive等の外部StorageをAccount単位で接続します。"><Panel title="接続先追加"><div className="platform-action-row"><button className="platform-button" type="button" onClick={() => void authorize('google-drive')}>Google Driveを接続</button><button className="platform-button" type="button" onClick={() => void authorize('google-sheets')}>Google Sheetsを接続</button></div><FormResult state={state} /></Panel><Panel title="接続済みStorage">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <RecordList items={asArray(resource.data, ['destinations', 'items'])} titleKeys={['display_name', 'provider', 'name', 'id']} subtitleKeys={['status', 'updated_at']} />}</Panel></ResponsivePageShell>;
}

function AsteraStoragePage({ route }: { route: RouteMatch }) {
  const [catalog, reloadCatalog] = useResource('/api/account/catalog');
  const [objects, reloadObjects] = useResource('/api/storage/objects');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<SubmitState>({ type: 'idle' });
  const [deleteState, setDeleteState] = useState<SubmitState>({ type: 'idle' });
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [activeUploadId, setActiveUploadId] = useState('');
  const uploadAbort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    reloadObjects();
    reloadCatalog();
  };

  const cancelUpload = () => {
    uploadAbort.current?.abort('cancelled');
  };

  const upload = async () => {
    if (!selectedFile) {
      setUploadState({ type: 'error', message: 'UploadするFileを選択してください。', code: 'STORAGE_FILE_REQUIRED' });
      return;
    }
    if (selectedFile.size > STORAGE_FILE_MAX_BYTES) {
      setUploadState({ type: 'error', message: 'Fileは1GB上限です。', code: 'STORAGE_FILE_TOO_LARGE' });
      return;
    }

    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploadedBytes(0);
    setUploadState({ type: 'working', message: 'Uploadを準備しています。' });
    let objectId = '';

    try {
      const idempotencyKey = crypto.randomUUID();
      const initialized = await apiRequest('/api/storage/uploads', {
        method: 'POST',
        body: {
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          mime_type: selectedFile.type || 'application/octet-stream',
          private_mode: false,
        },
        signal: controller.signal,
        timeoutMs: 30_000,
        idempotencyKey,
      });
      const uploadDescriptor = asRecord(asRecord(initialized).upload);
      objectId = recordText(uploadDescriptor, ['object_id']);
      const chunkSize = Number(uploadDescriptor.chunk_size || STORAGE_UPLOAD_CHUNK_BYTES);
      const chunkCount = Number(uploadDescriptor.chunk_count);
      const expectedChunkCount = selectedFile.size === 0 ? 0 : Math.ceil(selectedFile.size / chunkSize);
      if (!objectId || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(chunkCount) || chunkCount < 0 || chunkCount !== expectedChunkCount) {
        throw new ApiError('Storage Upload情報が不正です。', 502, 'STORAGE_UPLOAD_DESCRIPTOR_INVALID', initialized);
      }
      setActiveUploadId(objectId);

      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * chunkSize;
        const end = Math.min(selectedFile.size, start + chunkSize);
        setUploadState({ type: 'working', message: `Upload中 ${index + 1}/${chunkCount}` });
        await apiBinaryRequest(`/api/storage/uploads/${encodeURIComponent(objectId)}/chunks/${index}`, selectedFile.slice(start, end), {
          method: 'PUT',
          signal: controller.signal,
          timeoutMs: 300_000,
        });
        setUploadedBytes(end);
      }

      setUploadState({ type: 'working', message: '暗号化してStorageへ保存しています。' });
      await apiRequest(`/api/storage/uploads/${encodeURIComponent(objectId)}/complete`, {
        method: 'POST',
        signal: controller.signal,
        timeoutMs: 600_000,
        idempotent: true,
      });
      setUploadedBytes(selectedFile.size);
      setUploadState({ type: 'success', message: 'Astera Storageへの保存が完了しました。' });
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = '';
      refresh();
    } catch (error) {
      if (objectId) {
        await apiRequest(`/api/storage/uploads/${encodeURIComponent(objectId)}`, { method: 'DELETE', timeoutMs: 30_000 }).catch(() => undefined);
      }
      setUploadState(controller.signal.aborted
        ? { type: 'error', message: 'Uploadを中止しました。', code: 'STORAGE_UPLOAD_CANCELLED' }
        : errorState(error, 'Uploadに失敗しました。'));
      reloadObjects();
    } finally {
      uploadAbort.current = null;
      setActiveUploadId('');
    }
  };

  const removeObject = async (objectId: string) => {
    setDeleteState({ type: 'working', message: '削除しています。' });
    try {
      await apiRequest(`/api/storage/objects/${encodeURIComponent(objectId)}`, { method: 'DELETE', timeoutMs: 30_000 });
      setDeleteState({ type: 'success', message: 'Storage Fileを削除しました。' });
      refresh();
    } catch (error) {
      setDeleteState(errorState(error, '削除に失敗しました。'));
    }
  };

  const downloadObject = (objectId: string) => {
    window.location.assign(apiUrl(`/api/storage/objects/${encodeURIComponent(objectId)}/download`));
  };

  const items = objects.status === 'ready'
    ? asArray(objects.data, ['objects', 'items']).map((item) => asRecord(item))
    : [];
  const progress = selectedFile && selectedFile.size > 0
    ? Math.min(100, Math.round((uploadedBytes / selectedFile.size) * 100))
    : uploadState.type === 'success' ? 100 : 0;

  return <ResponsivePageShell route={route} description="Astera StorageへFileを暗号化保存し、一覧・Download・削除をAccount単位で管理します。">
    <Panel title="Storage Entitlement">
      {catalog.status === 'loading' ? <BusyState /> : catalog.status === 'error' ? <ErrorState error={catalog.error} onRetry={reloadCatalog} /> : (() => { const root = asRecord(catalog.data); const account = asRecord(root.account ?? root.data ?? root); return <KeyValueGrid value={account.storage ?? account} />; })()}
    </Panel>

    <Panel title="File Upload">
      <label className="platform-field">
        <span>File（最大1GB）</span>
        <input ref={fileInput} type="file" disabled={uploadState.type === 'working'} onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setUploadedBytes(0); setUploadState({ type: 'idle' }); }} />
      </label>
      {selectedFile && <p className="platform-form-result" role="status">{selectedFile.name} · {bytesLabel(selectedFile.size)}</p>}
      {uploadState.type === 'working' && <div className="platform-form-result" role="status"><strong>{uploadState.message ?? 'Upload中です。'}</strong><span>{progress}% · {bytesLabel(uploadedBytes)} / {bytesLabel(selectedFile?.size ?? 0)}</span></div>}
      {uploadState.type !== 'working' && <FormResult state={uploadState} />}
      <div className="platform-action-row">
        <button className="platform-button is-primary" type="button" disabled={!selectedFile || uploadState.type === 'working'} onClick={() => void upload()}>Upload</button>
        {uploadState.type === 'working' && <button className="platform-button" type="button" onClick={cancelUpload}>中止</button>}
      </div>
      {activeUploadId && <small>Upload ID: {activeUploadId}</small>}
    </Panel>

    <Panel title="保存File" actions={<button className="platform-button" type="button" onClick={reloadObjects}>再読込</button>}>
      {objects.status === 'loading' ? <BusyState /> : objects.status === 'error' ? <ErrorState error={objects.error} onRetry={reloadObjects} /> : items.length === 0 ? <p>保存Fileはありません。</p> : <ul className="platform-list">{items.map((item, index) => {
        const objectId = recordText(item, ['id']);
        const fileName = recordText(item, ['file_name', 'name'], `File ${index + 1}`);
        const status = recordText(item, ['status']);
        return <li key={objectId || `${fileName}-${index}`}><strong>{fileName}</strong><span>{bytesLabel(item.file_size)} · {storageStatusLabel(status)}</span><div className="platform-action-row">{status === 'stored' && objectId && <button className="platform-button" type="button" onClick={() => downloadObject(objectId)}>Download</button>}{status === 'stored' && objectId && <button className="platform-button" type="button" disabled={deleteState.type === 'working'} onClick={() => void removeObject(objectId)}>削除</button>}</div></li>;
      })}</ul>}
      <FormResult state={deleteState} />
    </Panel>

    <Panel title="運用原則"><ul className="platform-list"><li>Private Mode本文はAstera Storageへ保存しません。</li><li>1 Fileは1GB上限、Browserからは32MiB単位で安全に分割Uploadします。</li><li>Download時は保存時の暗号化情報とChecksumを検証します。</li><li>容量不足時はUpload開始前に安全停止します。</li></ul></Panel>
  </ResponsivePageShell>;
}

export function WorkspacePage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'settings-storage-destinations': return <StorageDestinationsPage route={route} />;
    case 'settings-astera-storage': return <AsteraStoragePage route={route} />;
    default: return null;
  }
}
