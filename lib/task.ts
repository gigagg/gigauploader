
export class Task<T> {
  private promise: Promise<T>

  public _progress: ((done: number) => void) = () => { };
  public _resolve: ((value: T) => void) = () => { };
  public _reject: ((value: any) => void) = () => { };

  public constructor(
    public readonly file: Blob,
    public readonly id: number | string,
  ) {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }


  public tap(fct: ((done: number) => void)): Promise<T> {
    this._progress = fct;
    return this.promise;
  }
}
