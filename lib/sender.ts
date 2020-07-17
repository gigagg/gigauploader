import { Task } from './task';
import { FileNode } from './filenode';
import { Chunk } from './chunk';
import { UploadState } from './upload';

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
  token: string | null;
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

  public constructor() {}

  public sendFile(
    file: Blob,
    filename: string,
    sha1: string,
    deduplicate: FileStateCallback
  ): Task<FileNode> {
    const task = new Task<FileNode>(file, sha1);
    this.todo.push({
      name: filename,
      task,
      sha1,
      deduplicate,
    });
    this.launchNextCatchError();
    return task;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public set paused(p: boolean) {
    this._paused = p;
    this.launchNextCatchError();
  }

  public remove(task: Task<FileNode>) {
    if (this.current != null && this.current.task === task) {
      if (this.current.chunk != null) {
        this.current.aborted = true;
        this.current.chunk.abort();
      }
      this.current = undefined;
      this.launchNextCatchError();
    } else {
      const index = this.todo.findIndex((w) => w.task === task);
      if (index !== -1) {
        this.todo.splice(index, 1);
      }
    }
  }

  private launchNextCatchError() {
    this.launchNext()
    .catch(err => {
      if (this.current?.task != null) {
        this.current.task._reject(err);
      }
    });
  }

  private launchNext(): Promise<UploadState | 'paused'> {
    if (this._paused) {
      return Promise.resolve('paused');
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
      return this.urlLookup();
    }

    if (this.current != null && this.current.uploadUrl != null && !this.isChunkSending) {
      return this.launchNextChunk(this.current);
    }

    return Promise.resolve('pending');
  }

  private async urlLookup(): Promise<UploadState | 'paused'> {
    if (this.current == null) {
      return Promise.resolve('pending');
    }
    if (this.current.aborted) {
      return Promise.resolve('aborted');
    }
    const current = this.current;
    try {
      const response = await current.deduplicate(this.current.sha1, this.current.name);
      switch (response.state) {
        case 'already_existing':
          if (response.node == null) {
            throw new Error('response.node should not be null');
          }
          current.task._resolve(response.node);
          this.current = undefined;
          return this.launchNext();
        case 'created':
          if (response.node == null) {
            throw new Error('response.node should not be null');
          }
          current.task._resolve(response.node);
          this.current = undefined;
          return this.launchNext();
        case 'to_upload':
          if (response.uploadUrl == null) {
            throw new Error('uploadUrl should not be null');
          }
          current.uploadUrl = response.uploadUrl;
          current.token = response.token;
          current.task._progress(0);
          return this.launchNextChunk(current);
      }
      throw new Error('Invalid response.state');
    } catch (err) {
      current.task._reject(err);
      this.current = undefined;
      return this.launchNext();
    }
  }

  private async launchNextChunk(current: CurrentItem): Promise<UploadState | 'paused'> {
    if (current.aborted) {
      return Promise.resolve('aborted');
    }
    if (this._paused) {
      return Promise.resolve('paused');
    }
    if (current.uploadUrl == null) {
      throw new Error('url should not be null');
    }
    if (current.chunk == null) {
      current.chunk = new Chunk(
        current.task.file,
        current.name,
        current.uploadUrl,
        current.token,
        0,
        this.chunkSize,
        current.sha1
      );
    } else {
      current.chunk = current.chunk.next(this.chunkSize, current.sent);
    }
    const chunk = current.chunk;
    current.sent = 0;

    this.isChunkSending = true;
    const startSendAt = new Date().getTime();
    try {
      const value = await chunk.send().tap((done: number) => {
        current.task._progress(current.sent + done);
      });
      this.isChunkSending = false;
      if (value.type === 'range') {
        current.task._progress(value.end);
        current.sent = value.end;
        const duration = new Date().getTime() - startSendAt;
        this.refreshChunkSize(duration);
        return this.launchNextChunk(current);
      }
      if (value.type === 'file') {
        current.task._progress(current.task.file.size);
        current.sent = current.task.file.size;
        current.task._resolve(value);
        this.current = undefined;
        return this.launchNext();
      }
      throw new Error('unreachable: ' + (value as any).type);
    } catch (err) {
      // TODO: MANAGE THE alreadyExisting and Locked errors !

      this.isChunkSending = false;
      current.task._reject(err);
      this.chunkSize = 1024 * 128;
      this.current = undefined;
      return this.launchNext();
    }
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
