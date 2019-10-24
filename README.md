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
      deduplicate: (sha1: string, filename: string): Promise<FileState> => {
        return new Promise<FileState>(resolve => {

          // Here you should ask for an upload url to your backend
          // You should return something like that :
          resolve({
            uploadUrl: 'https://cloud39.giga.gg/upload/?s=5b4de972e6717000093a8c72&n=3iBVzCEwy7tNvB12eaFiYN0lfX0tCCptXo1v11nQ1r0%3D',
            state: 'to_upload',
          });
        });
      },

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
    this.uploader.add(file, file.name).promise.then((filenode: FileNode|null) => {
      console.log('success', filenode);
    }, err => {
      console.log(err);
    });
  }
}

```
