import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lasfotos-recent-locations';
const MAX = 6;

export async function getRecentLocations(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberLocation(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const next = [clean, ...(await getRecentLocations()).filter((item) => item.toLowerCase() !== clean.toLowerCase())];
  await AsyncStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX)));
}
