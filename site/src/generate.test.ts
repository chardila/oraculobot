import { describe, it, expect } from 'vitest';
import { layout, generateIndex, generatePartidos, generateStats } from './generate';

describe('generate', () => {
  it('layout returns an HTML string containing the title', () => {
    const html = layout('Test Title', '<p>body</p>');
    expect(html).toContain('Test Title');
    expect(html).toContain('<p>body</p>');
  });

  it('generateIndex returns HTML with leaderboard data', () => {
    const html = generateIndex([{ user_id: '1', username: 'Alice', total_points: 10 }]);
    expect(html).toContain('Alice');
    expect(html).toContain('10');
  });

  it('generatePartidos returns HTML with match data', () => {
    const html = generatePartidos([{
      id: '1', home_team: 'Colombia', away_team: 'Brasil',
      kickoff_at: '2026-06-15T18:00:00Z', phase: 'Grupos',
      group_name: 'A', home_score: null, away_score: null, status: 'pending',
    }]);
    expect(html).toContain('Colombia');
    expect(html).toContain('Brasil');
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
    expect(html).toContain('@media (max-width: 480px)');
  });

  it('oculta thead en móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('thead { display: none }');
  });

  it('estila tr como tarjeta en móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('border-radius');
  });

  it('usa data-label en td::before', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('content: attr(data-label)');
  });
});
