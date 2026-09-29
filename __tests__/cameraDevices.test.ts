import { selectWidestBackCamera, type CameraDevice } from '../src/lib/cameraDevices';

const devices: CameraDevice[] = [
  {
    id: 'wide-back',
    position: 'back',
    lensType: 'wide',
    name: 'Back Wide',
    minFocalLength: 5.4,
    focalLengths: [5.4],
    minZoom: 1,
  },
  {
    id: 'ultra-back',
    position: 'back',
    lensType: 'ultrawide',
    name: 'Back Ultra Wide Camera',
    minFocalLength: 2.2,
    focalLengths: [2.2],
    minZoom: 0.6,
  },
  {
    id: 'front',
    position: 'front',
    lensType: 'wide',
    name: 'Front',
    minFocalLength: 3,
    focalLengths: [3],
    minZoom: 1,
  },
];

describe('selectWidestBackCamera', () => {
  it('uses the back ultrawide camera and the minimum zoom', () => {
    const choice = selectWidestBackCamera(devices);
    expect(choice.deviceId).toBe('ultra-back');
    expect(choice.zoom).toBe(0);
    expect(choice.useWidestZoom).toBe(true);
    expect(choice.selectedLens).toBe('Back Ultra Wide Camera');
    expect(choice.deviceId).not.toBe('front');
  });

  it('falls back to minimum zoom when no camera list is available', () => {
    expect(selectWidestBackCamera([])).toEqual({
      deviceId: undefined,
      selectedLens: undefined,
      zoom: 0,
      useWidestZoom: true,
    });
  });

  it('uses the back camera that can zoom out to 0.5x', () => {
    const choice = selectWidestBackCamera([
      { id: 'short', position: 'back', lensType: 'wide', name: 'short', minFocalLength: 2, focalLengths: [2], minZoom: 1 },
      { id: 'logical', position: 'back', lensType: 'wide', name: 'logical', minFocalLength: 5, focalLengths: [5], minZoom: 0.5 },
    ]);
    expect(choice.deviceId).toBe('logical');
    expect(choice.zoom).toBe(0);
    expect(choice.useWidestZoom).toBe(true);
  });

  it('picks the dedicated shortest back lens when nothing is named ultrawide', () => {
    const choice = selectWidestBackCamera([
      { id: 'main', position: 'back', lensType: 'wide', name: 'main', minFocalLength: 5, focalLengths: [5, 2] },
      { id: 'short', position: 'back', lensType: 'wide', name: 'short', minFocalLength: 2, focalLengths: [2] },
    ]);
    expect(choice.deviceId).toBe('short');
    expect(choice.zoom).toBe(0);
  });
});
