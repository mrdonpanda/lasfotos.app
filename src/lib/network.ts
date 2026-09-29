import NetInfo from '@react-native-community/netinfo';

export class OfflineError extends Error {
  constructor() {
    super('Connect to the internet to do this');
    this.name = 'OfflineError';
  }
}

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export async function requireOnline(): Promise<void> {
  if (!(await isOnline())) throw new OfflineError();
}
