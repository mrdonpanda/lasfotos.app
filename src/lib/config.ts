import Constants from 'expo-constants';

type Extra = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

export function appExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}
