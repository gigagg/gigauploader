import { Task } from './task';
import { FileNode } from './filenode';
import { Chunk, FileRange } from './chunk';

export interface FileStateExisting {
  state: 'already_existing';
  node: FileNode;
}
export interface FileStateCreated {
  state: 'created';
  node: FileNode;
}
export interface FileStateToUpload {
  state: 'to_upload';
  uploadUrl: string;
  token: string;
}

export type FileState = FileStateExisting | FileStateCreated | FileStateToUpload;

export type FileStateCallback = (sha1: string, filename: string) => Promise<FileState>;

export interface TodoItem {
  name: string;
  task: Task<FileNode>;
  sha1: string;
  deduplicate: FileStateCallback;
}

export interface CurrentItem extends TodoItem {
  chunk: Chunk | null;
  uploadUrl: string | null;
  token: string | null;

  aborted: boolean;
  sent: number;
}

export class Sender {
  private todo: TodoItem[] = [];
  private current: CurrentItem | undefined = undefined;
  private _paused = false;
  private chunkSize = 128 * 1024;
  private isChunkSending = false;

  public constructor() { }

  public sendFile(file: Blob, filename: string, sha1: string, deduplicate: FileStateCallback): Task<FileNode> {
    const task = new Task<FileNode>(file, sha1);
    this.todo.push({
      name: filename, task, sha1, deduplicate
    });
    this.launchNext();
    return task;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public set paused(p: boolean) {
    this._paused = p;
    this.launchNext();
  }

  public remove(task: Task<FileNode>) {
    if (this.current != null && this.current.task === task) {
      if (this.current.chunk != null) {
        this.current.aborted = true;
        this.current.chunk.abort();
      }
      this.current = undefined;
      this.launchNext();
    } else {
      const index = this.todo.findIndex(w => w.task === task);
      if (index !== -1) {
        this.todo.splice(index, 1);
      }
    }
  }

  private launchNext() {
    if (this._paused) {
      return;
    }
    if (this.current == null && this.todo.length > 0) {
      const tmp = this.todo.shift();
      if (tmp == null) {
        throw new Error('tmp must not be null');
      }
      this.current = {
        ...tmp,
        chunk: null,
        uploadUrl: null,
        token: null,
        aborted: false,
        sent: 0,
      };
      this.current.task._progress(0);
      this.urlLookup();
    }

    if (this.current != null &&
      this.current.uploadUrl != null &&
      this.current.token != null &&
      !this.isChunkSending) {
      this.launchNextChunk(this.current);
    }
  }

  private urlLookup() {
    if (this.current == null) {
      return;
    }
    if (this.current.aborted) {
      return;
    }
    const current = this.current;
    current.deduplicate(this.current.sha1, this.current.name)
      .then(response => {
        switch (response.state) {
          case 'already_existing':
            if (response.node == null) {
              throw new Error('response.node should not be null');
            }
            current.task._resolve(response.node);
            break;
          case 'created':
            if (response.node == null) {
              throw new Error('response.node should not be null');
            }
            current.task._resolve(response.node);
            break;
          case 'to_upload':
            if (response.uploadUrl == null) {
              throw new Error('uploadUrl should not be null');
            }
            current.uploadUrl = response.uploadUrl;
            current.token = response.token;
            current.task._progress(0);
            this.launchNextChunk(current);
            break;
        }
      }, err => {
        current.task._reject(err);
        this.current = undefined;
        this.launchNext();
      });
  }

  private launchNextChunk(current: CurrentItem) {
    if (current.aborted || this._paused) {
      return;
    }
    if (current.uploadUrl == null || current.token == null) {
      throw new Error('url and token should not be null');
    }
    if (current.chunk == null) {
      current.chunk = new Chunk(current.task.file, current.name, current.uploadUrl, current.token, 0, this.chunkSize, current.sha1);
    } else {
      current.chunk = current.chunk.next(this.chunkSize, current.sent);
    }
    const chunk = current.chunk;
    if (chunk == null) {
      throw new Error('Chunk should not be null');
    }
    current.sent = 0;

    this.isChunkSending = true;
    const startSendAt = new Date().getTime();
    chunk.send().tap((done: number) => {
      current.task._progress(current.sent + done);
    }).then((value: FileNode | FileRange) => {
      this.isChunkSending = false;
      if (value.type === 'range') {
        current.task._progress(value.end);
        current.sent = value.end;
        const duration = new Date().getTime() - startSendAt;
        this.refreshChunkSize(duration);
        this.launchNextChunk(current);
      } else if (value.type === 'file') {
        current.task._progress(current.task.file.size);
        current.sent = current.task.file.size;
        current.task._resolve(value);
        this.current = undefined;
        this.launchNext();
      } else {
        throw new Error('unreachable: ' + (value as any).type);
      }
    }, (err: any) => {
      this.isChunkSending = false;
      current.task._reject(err);
      this.current = undefined;
      this.chunkSize = 1024 * 128;
      this.launchNext();
    });
  }

  private refreshChunkSize(msDuration: number) {
    if (msDuration < 1000 && this.chunkSize <= 1024 * 1024 * 4) {
      this.chunkSize *= 2;
    }
    if (msDuration > 2000 && this.chunkSize >= 1024 * 256) {
      this.chunkSize /= 2;
    }
  }
}
