import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { appExtra } from './config';

const extra = appExtra();

export function supabaseConfigured(): boolean {
  return Boolean(extra.supabaseUrl && extra.supabasePublishableKey);
}

export const supabase = createClient(
  extra.supabaseUrl || 'https://example.invalid',
  extra.supabasePublishableKey || 'missing-publishable-key',
  {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
