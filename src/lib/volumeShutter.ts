import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';

type VolumeListener = { remove: () => void };

export type VolumeApi = {
  showNativeVolumeUI: (config: { enabled: boolean }) => Promise<void>;
  addHardwareVolumeListener: (callback: () => void) => VolumeListener;
};

const nativeVolumeApi: VolumeApi = {
  showNativeVolumeUI: (config) => VolumeManager.showNativeVolumeUI(config),
  addHardwareVolumeListener(callback) {
    const native = NativeModules.VolumeManager as object | undefined;
    if (!native) return { remove() {} };
    const emitter = new NativeEventEmitter(NativeModules.VolumeManager);
    const subscription = emitter.addListener('RNVMEventHardwareVolume', callback);
    return { remove: () => subscription.remove() };
  },
};

export async function startVolumeShutter(onPress: () => void, api: VolumeApi = nativeVolumeApi): Promise<{ stop: () => void }> {
  if (Platform.OS === 'web') return { stop() {} };

  await api.showNativeVolumeUI({ enabled: false });
  let lastPress = 0;
  let listener: VolumeListener;
  try {
    listener = api.addHardwareVolumeListener(() => {
      const now = Date.now();
      if (now - lastPress < 300) return;
      lastPress = now;
      onPress();
    });
  } catch (err) {
    void api.showNativeVolumeUI({ enabled: true });
    throw err;
  }

  return {
    stop() {
      listener.remove();
      void api.showNativeVolumeUI({ enabled: true });
    },
  };
}
