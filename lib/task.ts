/** Jump tell us when we catch back on some already processed data (jump <= done) */
export type progressCallback = (done: number, jump?: number) => void;

export class Task<T> {
  private promise: Promise<T>;

  public _progress: progressCallback = () => {};
  public _resolve: (value: T) => void = () => {};
  public _reject: (value: any) => void = () => {};

  public constructor(public readonly file: Blob, public readonly id: number | string) {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  public tap(fct: progressCallback): Promise<T> {
    this._progress = fct;
    return this.promise;
  }
}
