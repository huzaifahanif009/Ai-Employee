import { stableStringify } from './audit.service';

describe('stableStringify', () => {
  it('is insensitive to object key order (mirrors Postgres jsonb)', () => {
    const a = { b: 1, a: { y: 2, x: [3, { q: 4, p: 5 }] } };
    const b = { a: { x: [3, { p: 5, q: 4 }], y: 2 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('distinguishes different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(7)).toBe('7');
  });
});
