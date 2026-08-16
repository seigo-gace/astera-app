export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export class StorageApiError extends Error {
  constructor(public readonly status:number, public readonly code:string, message:string){super(message);this.name='StorageApiError'}
}
