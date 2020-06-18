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
  if (
    result == null ||
    result[1] == null ||
    result[2] == null ||
    result[3] == null
  ) {
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
    this.lastByte = Math.min(file.size - 1, firstByte + size);
    this.view = file.slice(this.firstByte, this.lastByte + 1);
  }

  public isLast() {
    return this.lastByte === this.file.size - 1;
  }

  public next(size: number, sent: number) {
    if (this.lastByte === this.file.size - 1) {
      return null;
    }
    return new Chunk(
      this.file,
      this.filename,
      this.url,
      this.token,
      sent + 1,
      Math.min(size, this.file.size - this.lastByte - 1),
      this.sessionId
    );
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
    req.upload.onprogress = (event: ProgressEvent) =>
      task._progress(event.loaded + this.firstByte);
    req.onerror = (event) =>
      task._reject({
        status: 500,
        response: 'Request error',
        data: event.target,
      });
    req.onload = () => {
      try {
        if (req.status < 300) {
          const range = parseRange(
            req.getResponseHeader('FileRange') ||
              req.getResponseHeader('range') ||
              req.responseText
          );
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
    req.setRequestHeader(
      'Content-Type',
      this.file.type || 'application/octet-stream'
    );
    req.setRequestHeader(
      'Content-Range',
      'bytes ' + this.firstByte + '-' + this.lastByte + '/' + this.file.size
    );
    req.setRequestHeader(
      'Content-Disposition',
      'attachment, filename="' +
        encodeURIComponent(this.filename || 'name') +
        '"'
    );
    req.setRequestHeader('Session-Id', this.sessionId);
    if (this.token == null || this.token === '') {
      req.setRequestHeader('Authorization', 'Bearer ' + this.token);
    } else {
      req.withCredentials = true;
    }
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
