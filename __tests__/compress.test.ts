import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { compressPhoto } from '../src/lib/compress';
import { resizeToMaxEdge } from '../src/lib/resize';

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file://compressed.jpg', width: 1600, height: 1200 })),
}));

jest.mock('expo-file-system', () => ({
  Directory: class {
    exists = false;
    create() {
      this.exists = true;
    }
  },
  File: class {
    uri = 'file://upload-queue/photo.jpg';
    async copy() {
      return undefined;
    }
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
    delete() {
      return undefined;
    }
  },
  Paths: { document: 'document' },
}));

describe('photo compression', () => {
  it('resizes the long edge to 1600 and saves JPEG before upload', async () => {
    expect(resizeToMaxEdge(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(resizeToMaxEdge(800, 600, 1600)).toBeNull();
    await compressPhoto('file://capture.jpg', 3200, 2400);
    expect(manipulateAsync).toHaveBeenCalledWith(
      'file://capture.jpg',
      [{ resize: { width: 1600, height: 1200 } }],
      expect.objectContaining({ format: SaveFormat.JPEG }),
    );
  });
});
