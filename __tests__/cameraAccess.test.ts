import { PermissionsAndroid, Platform } from 'react-native';

import { Camera } from 'expo-camera';

import { ensureCameraAccess } from '../src/lib/cameraAccess';

jest.mock('expo-camera', () => ({
  Camera: {
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
}));

describe('camera permission', () => {
  const previous = Platform.OS;

  beforeEach(() => {
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockClear();
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  });

  afterEach(() => {
    Platform.OS = previous;
    jest.restoreAllMocks();
  });

  it('does not allow the preview until android.permission.CAMERA is granted', async () => {
    Platform.OS = 'android';
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

    await expect(ensureCameraAccess()).resolves.toBe(false);
    expect(request).toHaveBeenCalledWith('android.permission.CAMERA');
    expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('calls Camera.requestCameraPermissionsAsync after the Android permission is granted', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

    await expect(ensureCameraAccess()).resolves.toBe(true);
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('stays closed when Camera.requestCameraPermissionsAsync is denied', async () => {
    Platform.OS = 'ios';
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    await expect(ensureCameraAccess()).resolves.toBe(false);
  });
});
