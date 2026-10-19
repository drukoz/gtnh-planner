// The one number formatter (fix spec §6.1, §7.1): rates per minute or hour that never read as 0, fluids in litres,
// shares that never round a running machine to 0% or a part to 100%, and no exponents.

import { describe, expect, it } from 'vitest';
import { formatDuration, formatNumber, formatPercent, formatRate } from '../../../src/shared/format.ts';

describe('formatRate', () => {
  it('writes a rate per hour or minute, and one under 0.01 as how often one unit comes', () => {
    expect(formatRate(0.5 / 3600, 'hour')).toBe('0.5/h');
    expect(formatRate(71.9 / 3600, 'hour', { fluid: true })).toBe('71.9 L/h');
    expect(formatRate(1440 / 3600, 'hour')).toBe('1,440/h');
    expect(formatRate(0.0625 / 3600, 'hour')).toBe('0.0625/h');
    expect(formatRate(7.92e-5 / 3600, 'hour')).toBe('1 every 526 days');
    expect(formatRate(0.003438 / 3600, 'hour', { fluid: true })).toBe('1 L every 12.1 days');
    expect(formatRate(3.1e-8, 'hour', { noun: ['run', 'runs'] })).toBe('1 run every 373 days');
    expect(formatRate(0.3 / 3600, 'min')).toBe('1 every 3.33 h');
  });
  it('writes nothing at all as 0', () => {
    expect(formatRate(0, 'hour')).toBe('0/h');
    expect(formatRate(0, 'min')).toBe('0/min');
  });
  it('never prints a positive amount as 0', () => {
    for (const v of [1e-12, 3e-9, 2.2e-8, 1e-6, 0.004]) {
      for (const per of ['min', 'hour'] as const) {
        const text = formatRate(v, per);
        expect(Number.parseFloat(text.replaceAll(',', '')), `${v}/s per ${per}: ${text}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('formatPercent', () => {
  it('never rounds a share to 0% or below 1 to 100%', () => {
    expect(formatPercent(4.4e-7)).toBe('<0.1%');
    expect(formatPercent(0.0069)).toBe('0.7%');
    expect(formatPercent(0.999)).toBe('99.9%');
    expect(formatPercent(0.9996)).toBe('>99.9%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('formatNumber and formatDuration', () => {
  it('groups large numbers and never writes an exponent or -0', () => {
    expect(formatNumber(13_050_000)).toBe('13,050,000');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1.23456e-7)).toBe('0.000000123');
  });
  it('picks the largest unit that keeps the number at least 1', () => {
    expect([40, 576, 12_600, 1_047_120, 63_072_000].map(formatDuration)).toEqual(['40 s', '9.6 min', '3.5 h', '12.1 days', '2 years']);
  });
});
