export interface FileNode {
  id: string;
  type: 'file';
  name: string;
  size: number;
  creationDate: number;
  lastUpdateDate: number;
  mimeType: string;

  // Create the correct urls !
  url: string;
  icon: string;
  square: string;
  original: string;
  poster: string;

  //
  // parentId: string;
  // ancestors: string[];
  // ownerId: number;
  //
  // fid: string;
  // fkey: string;
}
