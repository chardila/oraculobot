import { describe, it, expect } from 'vitest';

const MAX_QUESTION_LENGTH = 500;

function validateQuestion(q: string): string | null {
  if (!q.trim()) return 'La pregunta no puede estar vacía';
  if (q.length > MAX_QUESTION_LENGTH) return `La pregunta no puede superar ${MAX_QUESTION_LENGTH} caracteres`;
  return null;
}

describe('question validation', () => {
  it('rejects empty question', () => {
    expect(validateQuestion('   ')).not.toBeNull();
  });

  it('rejects question over 500 chars', () => {
    expect(validateQuestion('a'.repeat(501))).not.toBeNull();
  });

  it('accepts question at exactly 500 chars', () => {
    expect(validateQuestion('a'.repeat(500))).toBeNull();
  });

  it('accepts normal question', () => {
    expect(validateQuestion('¿Quién va ganando?')).toBeNull();
  });
});
