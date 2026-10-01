import { watermark } from '../../theme';
import { angleLabel, type Angle } from './angles';

/** The stamped text, the same words as the WhatsApp caption: "123456 Front", "123456 Driver side". */
export function watermarkText(lotNumber: string | undefined, angle: Angle): string {
  return `${(lotNumber ?? '').trim()} ${angleLabel(angle)}`.trim();
}

/** Sizes in output pixels, proportional to the photo so the stamp looks the same on every photo. */
export function watermarkMetrics(width: number, height: number) {
  const fontSize = Math.max(14, Math.round(Math.max(width, height) * watermark.fontScale));
  return {
    fontSize,
    paddingX: Math.round(fontSize * watermark.boxPaddingXScale),
    paddingY: Math.round(fontSize * watermark.boxPaddingYScale),
    inset: Math.round(fontSize * watermark.insetScale),
  };
}
