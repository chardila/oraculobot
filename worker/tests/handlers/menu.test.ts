import { describe, it, expect } from 'vitest';
import { buildAdminButtons } from '../../src/handlers/menu';

describe('buildAdminButtons', () => {
  it('returns only admin actions', () => {
    const buttons = buildAdminButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).toContain('✅ Resultado');
    expect(labels).toContain('🎟 Invitar');
    expect(labels).toContain('🏆 Crear polla');
  });

  it('does not include user-facing actions', () => {
    const buttons = buildAdminButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).not.toContain('🔮 Predecir');
    expect(labels).not.toContain('📊 Ranking');
    expect(labels).not.toContain('📅 Partidos');
    expect(labels).not.toContain('❓ Pregunta');
    expect(labels).not.toContain('🌐 Sitio');
  });
});
