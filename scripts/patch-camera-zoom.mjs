/**
 * Keeps the lot camera on the widest zoom ratio after the ultrawide patch.
 * Expo Camera otherwise writes zoom 0 as 1x when CameraX has not published
 * its zoom range yet, so a logical back camera never reaches 0.5x.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cameraRoot = path.join(root, 'node_modules', 'expo-camera');
const hold = 'tripTrackerZoomHold';
const rangeMarker = 'tripTrackerZoomRange';

function read(rel) {
  const file = path.join(cameraRoot, rel);
  if (!fs.existsSync(file)) throw new Error(`expo-camera file missing: ${rel}`);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function upgradeView() {
  const rel = 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt';
  const { file, text } = read(rel);
  if (text.includes(hold)) return;
  let next = text.replace(
    `  // tripTrackerUltrawide: zoom 0 maps to minZoomRatio (ultrawide on logical cameras).
  var useWidestZoom: Boolean = false
    set(value) {
      field = value
      setCameraZoom(zoom)
    }
`,
    `  // tripTrackerUltrawide: zoom 0 maps to minZoomRatio (ultrawide on logical cameras).
  var useWidestZoom: Boolean = false
    set(value) {
      field = value
      setCameraZoom(zoom)
    }

  // ${hold}
  private var widestAttempts: Int = 0
  private var widestAttemptAt: Long = 0L
  private var zoomStateObserver: androidx.lifecycle.Observer<androidx.camera.core.ZoomState>? = null
  private var observedZoomInfo: CameraInfo? = null
`,
  );
  if (next === text) throw new Error('useWidestZoom anchor missing');

  const zoomAndSelector = `  private fun setCameraZoom(value: Float) {
    val state = camera?.cameraInfo?.zoomState?.value
    val clamped = value.coerceIn(0f, 1f)
    if (useWidestZoom && state != null) {
      val minRatio = state.minZoomRatio
      val maxRatio = state.maxZoomRatio
      val target = minRatio + (maxRatio - minRatio) * clamped
      if (abs(state.zoomRatio - target) < 0.02f) {
        return
      }
      camera?.cameraControl?.setZoomRatio(target)
      return
    }
    val maxZoomRatio = state?.maxZoomRatio ?: 1f
    val targetZoomRatio = max(1f, min(maxZoomRatio, clamped * maxZoomRatio))
    camera?.cameraControl?.setZoomRatio(targetZoomRatio)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun buildCameraSelector(): CameraSelector {
    val requestedId = cameraId
    if (requestedId.isNullOrEmpty()) {
      return CameraSelector.Builder()
        .requireLensFacing(lensFacing.mapToCharacteristic())
        .build()
    }
    val facing = lensFacing.mapToCharacteristic()
    return CameraSelector.Builder()
      .addCameraFilter { cameras ->
        val matched = cameras.filter { info ->
          Camera2CameraInfo.from(info).cameraId == requestedId
        }
        if (matched.isNotEmpty()) {
          matched
        } else {
          val sameFacing = cameras.filter { info ->
            Camera2CameraInfo.from(info)
              .getCameraCharacteristic(CameraCharacteristics.LENS_FACING) == facing
          }
          if (sameFacing.isNotEmpty()) sameFacing else cameras
        }
      }
      .build()
  }

  private fun observeCameraState(cameraInfo: CameraInfo) {
    cameraInfo.cameraState.observe(currentActivity) {
      when (it.type) {
        CameraState.Type.OPEN -> {
          onCameraReady(Unit)
          setTorchEnabled(enableTorch)
          setCameraZoom(zoom)
        }

        else -> {}
      }
    }
  }
`;

  const zoomAndSelectorNext = `  private fun setCameraZoom(value: Float) {
    if (useWidestZoom) {
      forceWidestZoom()
      return
    }
    val state = camera?.cameraInfo?.zoomState?.value
    val maxZoomRatio = state?.maxZoomRatio ?: 1f
    val clamped = value.coerceIn(0f, 1f)
    val targetZoomRatio = max(1f, min(maxZoomRatio, clamped * maxZoomRatio))
    camera?.cameraControl?.setZoomRatio(targetZoomRatio)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun forceWidestZoom() {
    val cam = camera ?: return
    val state = cam.cameraInfo.zoomState.value
    val characteristicMin = widestCharacteristicRatio(cam)
    val stateMin = state?.minZoomRatio
    val target = when {
      characteristicMin != null && stateMin != null -> min(characteristicMin, stateMin)
      characteristicMin != null -> characteristicMin
      stateMin != null -> stateMin
      else -> null
    }
    val current = state?.zoomRatio
    if (target != null && current != null && abs(current - target) < 0.02f) {
      widestAttempts = 0
      return
    }
    val now = android.os.SystemClock.uptimeMillis()
    if (now - widestAttemptAt < 200L) return
    if (widestAttempts >= 8) return
    widestAttemptAt = now
    widestAttempts += 1
    val stateMax = state?.maxZoomRatio
    if (target != null && stateMin != null && stateMax != null && target >= stateMin - 0.001f && target <= stateMax + 0.001f) {
      cam.cameraControl.setZoomRatio(target)
      return
    }
    if (characteristicMin != null && characteristicMin < 0.99f) {
      pushZoomRatio(cam, characteristicMin)
      return
    }
    cam.cameraControl.setLinearZoom(0f)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun widestCharacteristicRatio(cam: Camera): Float? {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return null
    return Camera2CameraInfo.from(cam.cameraInfo)
      .getCameraCharacteristic(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
      ?.lower
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun pushZoomRatio(cam: Camera, target: Float) {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return
    try {
      val options = androidx.camera.camera2.interop.CaptureRequestOptions.Builder()
        .setCaptureRequestOption(android.hardware.camera2.CaptureRequest.CONTROL_ZOOM_RATIO, target)
        .build()
      androidx.camera.camera2.interop.Camera2CameraControl.from(cam.cameraControl).setCaptureRequestOptions(options)
    } catch (e: Exception) {
      Log.w(CameraViewModule.TAG, "Could not set the ultrawide zoom ratio", e)
    }
  }

  private fun observeZoomState(cameraInfo: CameraInfo) {
    zoomStateObserver?.let { observer ->
      observedZoomInfo?.zoomState?.removeObserver(observer)
    }
    val observer = androidx.lifecycle.Observer<androidx.camera.core.ZoomState> {
      if (useWidestZoom) forceWidestZoom()
    }
    zoomStateObserver = observer
    observedZoomInfo = cameraInfo
    cameraInfo.zoomState.observe(currentActivity, observer)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun widestCamera(cameras: List<CameraInfo>): CameraInfo {
    return cameras.minByOrNull { info ->
      val range = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        Camera2CameraInfo.from(info).getCameraCharacteristic(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.lower
      } else {
        null
      }
      val zoomMin = info.zoomState.value?.minZoomRatio
      when {
        range != null && zoomMin != null -> min(range, zoomMin)
        range != null -> range
        zoomMin != null -> zoomMin
        else -> Float.MAX_VALUE
      }
    } ?: cameras.first()
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun buildCameraSelector(): CameraSelector {
    val requestedId = cameraId
    if (requestedId.isNullOrEmpty()) {
      return CameraSelector.Builder()
        .requireLensFacing(lensFacing.mapToCharacteristic())
        .build()
    }
    val facing = lensFacing.mapToCharacteristic()
    return CameraSelector.Builder()
      .addCameraFilter { cameras ->
        val matched = cameras.filter { info ->
          Camera2CameraInfo.from(info).cameraId == requestedId
        }
        if (matched.isNotEmpty()) {
          matched
        } else {
          val sameFacing = cameras.filter { info ->
            Camera2CameraInfo.from(info)
              .getCameraCharacteristic(CameraCharacteristics.LENS_FACING) == facing
          }
          val pool = if (sameFacing.isNotEmpty()) sameFacing else cameras
          if (pool.isEmpty()) pool else listOf(widestCamera(pool))
        }
      }
      .build()
  }

  private fun observeCameraState(cameraInfo: CameraInfo) {
    cameraInfo.cameraState.observe(currentActivity) {
      when (it.type) {
        CameraState.Type.OPEN -> {
          onCameraReady(Unit)
          setTorchEnabled(enableTorch)
          observeZoomState(cameraInfo)
          setCameraZoom(zoom)
        }

        else -> {}
      }
    }
  }
`;
  if (!next.includes(zoomAndSelector)) throw new Error('setCameraZoom anchor missing');
  next = next.replace(zoomAndSelector, zoomAndSelectorNext);

  const bind = `    camera?.let {
      observeCameraState(it.cameraInfo)
    }
`;
  const bindNext = `    camera?.let {
      observeCameraState(it.cameraInfo)
      observeZoomState(it.cameraInfo)
    }
`;
  if (!next.includes(bind)) throw new Error('camera bind anchor missing');
  next = next.replace(bind, bindNext);

  const openCamera = `  private suspend fun configureAndBindCamera() {
    val cameraProvider = ProcessCameraProvider.awaitInstance(context)
`;
  const openCameraNext = `  private suspend fun configureAndBindCamera() {
    widestAttempts = 0
    val cameraProvider = ProcessCameraProvider.awaitInstance(context)
`;
  if (!next.includes(openCamera)) throw new Error('configureAndBindCamera anchor missing');
  next = next.replace(openCamera, openCameraNext);
  fs.writeFileSync(file, next);
}

function upgradeDeviceList() {
  const rel = 'android/src/main/java/expo/modules/camera/CameraViewModule.kt';
  const { file, text } = read(rel);
  if (text.includes(rangeMarker)) return;
  const oldZoom = `      val zoom = info.zoomState.value
      Raw(
        id = cam2.cameraId,
        position = position,
        minFocal = focals.minOrNull() ?: 0f,
        focals = focals,
        minZoom = zoom?.minZoomRatio,
        maxZoom = zoom?.maxZoomRatio,
      )
`;
  const newZoom = `      val zoom = info.zoomState.value
      // ${rangeMarker}: Camera2 reports 0.5x before CameraX zoom state is live.
      val rangeMin = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        cam2.getCameraCharacteristic(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.lower
      } else {
        null
      }
      val stateMin = zoom?.minZoomRatio
      val resolvedMin = if (stateMin != null && rangeMin != null) {
        if (stateMin < rangeMin) stateMin else rangeMin
      } else {
        stateMin ?: rangeMin
      }
      Raw(
        id = cam2.cameraId,
        position = position,
        minFocal = focals.minOrNull() ?: 0f,
        focals = focals,
        minZoom = resolvedMin,
        maxZoom = zoom?.maxZoomRatio,
      )
`;
  if (!text.includes(oldZoom)) throw new Error('camera device zoom anchor missing');
  fs.writeFileSync(file, text.replace(oldZoom, newZoom));
}

if (!fs.existsSync(cameraRoot)) {
  console.log('expo-camera is not installed; skip zoom patch');
  process.exit(0);
}

upgradeView();
upgradeDeviceList();
console.log('expo-camera widest zoom patch applied');
