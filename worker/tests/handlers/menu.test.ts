import { describe, it, expect } from 'vitest';
import { buildAdminButtons, buildUserButtons } from '../../src/handlers/menu';

describe('buildAdminButtons', () => {
  it('returns only admin actions', () => {
    const buttons = buildAdminButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).toContain('✅ Resultado');
    expect(labels).toContain('🎟 Invitar');
    expect(labels).toContain('➕ Partido');
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

describe('buildUserButtons', () => {
  it('returns only user-facing actions', () => {
    const buttons = buildUserButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).toContain('🔮 Predecir');
    expect(labels).toContain('📊 Ranking');
    expect(labels).toContain('📅 Partidos');
    expect(labels).toContain('❓ Pregunta');
    expect(labels).toContain('🌐 Sitio');
  });

  it('does not include admin actions', () => {
    const buttons = buildUserButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).not.toContain('✅ Resultado');
    expect(labels).not.toContain('🎟 Invitar');
    expect(labels).not.toContain('➕ Partido');
    expect(labels).not.toContain('🏆 Crear polla');
  });
});
