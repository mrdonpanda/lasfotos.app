jest.mock('react-native-volume-manager', () => ({
  VolumeManager: {
    showNativeVolumeUI: jest.fn(),
  },
}));

import { startVolumeShutter, type VolumeApi } from '../src/lib/volumeShutter';

describe('volume shutter', () => {
  it('takes one photo per volume press and does not change the ringer', async () => {
    const ui: boolean[] = [];
    let removed = false;
    let press: () => void = () => undefined;
    const api: VolumeApi = {
      async showNativeVolumeUI(config) {
        ui.push(config.enabled);
      },
      addHardwareVolumeListener(callback) {
        press = callback;
        return {
          remove() {
            removed = true;
          },
        };
      },
    };
    const shots: number[] = [];
    const shutter = await startVolumeShutter(() => {
      shots.push(1);
    }, api);

    expect(ui).toEqual([false]);
    press();
    press();
    expect(shots).toEqual([1]);

    shutter.stop();
    expect(removed).toBe(true);
    expect(ui).toEqual([false, true]);
  });
});
