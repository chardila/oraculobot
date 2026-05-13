import { describe, it, expect } from 'vitest';
import { layout, generateIndex, generatePartidos, generateStats } from './generate';

const baseMatch = {
  id: '1', home_team: 'Colombia', away_team: 'Brasil',
  kickoff_at: '2026-06-15T20:00:00Z', phase: 'grupos',
  group_name: 'A', home_score: null, away_score: null, status: 'scheduled',
  ground: 'Atlanta', name: 'Mercedes-Benz Stadium', city: 'Atlanta', country: '🇺🇸',
};

describe('generate', () => {
  it('layout returns an HTML string containing the title', () => {
    const html = layout('Test Title', '<p>body</p>');
    expect(html).toContain('Test Title');
    expect(html).toContain('<p>body</p>');
  });

  it('generateIndex returns HTML with leaderboard data', () => {
    const html = generateIndex([{
      league: { id: '1', name: 'Polla Test' },
      leaderboard: [{ user_id: '1', username: 'Alice', total_points: 10 }],
    }]);
    expect(html).toContain('Alice');
    expect(html).toContain('10');
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
      [{ user_id: '1', username: 'Alice', total_points: 10 }],
      [{ points: 5 }, { points: 3 }, { points: 0 }]
    );
    expect(html).toContain('Alice');
    expect(html).toContain('10 pts');
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
