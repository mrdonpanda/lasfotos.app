const fs = require('fs');
const path = require('path');

// Reads a client-safe value from the process env, then from .env.
// Only the URL and the publishable/anon key ever reach the app; the secret key never does.
function envValue(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  try {
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const values = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    for (const name of names) {
      if (values[name]) return values[name];
    }
  } catch {
    // no .env file
  }
  return '';
}

module.exports = {
  name: 'LasFotos',
  slug: 'lasfotos',
  scheme: 'lasfotos',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  plugins: [
    'expo-router',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 240,
        backgroundColor: '#000000',
        resizeMode: 'contain',
      },
    ],
    '@react-native-community/datetimepicker',
    [
      'expo-camera',
      {
        cameraPermission: 'LasFotos uses the camera to photograph cars on the lot.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: 'LasFotos keeps a copy of each lot photo in the LasFotos album.',
        savePhotosPermission: 'LasFotos keeps a copy of each lot photo in the LasFotos album.',
        isAccessMediaLocationEnabled: false,
        granularPermissions: ['photo'],
      },
    ],
  ],
  experiments: { typedRoutes: false },
  android: {
    package: 'app.lasfotos.mobile',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#000000' },
    permissions: ['android.permission.CAMERA'],
  },
  web: { bundler: 'metro', favicon: './assets/favicon.png' },
  extra: {
    supabaseUrl: envValue('EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
    supabasePublishableKey: envValue(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_ANON_KEY',
    ),
    eas: {
      projectId: '8b8b1a18-309d-46d3-9a61-1389bd9cdd52',
    },
  },
};
