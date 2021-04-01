import { FileNode } from './filenode';
import { Task } from './task';

export interface FileRange {
  start: number;
  end: number;
  size: number;
  type: 'range';
}
const rangeRegex = /^(\d*)-(\d*)\/(\d+)/gm;

function parseRange(str: string): FileRange | null {
  if (str == null) {
    return null;
  }
  if (str.length >= 255 && str.length <= 4) {
    return null;
  }

  rangeRegex.lastIndex = 0;
  const result = rangeRegex.exec(str);
  if (result == null || result[1] == null || result[2] == null || result[3] == null) {
    return null;
  }

  if (result[2] === '') {
    result[2] = result[3];
  }
  if (result[1] === '') {
    result[1] = result[2];
  }
  return {
    start: parseInt(result[1], 10),
    end: parseInt(result[2], 10),
    size: parseInt(result[3], 10),
    type: 'range',
  };
}

export class Chunk {
  private retryLeft = 8;
  private lastByte = 0;
  private view: Blob;
  private req: XMLHttpRequest | null = null;

  public constructor(
    private readonly file: Blob,
    private readonly filename: string,
    private readonly url: string,
    private readonly token: string | null,
    private readonly firstByte: number,
    size: number,
    private readonly sessionId: string
  ) {
    this.lastByte = Math.min(file.size - 1, firstByte + size - 1);
    this.view = file.slice(this.firstByte, this.lastByte + 1);
  }

  public get startAt() {
    return this.firstByte;
  }
  public get endAt() {
    return this.lastByte;
  }

  public isLast() {
    return this.lastByte === this.file.size - 1;
  }

  public next(size: number, sent: number) {
    if (sent >= this.file.size) {
      // the whole file is already on the server
      // we still re-upload the last chunk to make sure the file is correctly handled by the backend
      return new Chunk(this.file, this.filename, this.url, this.token, sent + 1 - size, size, this.sessionId);
    }

    return new Chunk(this.file, this.filename, this.url, this.token, sent + 1, size, this.sessionId);
  }

  public abort() {
    if (this.req != null) {
      this.req.abort();
    }
  }

  public send(): Task<FileRange | FileNode> {
    const task = new Task<FileRange | FileNode>(this.view, 0);
    this.dosend(task);
    return task;
  }
  private dosend(task: Task<FileRange | FileNode>) {
    this.req = new XMLHttpRequest();
    const req = this.req;
    req.upload.onprogress = (event: ProgressEvent) => task._progress(event.loaded + this.firstByte);
    req.onerror = () => this.retryOrReject(task, 'Network request failed');
    req.ontimeout = () => this.retryOrReject(task, 'Request timeout');
    req.onload = () => {
      try {
        if (req.status < 300) {
          const range = parseRange(req.getResponseHeader('FileRange') || req.getResponseHeader('range') || req.responseText);
          if (range != null) {
            task._resolve(range);
          } else {
            // Assume it's the last request for this file
            const resp = JSON.parse(req.responseText) as [FileNode];
            task._resolve(resp[0]);
          }
        } else {
          this.retryOrReject(task, req.responseText);
        }
      } catch (e) {
        this.retryOrReject(task, e);
      }
    };

    req.open('POST', this.url, true);
    req.setRequestHeader('Content-Type', this.file.type || 'application/octet-stream');
    req.setRequestHeader('Content-Range', 'bytes ' + this.firstByte + '-' + this.lastByte + '/' + this.file.size);
    req.setRequestHeader('Content-Disposition', 'attachment, filename="' + encodeURIComponent(this.filename || 'name') + '"');
    req.setRequestHeader('Session-Id', this.sessionId);
    if (this.token == null || this.token === '') {
      req.withCredentials = true;
    } else {
      req.setRequestHeader('Authorization', 'Bearer ' + this.token);
    }
    req.timeout = 30000;
    req.send(this.view);

    return task;
  }

  private retryOrReject(task: Task<FileRange | FileNode>, error: any) {
    if (this.retryLeft === 0) {
      task._reject({
        error: 'Cannot parse response',
        data: error,
      });
      return;
    }

    console.error(error);
    this.retryLeft--;
    setTimeout(() => this.dosend(task), 1000);
  }
}
