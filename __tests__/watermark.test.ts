import { watermarkMetrics, watermarkText } from '../src/lib/watermark';

describe('watermark text', () => {
  it('matches the WhatsApp caption words', () => {
    expect(watermarkText('123456', 'front')).toBe('123456 Front');
    expect(watermarkText(' 123456 ', 'driver_side')).toBe('123456 Driver side');
    expect(watermarkText('9', 'under_vehicle')).toBe('9 Under vehicle');
  });
  it('still says the angle when the lot is missing', () => {
    expect(watermarkText(undefined, 'top')).toBe('Top');
  });
});

describe('watermark size', () => {
  it('is 3% of the longest edge (48 px at 1600), same for portrait and landscape', () => {
    expect(watermarkMetrics(1600, 1200).fontSize).toBe(48);
    expect(watermarkMetrics(1200, 1600).fontSize).toBe(48);
  });
  it('scales padding and inset with the font and never goes unreadably small', () => {
    const m = watermarkMetrics(1600, 1200);
    expect(m).toEqual({ fontSize: 48, paddingX: 19, paddingY: 12, inset: 29 });
    expect(watermarkMetrics(100, 100).fontSize).toBe(14);
  });
});
