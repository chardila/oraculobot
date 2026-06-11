import { describe, it, expect } from 'vitest';
import { layout, generateIndex, generatePartidos, generateStats } from './generate';

const baseMatch = {
  id: '1', home_team: 'Colombia', away_team: 'Brasil',
  kickoff_at: '2026-06-15T20:00:00Z', phase: 'grupos',
  group_name: 'A', home_score: null, away_score: null, status: 'scheduled',
  ground: 'Atlanta', name: 'Mercedes-Benz Stadium', city: 'Atlanta', country: '🇺🇸',
};

const baseFinishedMatch = {
  ...baseMatch,
  status: 'finished' as const,
  home_score: 2,
  away_score: 1,
};

describe('generate', () => {
  it('layout returns an HTML string containing the title', () => {
    const html = layout('Test Title', '<p>body</p>');
    expect(html).toContain('Test Title');
    expect(html).toContain('<p>body</p>');
  });

  it('generateIndex returns a dynamic shell with JS snippet', () => {
    const html = generateIndex();
    expect(html).toContain('ranking-container');
    expect(html).toContain('/api/ranking');
    expect(html).toContain('getSession');
    expect(html).toContain('jugar.html');
  });

  it('generatePartidos returns HTML with match data', () => {
    const html = generatePartidos([baseMatch]);
    expect(html).toContain('Colombia');
    expect(html).toContain('Brasil');
  });

  it('generatePartidos shows venue info', () => {
    const html = generatePartidos([baseMatch]);
    expect(html).toContain('Mercedes-Benz Stadium');
    expect(html).toContain('Atlanta');
  });

  it('generatePartidos groups by phase', () => {
    const matches = [
      { ...baseMatch, phase: 'grupos', group_name: 'B' },
      { ...baseMatch, phase: 'final', group_name: null, id: '2', home_team: 'X', away_team: 'Y' },
    ];
    const html = generatePartidos(matches);
    expect(html).toContain('Fase de Grupos');
    expect(html).toContain('Gran Final');
  });

  it('generatePartidos shows group labels for group stage', () => {
    const html = generatePartidos([baseMatch]);
    expect(html).toContain('Grupo A');
  });

  it('generateStats returns HTML with stats data', () => {
    const html = generateStats(
      [{ user_id: '1', username: 'Alice', total_points: 10, telegram_id: null }],
      [
        { points: 5, user_id: '1', match_id: '1' },
        { points: 3, user_id: '1', match_id: '2' },
        { points: 0, user_id: '1', match_id: '3' },
      ],
      []
    );
    expect(html).toContain('kpi-grid');
    expect(html).toContain('Estadísticas');
  });

  it('generateStats KPI: muestra partidos jugados y porcentajes', () => {
    // 10 predicciones resueltas: 2 exactas(5pts), 5 correctas(3-4pts), 3 ceros
    // exactos = 20%, correctos(3-4) = 50%, ceros = 30% — todos distintos
    const html = generateStats(
      [],
      [
        { points: 5, user_id: 'u1', match_id: 'm1' },
        { points: 5, user_id: 'u2', match_id: 'm1' },
        { points: 4, user_id: 'u1', match_id: 'm2' },
        { points: 4, user_id: 'u2', match_id: 'm2' },
        { points: 3, user_id: 'u1', match_id: 'm3' },
        { points: 3, user_id: 'u2', match_id: 'm3' },
        { points: 3, user_id: 'u1', match_id: 'm4' },
        { points: 0, user_id: 'u2', match_id: 'm4' },
        { points: 0, user_id: 'u1', match_id: 'm5' },
        { points: 0, user_id: 'u2', match_id: 'm5' },
      ],
      [
        { ...baseFinishedMatch, id: 'm1' },
        { ...baseFinishedMatch, id: 'm2' },
        { ...baseFinishedMatch, id: 'm3' },
        { ...baseFinishedMatch, id: 'm4' },
        { ...baseFinishedMatch, id: 'm5' },
        { ...baseMatch, id: 'm6' }, // scheduled — no debe contar
      ]
    );
    expect(html).toContain('kpi-grid');
    expect(html).toContain('5');   // 5 partidos finished
    expect(html).toContain('20%'); // 2/10 exactos
    expect(html).toContain('50%'); // 5/10 correctos (solo 3-4pts, NO incluye 5pts)
    expect(html).toContain('30%'); // 3/10 ceros
  });

  it('generateStats tabla usuario: exactos, correctos, ceros y promedio', () => {
    // Alice: 1 exacto (5pts), 1 correcto (3pts), 1 cero (0pts) → total=8, promedio=8/3=2.7
    const html = generateStats(
      [{ user_id: 'u1', username: 'Alice', total_points: 8, telegram_id: null }],
      [
        { points: 5, user_id: 'u1', match_id: 'm1' },
        { points: 3, user_id: 'u1', match_id: 'm2' },
        { points: 0, user_id: 'u1', match_id: 'm3' },
      ],
      [
        { ...baseFinishedMatch, id: 'm1' },
        { ...baseFinishedMatch, id: 'm2' },
        { ...baseFinishedMatch, id: 'm3' },
      ]
    );
    expect(html).toContain('Alice');
    expect(html).toContain('2.7'); // promedio (8/3)
    expect(html).toContain('3/3'); // participación (predicho 3 de 3 jugados)
  });

  it('generateStats tabla usuario: promedio — cuando no hay predicciones resueltas', () => {
    const html = generateStats(
      [{ user_id: 'u1', username: 'Bob', total_points: 0, telegram_id: null }],
      [],
      [{ ...baseFinishedMatch, id: 'm1' }]
    );
    expect(html).toContain('Bob');
    expect(html).toContain('—'); // promedio cuando played === 0
  });

  it('generateStats dificultad: identifica partido fácil y difícil', () => {
    // m1: 2 aciertos de 2 → 100% (fácil)
    // m2: 0 aciertos de 2 → 0%  (difícil)
    const html = generateStats(
      [],
      [
        { points: 5, user_id: 'u1', match_id: 'm1' },
        { points: 3, user_id: 'u2', match_id: 'm1' },
        { points: 0, user_id: 'u1', match_id: 'm2' },
        { points: 0, user_id: 'u2', match_id: 'm2' },
      ],
      [
        { ...baseFinishedMatch, id: 'm1', home_team: 'España', away_team: 'Alemania' },
        { ...baseFinishedMatch, id: 'm2', home_team: 'Japón', away_team: 'Senegal' },
      ]
    );
    expect(html).toContain('100%'); // España vs Alemania → fácil
    expect(html).toContain('0%');   // Japón vs Senegal → difícil
    expect(html).toContain('😎');
    expect(html).toContain('😱');
  });

  it('generateStats dificultad: no duplica filas cuando hay pocos partidos', () => {
    // Solo 1 partido con predicciones — no debe aparecer 2 veces
    const html = generateStats(
      [],
      [
        { points: 5, user_id: 'u1', match_id: 'm1' },
        { points: 0, user_id: 'u2', match_id: 'm1' },
      ],
      [{ ...baseFinishedMatch, id: 'm1', home_team: 'Chile', away_team: 'Peru' }]
    );
    // 'Chile vs Peru' should appear exactly once (not twice — once for easy, once for hard)
    const occurrences = html.match(/Chile vs Peru/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('generateStats dificultad: excluye partidos sin predicciones', () => {
    const html = generateStats(
      [],
      [],
      [{ ...baseFinishedMatch, id: 'm1', home_team: 'Colombia', away_team: 'Brasil' }]
    );
    // Sin predicciones, la tabla muestra el mensaje vacío
    expect(html).not.toContain('Colombia vs Brasil');
  });

  it('consenso: renders section heading', () => {
    const match = { ...baseFinishedMatch, id: 'm1' };
    const predictions = [
      { points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
      { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 },
    ];
    const html = generateStats([], predictions, [match]);
    expect(html).toContain('Consenso por partido');
  });

  it('generateStats evolución: embebe CDN de Chart.js y datos de usuarios', () => {
    const html = generateStats(
      [
        { user_id: 'u1', username: 'Alice', total_points: 8, telegram_id: null },
        { user_id: 'u2', username: 'Bob',   total_points: 3, telegram_id: null },
      ],
      [
        { points: 5, user_id: 'u1', match_id: 'm1' },
        { points: 3, user_id: 'u1', match_id: 'm2' },
        { points: 3, user_id: 'u2', match_id: 'm1' },
        { points: 0, user_id: 'u2', match_id: 'm2' },
      ],
      [
        { ...baseFinishedMatch, id: 'm1', kickoff_at: '2026-06-15T18:00:00Z' },
        { ...baseFinishedMatch, id: 'm2', kickoff_at: '2026-06-16T18:00:00Z' },
      ]
    );
    expect(html).toContain('cdn.jsdelivr.net/npm/chart.js');
    expect(html).toContain('<canvas');
    expect(html).toContain('"Alice"');
    expect(html).toContain('"Bob"');
    // Alice acumula: P1=5, P2=8
    expect(html).toContain('[5,8]');
    // Bob acumula: P1=3, P2=3
    expect(html).toContain('[3,3]');
  });
});

describe('layout() responsive', () => {
  it('incluye media query para móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('@media (max-width: 600px)');
  });

  it('oculta thead en móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('thead { display: none; }');
  });

  it('usa data-label en td::before', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('content: attr(data-label)');
  });
});
