// The start checks of `npm start` (src/server/main.ts): the password is needed only when the config asks for it (spec §3.11).

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/config.ts';
import { startProblem } from '../../../src/server/main.ts';

describe('startProblem', () => {
  it('starts with no password set while none is asked, and wants one only with requirePassword on', () => {
    expect(startProblem({ ...DEFAULT_CONFIG }, 'c.json')).toBeNull();
    expect(startProblem({ ...DEFAULT_CONFIG, requirePassword: true }, 'c.json')).toBe('Set a password first: npm run set-password');
    expect(startProblem({ ...DEFAULT_CONFIG, requirePassword: true, passwordHash: 'scrypt$x' }, 'c.json'))
      .toBe('c.json: sessionSecret must be a non-empty string; remove it and run npm run set-password');
    expect(startProblem({ ...DEFAULT_CONFIG, requirePassword: true, passwordHash: 'scrypt$x', sessionSecret: 'ab' }, 'c.json')).toBeNull();
    expect(startProblem({ ...DEFAULT_CONFIG, port: 70_000 }, 'c.json')).toBe('c.json: port must be a whole number from 0 to 65535');
  });
});
