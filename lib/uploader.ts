import { Upload } from './upload';
import { FileStateCallback, Sender } from './sender';
import { Hasher } from './hasher';

export interface UploadConfig {
  workerUrl: string;

  /**
   * Optional progress callback, called each time the
   * progress of heach upload has been updated
   */
  onProgress?: () => void;
}

export class Uploader {
  public uploads: Upload[] = [];
  private _paused = false;
  private sender: Sender;
  private hasher: Hasher;
  private progressUpdater: number | null = null;
  private onProgress: (() => void) | null = null;

  public constructor(config: UploadConfig) {
    this.sender = new Sender();
    this.hasher = new Hasher(config.workerUrl);
    this.onProgress = config.onProgress || null;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public set paused(paused: boolean) {
    this._paused = paused;
    this.sender.paused = paused;
    this.hasher.paused = paused;
    for (let i = 0; i < this.uploads.length; i++) {
      this.uploads[i].progress._reset();
    }

    if (this._paused) {
      this.stopProgress();
    } else {
      this.startProgress();
    }
  }

  public add(file: Blob, fileName: string, deduplicate: FileStateCallback): Upload {
    const up = new Upload(file, fileName, deduplicate, this.hasher, this.sender);
    this.uploads.push(up);
    this.startProgress();
    return up;
  }

  public remove(upload: Upload) {
    const index = this.uploads.indexOf(upload);
    if (index > -1) {
      this.uploads.splice(index, 1);
      upload.abort();
    }
    this.stopProgress();
  }

  public clear() {
    for (let i = this.uploads.length; i > 0; i--) {
      this.uploads[i - 1].abort();
    }
    this.uploads = [];
    this.stopProgress();
  }

  public isDone(): Promise<'done'> {
    return Promise.all(this.uploads.map((u) => u.promise)).then(() => 'done');
  }

  private startProgress() {
    if (this.progressUpdater == null && this.uploads.length > 0) {
      this.progressUpdater = setInterval(() => {
        for (let i = 0; i < this.uploads.length; i++) {
          this.uploads[i]._updateProgress();
        }
        if (this.uploads.length > 0 && this.onProgress != null) {
          this.onProgress();
        }
      }, 1000);
    }
  }

  private stopProgress() {
    if (this.progressUpdater != null && (this.uploads.length === 0 || this._paused)) {
      clearInterval(this.progressUpdater);
      this.progressUpdater = null;
    }
  }
}
