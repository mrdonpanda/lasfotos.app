import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCAL_COPY_KEY = 'lasfotos-local-copy';

/** Whether each photo is also copied to the LasFotos album (visible in Files). Default on. */
export async function getLocalCopyEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(LOCAL_COPY_KEY)) !== 'off';
}

export async function setLocalCopyEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(LOCAL_COPY_KEY, enabled ? 'on' : 'off');
}
