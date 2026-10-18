import { describe, it, expect } from 'vitest';
import { makePng } from '../../helpers/png.ts';
import { pngSize, animationFrames } from '../../../src/server/assets/png.ts';

describe('png', () => {
  it('reads the size from IHDR', () => {
    expect(pngSize(makePng(16, 512, [255, 255, 255, 255]))).toEqual({ width: 16, height: 512 });
    expect(pngSize(makePng(32, 32, (x) => [x * 8, 0, 0, 255]))).toEqual({ width: 32, height: 32 });
    expect(pngSize(new TextEncoder().encode('definitely not a png file'))).toBeNull();
    expect(pngSize(makePng(4, 4, [0, 0, 0, 0]).subarray(0, 20))).toBeNull();
  });

  it('counts animation frames from .mcmeta', () => {
    expect(animationFrames('{"animation":{"frametime":2}}', { width: 16, height: 512 })).toBe(32);
    expect(animationFrames('{"animation":{}}', { width: 16, height: 64 })).toBe(4);
    expect(animationFrames('{"animation":{"height":8}}', { width: 16, height: 64 })).toBe(8);
    expect(animationFrames('{"animation":{"frametime":1}}', { width: 16, height: 16 })).toBe(1);
    expect(animationFrames('{"fullDrawers1":{"trimWidth":0.0625}}', { width: 16, height: 64 })).toBe(1);
    expect(animationFrames('{oops', { width: 16, height: 64 })).toBe(1);
  });
});
