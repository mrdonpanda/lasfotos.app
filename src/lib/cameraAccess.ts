import { Camera } from 'expo-camera';
import { PermissionsAndroid, Platform } from 'react-native';

export async function ensureCameraAccess(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request('android.permission.CAMERA');
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  const response = await Camera.requestCameraPermissionsAsync();
  return response.granted === true;
}
