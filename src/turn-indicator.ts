import './turn-indicator.css';

/**
 * Source inspiration: https://www.beautifului.dev/r/loading-state.json
 *
 * The loading state is rendered as markup so it can be used by the existing
 * vanilla DOM renderer without introducing a component runtime.
 */

const GRID_SIZE = 5;
const WAVE_STEP_MS = 90;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

/**
 * Render a compact accessible turn status with a decorative 5×5 pixel wave.
 * The label is intentionally text content (rather than an aria-label only)
 * so the status remains useful when motion is reduced or unavailable.
 */
export function turnIndicatorMarkup(label: string): string {
  const cells: string[] = [];
  const centerRow = Math.floor(GRID_SIZE / 2);

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const delay = (column + Math.abs(row - centerRow)) * WAVE_STEP_MS;
      cells.push(`<span class="turn-indicator__cell" style="--turn-indicator-delay:${delay}ms"></span>`);
    }
  }

  return `<div class="turn-indicator" role="status" aria-live="polite" aria-atomic="true"><span class="turn-indicator__grid" aria-hidden="true">${cells.join('')}</span><span class="turn-indicator__label">${escapeHtml(label)}</span></div>`;
}

