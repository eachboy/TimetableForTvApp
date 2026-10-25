import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('игры: возврат по бездействию', () => {
  it('нет нажатий 30 секунд → переход на главный экран', () => {
    const src = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(src).toMatch(/const INACTIVITY_MS = 30 \* 1000;/);
    expect(src).toMatch(/router\.push\('\/'\)/);
  });
});
