/**
 * Expo Camera on Android clamps zoom to 1x, so the ultrawide end of a
 * logical camera (zoom ratio below 1) is unreachable, and there is no
 * device list API. This patch adds Camera.getAvailableCameraDevicesAsync
 * and a widest-zoom path used by the lot camera.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cameraRoot = path.join(root, 'node_modules', 'expo-camera');
const marker = 'tripTrackerUltrawide';

function read(rel) {
  const file = path.join(cameraRoot, rel);
  if (!fs.existsSync(file)) {
    throw new Error(`expo-camera file missing: ${rel}`);
  }
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function writeIfChanged(file, before, after) {
  if (before === after) return;
  fs.writeFileSync(file, after);
}

function patchKotlinView() {
  const rel = 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt';
  const { file, text } = read(rel);
  if (text.includes(marker)) return;
  let next = text.replace(
    'import kotlin.math.roundToInt\n',
    'import kotlin.math.abs\nimport kotlin.math.roundToInt\n',
  );
  const zoomField = `  var zoom: Float = 0f
    set(value) {
      field = value
      setCameraZoom(value)
    }
`;
  const zoomFieldNext = `  var zoom: Float = 0f
    set(value) {
      field = value
      setCameraZoom(value)
    }

  // ${marker}: optional Camera2 id. Empty uses the default lens facing.
  var cameraId: String? = null
    set(value) {
      field = value
      shouldCreateCamera = true
    }

  // ${marker}: zoom 0 maps to minZoomRatio (ultrawide on logical cameras).
  var useWidestZoom: Boolean = false
    set(value) {
      field = value
      setCameraZoom(zoom)
    }
`;
  if (!next.includes(zoomField)) throw new Error('zoom field anchor missing');
  next = next.replace(zoomField, zoomFieldNext);

  const selector = `    val cameraSelector = CameraSelector.Builder()
      .requireLensFacing(lensFacing.mapToCharacteristic())
      .build()
`;
  const selectorNext = `    val cameraSelector = buildCameraSelector()
`;
  if (!next.includes(selector)) throw new Error('camera selector anchor missing');
  next = next.replace(selector, selectorNext);

  const zoomFn = `  private fun setCameraZoom(value: Float) {
    val maxZoomRatio = camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 1f
    val targetZoomRatio = max(1f, min(maxZoomRatio, value.coerceIn(0f, 1f) * maxZoomRatio))
    camera?.cameraControl?.setZoomRatio(targetZoomRatio)
  }
`;
  const zoomFnNext = `  private fun setCameraZoom(value: Float) {
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
`;
  if (!next.includes(zoomFn)) throw new Error('setCameraZoom anchor missing');
  next = next.replace(zoomFn, zoomFnNext);

  const open = `        CameraState.Type.OPEN -> {
          onCameraReady(Unit)
          setTorchEnabled(enableTorch)
        }
`;
  const openNext = `        CameraState.Type.OPEN -> {
          onCameraReady(Unit)
          setTorchEnabled(enableTorch)
          setCameraZoom(zoom)
        }
`;
  if (!next.includes(open)) throw new Error('camera open anchor missing');
  next = next.replace(open, openNext);
  writeIfChanged(file, text, next);
}

function patchKotlinModule() {
  const rel = 'android/src/main/java/expo/modules/camera/CameraViewModule.kt';
  const { file, text } = read(rel);
  if (text.includes(marker)) return;
  let next = text;
  const imports = `import android.util.Log
`;
  const importsNext = `import android.util.Log
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import kotlin.math.abs
`;
  if (!next.includes(imports)) throw new Error('import anchor missing');
  next = next.replace(imports, importsNext);

  const insertAt = `    Class("Picture", PictureRef::class) {`;
  const fn = `    // ${marker}
    AsyncFunction("getAvailableCameraDevicesAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(emptyList<Map<String, Any?>>())
        return@AsyncFunction
      }
      moduleScope.launch {
        try {
          promise.resolve(loadCameraDevices(context))
        } catch (e: Exception) {
          promise.reject("E_CAMERA_DEVICES", e.message ?: "Could not list cameras", e)
        }
      }
    }

    Class("Picture", PictureRef::class) {`;
  if (!next.includes(insertAt)) throw new Error('Picture class anchor missing');
  next = next.replace(insertAt, fn);

  const zoomProp = `      Prop("zoom") { view, zoom: Float? ->
        zoom?.let {
          if (view.zoom != it) {
            view.zoom = it
          }
        } ?: run {
          if (view.zoom != 0f) {
            view.zoom = 0f
          }
        }
      }
`;
  const zoomPropNext = `${zoomProp}
      Prop("cameraId") { view, id: String? ->
        val next = id?.takeIf { it.isNotEmpty() }
        if (view.cameraId != next) {
          view.cameraId = next
        }
      }

      Prop("useWidestZoom") { view, enabled: Boolean? ->
        val next = enabled ?: false
        if (view.useWidestZoom != next) {
          view.useWidestZoom = next
        }
      }
`;
  if (!next.includes(zoomProp)) throw new Error('zoom prop anchor missing');
  next = next.replace(zoomProp, zoomPropNext);

  const companion = `  companion object {
    internal val TAG = CameraViewModule::class.java.simpleName
  }
}
`;
  const companionNext = `  @OptIn(ExperimentalCamera2Interop::class)
  private suspend fun loadCameraDevices(context: Context): List<Map<String, Any?>> {
    val provider = ProcessCameraProvider.awaitInstance(context)
    data class Raw(
      val id: String,
      val position: String,
      val minFocal: Float,
      val focals: List<Float>,
      val minZoom: Float?,
      val maxZoom: Float?,
    )
    val raw = provider.availableCameraInfos.map { info ->
      val cam2 = Camera2CameraInfo.from(info)
      val facing = cam2.getCameraCharacteristic(CameraCharacteristics.LENS_FACING)
      val position = when (facing) {
        CameraCharacteristics.LENS_FACING_FRONT -> "front"
        CameraCharacteristics.LENS_FACING_BACK -> "back"
        else -> "external"
      }
      val focals = cam2.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
        ?.toList() ?: emptyList()
      val zoom = info.zoomState.value
      Raw(
        id = cam2.cameraId,
        position = position,
        minFocal = focals.minOrNull() ?: 0f,
        focals = focals,
        minZoom = zoom?.minZoomRatio,
        maxZoom = zoom?.maxZoomRatio,
      )
    }
    val back = raw.filter { it.position == "back" && it.minFocal > 0f }
    val shortest = back.minOfOrNull { it.minFocal }
    return raw.map { device ->
      val minZoom = device.minZoom
      val dedicatedUltra = device.position == "back" &&
        shortest != null &&
        back.size > 1 &&
        device.focals.size == 1 &&
        abs(device.minFocal - shortest) < 0.05f
      val zoomUltra = device.position == "back" && minZoom != null && minZoom < 0.99f
      val lensType = if (dedicatedUltra || zoomUltra) "ultrawide" else "wide"
      mapOf(
        "id" to device.id,
        "position" to device.position,
        "lensType" to lensType,
        "name" to device.id,
        "minFocalLength" to device.minFocal.toDouble(),
        "focalLengths" to device.focals.map { it.toDouble() },
        "minZoom" to (device.minZoom?.toDouble() ?: 0.0),
        "maxZoom" to (device.maxZoom?.toDouble() ?: 1.0),
      )
    }
  }

  companion object {
    internal val TAG = CameraViewModule::class.java.simpleName
  }
}
`;
  if (!next.includes(companion)) throw new Error('companion anchor missing');
  next = next.replace(companion, companionNext);
  writeIfChanged(file, text, next);
}

function patchSwiftModule() {
  const rel = 'ios/CameraViewModule.swift';
  const { file, text } = read(rel);
  if (text.includes(marker)) return;
  const anchor = `    AsyncFunction("scanFromURLAsync") { (url: URL, _: [BarcodeType], promise: Promise) in`;
  const fn = `    // ${marker}: back and front cameras, ultrawide marked from the device type.
    AsyncFunction("getAvailableCameraDevicesAsync") { () -> [[String: Any]] in
      var deviceTypes: [AVCaptureDevice.DeviceType] = [
        .builtInWideAngleCamera,
        .builtInTelephotoCamera,
        .builtInUltraWideCamera,
        .builtInTrueDepthCamera,
        .builtInTripleCamera,
        .builtInDualCamera,
        .builtInDualWideCamera,
      ]
      if #available(iOS 15.4, *) {
        deviceTypes.append(.builtInLiDARDepthCamera)
      }
      let session = AVCaptureDevice.DiscoverySession(
        deviceTypes: deviceTypes,
        mediaType: .video,
        position: .unspecified
      )
      return session.devices.map { device in
        let position: String
        switch device.position {
        case .front:
          position = "front"
        case .back:
          position = "back"
        default:
          position = "external"
        }
        let lensType = device.deviceType == .builtInUltraWideCamera ? "ultrawide" : "wide"
        return [
          "id": device.uniqueID,
          "position": position,
          "lensType": lensType,
          "name": device.localizedName,
          "deviceType": device.deviceType.rawValue,
          "minZoom": device.minAvailableVideoZoomFactor,
          "maxZoom": device.maxAvailableVideoZoomFactor,
        ]
      }
    }

    AsyncFunction("scanFromURLAsync") { (url: URL, _: [BarcodeType], promise: Promise) in`;
  if (!text.includes(anchor)) throw new Error('swift anchor missing');
  writeIfChanged(file, text, text.replace(anchor, fn));
}

if (!fs.existsSync(cameraRoot)) {
  console.log('expo-camera is not installed; skip camera patch');
  process.exit(0);
}

patchKotlinView();
patchKotlinModule();
patchSwiftModule();
console.log('expo-camera ultrawide patch applied');
