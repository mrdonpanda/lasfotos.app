import { Camera } from 'expo-camera';
import { requireNativeModule } from 'expo-modules-core';

import type { CameraDevice } from './cameraDevices';

type CameraWithDevices = typeof Camera & {
  getAvailableCameraDevicesAsync?: () => Promise<CameraDevice[]>;
};

async function loadNativeDevices(): Promise<CameraDevice[]> {
  try {
    const native = requireNativeModule<{
      getAvailableCameraDevicesAsync?: () => Promise<CameraDevice[]>;
    }>('ExpoCamera');
    if (typeof native.getAvailableCameraDevicesAsync === 'function') {
      return await native.getAvailableCameraDevicesAsync();
    }
  } catch {
    // Web and Jest have no camera device list.
  }
  return [];
}

export async function queryCameraDevices(): Promise<CameraDevice[]> {
  const camera = Camera as CameraWithDevices;
  if (typeof camera.getAvailableCameraDevicesAsync !== 'function') {
    camera.getAvailableCameraDevicesAsync = loadNativeDevices;
  }
  return camera.getAvailableCameraDevicesAsync();
}
