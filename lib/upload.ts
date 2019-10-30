import { Task } from './task';
import { Hasher } from './hasher';
import { Sender, FileStateCallback } from './sender';
import { FileNode } from './filenode';

export type UploadState = 'pending' | 'hashing' | 'sending' | 'aborted' | 'error' | 'finished';

export class UploadProgress {
  private readonly avgSize = 30;
  private saved: any[] = [];
  private index = -1;

  private time = 0;
  public done = 0;
  public percent = 0;
  public speed = 0; // bytes/milisecond


  public constructor(
    public total: number,
  ) {
  }

  public _save() {
    if (this.time <= 0) {
      return;
    }
    if (this.saved.length < this.avgSize) {
      this.saved.push({
        done: this.done,
        time: this.time,
      });
      this.index = this.saved.length - 1;
    } else {
      this.index = (this.index === this.saved.length - 1) ? 0 : this.index + 1;
      this.saved[this.index] = {
        done: this.done,
        time: this.time,
      };
    }

    const previous = (this.index === this.saved.length - 1) ? 0 : this.index + 1;
    this.percent = 100 * this.done / this.total;
    if (this.index !== previous && this.saved[this.index].time - this.saved[previous].time !== 0) {
      this.speed = (this.saved[this.index].done - this.saved[previous].done) / (this.saved[this.index].time - this.saved[previous].time);
    }
  }

  public _setProgress(done: number) {
    this.done = done;
    this.time = new Date().getTime();
  }

  public _reset() {
    this.done = 0;
    this.time = 0;
    this.percent = 0;
    this.speed = 0;
    this.saved = [];
    this.index = -1;
  }
}

export class Upload {
  private hashTask: Task<string> | null = null;
  private sendTask: Task<FileNode> | null = null;

  public state: UploadState = 'pending';
  public progress: UploadProgress;
  public promise: Promise<FileNode | null>;
  public fileSize: number;

  public constructor(
    private file: Blob,
    public fileName: string,
    private deduplicate: FileStateCallback,
    private hasher: Hasher,
    private sender: Sender,
  ) {
    this.progress = new UploadProgress(file.size);
    this.promise = this.start();
    this.fileSize = file.size;
  }

  private async start(): Promise<FileNode | null> {
    try {
      this.hashTask = this.hasher.hashFile(this.file);
      const sha1 = await this.hashTask.tap(hashed => {
        this.state = 'hashing';
        this.progress._setProgress(hashed);
      });
      this.progress._setProgress(this.file.size);

      this.sendTask = this.sender.sendFile(this.file, this.fileName, sha1, this.deduplicate);
      const fileNode = await this.sendTask.tap(sent => {
        if (sent === 0) {
          this.progress._reset();
        }
        this.state = 'sending';
        this.progress._setProgress(sent);
      });
      this.state = 'finished';
      this.progress._setProgress(this.file.size);
      return fileNode;

    } catch (err) {
      if (this.state !== 'aborted') {
        this.state = 'error';
        throw err;
      }
    }

    return null;
  }

  public abort() {
    if (this.state === 'finished' || this.state === 'error' || this.state === 'aborted') {
      return;
    }
    this.state = 'aborted';
    if (this.hashTask != null) {
      this.hasher.remove(this.hashTask);
    }
    if (this.sendTask != null) {
      this.sender.remove(this.sendTask);
    }
  }

  public _updateProgress() {
    this.progress._save();
  }
}
