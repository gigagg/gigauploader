## gigauploader

GigaUploader is an uploader library, to upload directly into your https://giga.gg space.

## Installation

Using npm:

```sh
$ npm i --save gigauploader

# WARNING :
# gigaUploader uses webworker so you have to make the rusha.worker.js available
# in your project. For example, you can copy it in your assets folder.

```


## Usage


```typescrypt


import { Component } from '@angular/core';
import { Uploader, FileState, Upload, FileNode } from 'gigauploader';

@Component({
  selector: 'app-root',
  template: `
  <h1>Uploader demo</h1>
  <h2>Select a file</h2>
  <div><input id="input-file"
    type="file"
    multiple
    (change)="fileChangeEvent($event)" /></div>

  <h2>Uploads</h2>
  <div>
    <table>
        <tr *ngFor="let up of uploads" >
          <td>{{ up.state }}</td>
          <td>{{ up.progress.percent | number:"1.1-1" }}%</td>
          <td>{{ (up.progress.speed * 1000) / (1024) | number:"1.1-1" }} KB/s</td>
          <td>{{ up.fileSize }}</td>
          <td>{{ up.fileName }}</td>
        </tr>
    </table>
  </div>
  `,
})
export class AppComponent {

  private uploader: Uploader;

  public constructor() {
    this.uploader = new Uploader({
      // Make sure the rusha.worker.js is available at that url
      workerUrl: '/assets/rusha.worker.js',
    });
  }

  public get uploads(): Upload[] {
    return this.uploader.uploads;
  }

  public fileChangeEvent(event: any): void {
    for (let i = 0; i < event.srcElement.files.length; i++) {
      this.addUpload(event.srcElement.files[i]);
    }
  }

  public addUpload(file: File) {
    const upload = this.uploader.add(
      file,
      file.name,
      (sha1: string, fileName: string): Promise<FileState> => {

        //
        // Make the http request to the backend / GiGa
        //

        return this.http.post(/* example: /rest/node */).toPromise()
      }
    );
    const promise = upload.promise.then((filenode: FileNode | null) => {
      if (filenode != null) {
        // the file has been uploaded. Update your state here.
      }
      this.uploader.remove(upload);
      return null;
    });
    return from(promise);
  }


  public abort(up: Upload) {
    this.uploader.remove(up);
  }
}

```
