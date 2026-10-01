import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { compressPhoto } from '../src/lib/compress';
import { resizeToMaxEdge } from '../src/lib/resize';

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file://compressed.jpg', width: 1600, height: 1200 })),
}));

const mockMarkText = jest.fn(async () => ({ uri: '/data/cache/stamped.jpg' }));
jest.mock('react-native-image-marker', () => ({
  __esModule: true,
  default: { markText: (...args: unknown[]) => (mockMarkText as jest.Mock)(...args) },
  ImageFormat: { jpg: 'jpg' },
  Position: { bottomRight: 'bottomRight' },
  TextBackgroundType: { none: 'fit' },
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
    await compressPhoto('file://capture.jpg', 3200, 2400, '123456 Front');
    expect(manipulateAsync).toHaveBeenCalledWith(
      'file://capture.jpg',
      [{ resize: { width: 1600, height: 1200 } }],
      expect.objectContaining({ format: SaveFormat.JPEG }),
    );
  });

  it('stamps "{lot} {Angle}" bottom right on the RESIZED image, as a q80 JPEG', async () => {
    mockMarkText.mockClear();
    const out = await compressPhoto('file://capture.jpg', 3200, 2400, '123456 Front');
    expect(mockMarkText).toHaveBeenCalledTimes(1);
    const options = (mockMarkText.mock.calls[0] as unknown[])[0] as {
      backgroundImage: { src: string };
      watermarkTexts: Array<{ text: string; position: { position: string }; style: { fontSize: number; textBackgroundStyle: { color: string } } }>;
      saveFormat: string;
      quality: number;
    };
    expect(options.backgroundImage.src).toBe('file://compressed.jpg'); // the manipulator output, not the raw capture
    expect(options.watermarkTexts[0].text).toBe('123456 Front');
    expect(options.watermarkTexts[0].position.position).toBe('bottomRight');
    expect(options.watermarkTexts[0].style.fontSize).toBe(48); // 3% of 1600
    expect(options.watermarkTexts[0].style.textBackgroundStyle.color).toBe('#000000B3');
    expect(options.saveFormat).toBe('jpg');
    expect(options.quality).toBe(80);
    expect(out.uri).toBe('file://upload-queue/photo.jpg'); // the queue gets the copy of the STAMPED file
  });

  it('fails (instead of storing an unstamped photo) when stamping fails', async () => {
    mockMarkText.mockRejectedValueOnce(new Error('native module missing'));
    await expect(compressPhoto('file://capture.jpg', 3200, 2400, '1 Top')).rejects.toThrow('native module missing');
  });
});
