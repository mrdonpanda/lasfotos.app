import { File } from 'expo-file-system';
import Share from 'react-native-share';

import { cleanupShareFolders, isLocalUri, shareFileNames, sharePhotos } from '../src/lib/sharePhotos';

const mockCopies: Array<[string, string]> = [];
const mockDownloads: Array<[string, string]> = [];

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    name: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/').replace(/^document\/|^cache\//, 'file:///cache/');
      this.name = this.uri.split('/').pop() ?? '';
    }
    copy(dest: MockFile) {
      mockCopies.push([this.uri, dest.uri]);
    }
    static downloadFileAsync = jest.fn(async (url: string, dest: MockFile) => {
      mockDownloads.push([url, dest.uri]);
      return dest;
    });
  }
  class MockDirectory {
    uri: string;
    name: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
      this.name = this.uri.split('/').pop() ?? '';
    }
    create() {}
    delete() {}
    list() {
      return [];
    }
  }
  return { File: MockFile, Directory: MockDirectory, Paths: { cache: 'cache' } };
});
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn(async () => ({})) } }));

describe('share file names', () => {
  it('uses {lot}_{tag}.jpg and de-duplicates repeats', () => {
    expect(shareFileNames([{ lot: '123456', angle: 'front' }, { lot: '123456', angle: 'driver_side' }])).toEqual(['123456_front.jpg', '123456_driver.jpg']);
    expect(shareFileNames([{ lot: 'Car 3', angle: 'top' }, { lot: 'Car 3', angle: 'top' }])).toEqual(['Car3_top.jpg', 'Car3_top-2.jpg']);
  });
  it('tells local files from signed URLs', () => {
    expect(isLocalUri('file:///data/x.jpg')).toBe(true);
    expect(isLocalUri('https://db.lasfotos.app/storage/v1/object/sign/x')).toBe(false);
  });
});

describe('sharePhotos', () => {
  beforeEach(() => {
    mockCopies.length = 0;
    mockDownloads.length = 0;
    (Share.open as jest.Mock).mockClear();
  });

  it('copies local photos, downloads uploaded ones, then opens ONE share sheet with all of them', async () => {
    const progress: Array<[number, number]> = [];
    await sharePhotos(
      [
        { uri: 'file:///data/upload-queue/1.jpg', lot: '111', angle: 'top' },
        { uri: 'https://db.lasfotos.app/sign/abc?token=1', lot: '111', angle: 'front' },
        { uri: 'https://db.lasfotos.app/sign/def?token=2', lot: '222', angle: 'back' },
      ],
      (done, total) => progress.push([done, total]),
    );
    expect(mockCopies).toHaveLength(1);
    expect(mockCopies[0][0]).toBe('file:///data/upload-queue/1.jpg');
    expect(mockDownloads.map(([url]) => url)).toEqual(['https://db.lasfotos.app/sign/abc?token=1', 'https://db.lasfotos.app/sign/def?token=2']);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(Share.open).toHaveBeenCalledTimes(1);
    const call = (Share.open as jest.Mock).mock.calls[0][0];
    expect(call.urls).toHaveLength(3);
    expect(call.urls[0]).toMatch(/111_top\.jpg$/);
    expect(call.urls[2]).toMatch(/222_back\.jpg$/);
    expect(call.type).toBe('image/jpeg');
    expect(call.failOnCancel).toBe(false);
  });

  it('does nothing for an empty selection', async () => {
    await sharePhotos([]);
    expect(Share.open).not.toHaveBeenCalled();
  });

  it('does not open the sheet when a download fails', async () => {
    (File.downloadFileAsync as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    await expect(sharePhotos([{ uri: 'https://x/y', lot: '1', angle: 'top' }])).rejects.toThrow('network down');
    expect(Share.open).not.toHaveBeenCalled();
  });

  it('cleanup never throws', () => {
    expect(() => cleanupShareFolders()).not.toThrow();
  });
});
