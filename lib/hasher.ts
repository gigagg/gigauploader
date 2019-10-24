import { Task } from "./task";

export class Hasher {
  private todo: Task<string>[] = [];
  private current: Task<string> | undefined = undefined;
  private maxId = 0;
  private _paused = false;

  private worker: Worker;

  public constructor(
    private workerUrl: string
  ) {
    this.worker = new Worker(this.workerUrl);
    this.initializeWorker();
  }

  private createWorker() {
    this.worker = new Worker(this.workerUrl);
    this.initializeWorker();
  }

  private initializeWorker() {
    this.worker.addEventListener("error", data => {
      console.log(data);
      this.launchNext();
    }, false);

    this.worker.onmessage = ev => {
      const data = ev.data;
      if (data.id == null) {
        console.error('id must never be null');
        return;
      }
      const task = this.current;
      if (task == null) {
        return;
      }
      if (data.progress != null) {
        task._progress(data.progress);
      } else if (data.error != null) {
        console.log('Got Error: ', data.error);
        task._reject(data.error);
        this.current = undefined;
        this.launchNext();
      } else if (data.hash) {
        console.log('Got hash: ', data.hash);
        task._resolve(data.hash);
        this.current = undefined;
        this.launchNext();
      } else {
        console.error('Cannot understand this message !', data);
      }
    };
  }

  public hashFile(file: Blob): Task<string> {
    const task = new Task<string>(file, this.maxId++, );
    this.todo.push(task);
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

  public remove(task: Task<string>) {
    if (this.current != null && this.current === task) {
      this.worker.terminate();
      this.createWorker();
      this.current = undefined;
      this.launchNext();
    } else {
      const index = this.todo.findIndex(w => w === task);
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
      this.current = this.todo.shift();
      if (this.current != null) {
        this.worker.postMessage({ id: this.current.id, data: this.current.file });
        this.current._progress(0);
      }
    }
  }
}
