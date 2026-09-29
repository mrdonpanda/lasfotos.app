/**
 * While the lot camera hides the native volume UI, volume keys must take a
 * photo and leave the ringer alone. The stock listener still calls
 * adjustStreamVolume, so the shutter only notices a press when the level
 * actually changes.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(
  root,
  'node_modules',
  'react-native-volume-manager',
  'android',
  'src',
  'main',
  'java',
  'com',
  'reactnativevolumemanager',
  'VolumeManagerModule.java',
);
const marker = 'tripTrackerShutterKeys';

if (!fs.existsSync(file)) {
  console.log('react-native-volume-manager is not installed; skip shutter patch');
  process.exit(0);
}

let text = fs.readFileSync(file, 'utf8');
if (text.includes(marker)) {
  console.log('volume shutter patch already applied');
  process.exit(0);
}

const importAnchor = 'import android.view.ViewTreeObserver;\n';
if (!text.includes(importAnchor)) throw new Error('import anchor missing');
text = text.replace(
  importAnchor,
  `${importAnchor}import android.view.Window;\nimport java.lang.reflect.Method;\n`,
);

const fieldAnchor = '  private Boolean volumeMonitoringEnabled = false; // Tracks if volume monitoring is enabled\n';
if (!text.includes(fieldAnchor)) throw new Error('field anchor missing');
text = text.replace(
  fieldAnchor,
  `${fieldAnchor}
  // ${marker}
  private Object shutterCallback;
  private Window hookedWindow;
  private Window.Callback originalWindowCallback;
  private int shutterSetupAttempts = 0;
  private int shutterGeneration = 0;
  private long lastHardwareVolumeAt = 0;
`,
);

const setupAnchor = `  private void setupKeyListener() {
    runOnUiThread(() -> {
      if (showNativeVolumeUI) return;
      if (hardwareButtonListenerRegistered) return;

      View contentView = getContentView();
      if (contentView == null) return;

      // Handles focus changes between TextInputs and other views
      // Restores volume key functionality when leaving TextInput
      globalFocusListener = new ViewTreeObserver.OnGlobalFocusChangeListener() {
        @Override
        public void onGlobalFocusChanged(View oldFocus, View newFocus) {
          if (oldFocus instanceof EditText && !(newFocus instanceof EditText)) {
            safelyRequestFocus(contentView);
          }
        }
      };

      contentView.getViewTreeObserver().addOnGlobalFocusChangeListener(globalFocusListener);
      contentView.setOnKeyListener(null);  // Clear any existing listeners
      contentView.setFocusableInTouchMode(true);
      safelyRequestFocus(contentView);

      // Handle volume key events when native UI is hidden
      contentView.setOnKeyListener((v, keyCode, event) -> {
        if (showNativeVolumeUI) return false;

        switch (event.getKeyCode()) {
          case KeyEvent.KEYCODE_VOLUME_UP:
            am.adjustStreamVolume(
              AudioManager.STREAM_MUSIC,
              AudioManager.ADJUST_RAISE,
              AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE
            );
            return true;
          case KeyEvent.KEYCODE_VOLUME_DOWN:
            am.adjustStreamVolume(
              AudioManager.STREAM_MUSIC,
              AudioManager.ADJUST_LOWER,
              AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE
            );
            return true;
          default:
            return false;
        }
      });
      hardwareButtonListenerRegistered = true;
    });
  }
`;

const setupNext = `  private void setupKeyListener() {
    final int generation = shutterGeneration;
    runOnUiThread(() -> {
      if (generation != shutterGeneration || showNativeVolumeUI) return;
      if (shutterSetupAttempts == 0) lastHardwareVolumeAt = 0;
      installWindowShutter();
      installContentKeyListener();
      scheduleShutterRetry();
    });
  }

  private void scheduleShutterRetry() {
    if (showNativeVolumeUI || shutterSetupAttempts >= 3) return;
    shutterSetupAttempts += 1;
    final int generation = shutterGeneration;
    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
      if (generation != shutterGeneration || showNativeVolumeUI) return;
      setupKeyListener();
    }, 250);
  }

  private void installContentKeyListener() {
    View contentView = getContentView();
    if (contentView == null) return;
    contentView.setOnKeyListener(null);
    contentView.setFocusableInTouchMode(true);
    safelyRequestFocus(contentView);
    contentView.setOnKeyListener((v, keyCode, event) -> consumeVolumeKey(event));
    hardwareButtonListenerRegistered = true;
  }

  private boolean consumeVolumeKey(KeyEvent event) {
    if (showNativeVolumeUI) return false;
    int code = event.getKeyCode();
    if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) return false;
    if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
      emitHardwareVolume(code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down");
    }
    return true;
  }

  private void emitHardwareVolume(String direction) {
    long now = android.os.SystemClock.uptimeMillis();
    if (now - lastHardwareVolumeAt < 300) return;
    lastHardwareVolumeAt = now;
    WritableMap para = Arguments.createMap();
    para.putString("direction", direction);
    try {
      mContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit("RNVMEventHardwareVolume", para);
    } catch (RuntimeException e) {
      // The JS runtime may not be ready yet.
    }
  }

  private Window resolveKeyWindow(Activity activity) {
    return activity.getWindow();
  }

  private void installWindowShutter() {
    Activity activity = mContext.getCurrentActivity();
    if (activity == null) return;
    Window window = resolveKeyWindow(activity);
    if (window == null) return;
    if (hookedWindow == window && shutterCallback != null && window.getCallback() == shutterCallback) return;
    removeWindowShutter();
    final Window.Callback current = window.getCallback();
    if (current == null) return;
    originalWindowCallback = current;
    hookedWindow = window;
    shutterCallback = java.lang.reflect.Proxy.newProxyInstance(
      Window.Callback.class.getClassLoader(),
      new Class<?>[] { Window.Callback.class },
      (proxy, method, args) -> handleWindowCallback(method, args)
    );
    window.setCallback((Window.Callback) shutterCallback);
    hardwareButtonListenerRegistered = true;
  }

  private Object handleWindowCallback(Method method, Object[] args) throws Throwable {
    if ("dispatchKeyEvent".equals(method.getName()) && args != null && args.length == 1 && args[0] instanceof KeyEvent) {
      if (consumeVolumeKey((KeyEvent) args[0])) return Boolean.TRUE;
    }
    try {
      if (args == null || args.length == 0) return method.invoke(originalWindowCallback);
      return method.invoke(originalWindowCallback, args);
    } catch (java.lang.reflect.InvocationTargetException e) {
      Throwable cause = e.getCause();
      if (cause instanceof RuntimeException) throw (RuntimeException) cause;
      if (cause instanceof Error) throw (Error) cause;
      throw e;
    }
  }

  private void removeWindowShutter() {
    if (hookedWindow != null && shutterCallback != null && hookedWindow.getCallback() == shutterCallback && originalWindowCallback != null) {
      hookedWindow.setCallback(originalWindowCallback);
    }
    hookedWindow = null;
    shutterCallback = null;
    originalWindowCallback = null;
  }
`;

if (!text.includes(setupAnchor)) throw new Error('setupKeyListener anchor missing');
text = text.replace(setupAnchor, setupNext);

const cleanupAnchor = `  private void cleanupKeyListener() {
    runOnUiThread(() -> {
      if (!hardwareButtonListenerRegistered) return;
`;
const cleanupNext = `  private void cleanupKeyListener() {
    shutterGeneration += 1;
    runOnUiThread(() -> {
      removeWindowShutter();
      if (!hardwareButtonListenerRegistered && globalFocusListener == null) {
        View contentView = getContentView();
        if (contentView != null) contentView.setOnKeyListener(null);
        return;
      }
`;
if (!text.includes(cleanupAnchor)) throw new Error('cleanupKeyListener anchor missing');
text = text.replace(cleanupAnchor, cleanupNext);

const showAnchor = `  public void showNativeVolumeUI(ReadableMap config) {
    showNativeVolumeUI = config.getBoolean("enabled");
    if (showNativeVolumeUI) {
      cleanupKeyListener();
    } else {
      setupKeyListener();
    }
  }
`;
const showNext = `  public void showNativeVolumeUI(ReadableMap config) {
    showNativeVolumeUI = config.getBoolean("enabled");
    if (showNativeVolumeUI) {
      shutterSetupAttempts = 99;
      cleanupKeyListener();
    } else {
      shutterSetupAttempts = 0;
      setupKeyListener();
    }
  }
`;
if (!text.includes(showAnchor)) throw new Error('showNativeVolumeUI anchor missing');
text = text.replace(showAnchor, showNext);

const resumeAnchor = `    if (!showNativeVolumeUI) {
      hardwareButtonListenerRegistered = false;  // Force re-setup of listeners
`;
const resumeNext = `    if (!showNativeVolumeUI) {
      shutterSetupAttempts = 0;
      hardwareButtonListenerRegistered = false;  // Force re-setup of listeners
`;
if (!text.includes(resumeAnchor)) throw new Error('onHostResume anchor missing');
text = text.replace(resumeAnchor, resumeNext);

if (text.includes('adjustStreamVolume')) throw new Error('volume keys still adjust the stream');
fs.writeFileSync(file, text);
console.log('volume shutter patch applied');
