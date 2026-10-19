import { describe, expect, it } from 'vitest';
import { confirmationPrompt } from '../../apps/web/src/dialogue/text';

describe('confirmationPrompt', () => {
  it('wraps the proposed meaning without doubled punctuation', () => {
    expect(confirmationPrompt('我想去厕所。')).toBe('你是说：我想去厕所，对吗？');
    expect(confirmationPrompt('他拿走了我的水壶！')).toBe('你是说：他拿走了我的水壶，对吗？');
    expect(confirmationPrompt('  我想喝水  ')).toBe('你是说：我想喝水，对吗？');
    expect(confirmationPrompt('你好?')).toBe('你是说：你好，对吗？');
  });
});
