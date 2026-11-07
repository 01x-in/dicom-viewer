import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLBAR } from './toolbar-config';
import { fallbackMessage, itemLabel, toolLabel, warningMessage } from './messages';

describe('shell messages', () => {
  it('translates built-in actions and preserves custom labels', () => {
    const reset = DEFAULT_TOOLBAR.find((item) => item.type === 'action' && item.id === 'reset');
    if (reset?.type !== 'action') throw new Error('No reset action');
    expect(itemLabel(reset, { reset: 'Restablecer' })).toBe('Restablecer');
    expect(itemLabel({ ...reset, label: 'My reset' }, { reset: 'Restablecer' })).toBe('My reset');
    expect(toolLabel('pan', { toolPan: 'Desplazar' })).toBe('Desplazar');
  });

  it('preserves measurements in translated segmentation warnings', () => {
    expect(
      warningMessage(
        {
          code: 'plane-position',
          message: 'English detail',
          parameters: { count: 21, distance: '12.0' },
        },
        { warningPlanePosition: '{count} cuadros. Distancia: {distance} mm.' },
      ),
    ).toBe('21 cuadros. Distancia: 12.0 mm.');
    expect(
      warningMessage(
        {
          code: 'empty-segment',
          message: 'English detail',
          parameters: { name: '$& <name>' },
        },
        { warningEmptySegment: 'Sin píxeles: {name}.' },
      ),
    ).toBe('Sin píxeles: $& <name>.');
    expect(
      fallbackMessage('too-few-slices', { fallbackTooFewSlices: 'No hay suficientes cortes.' }),
    ).toBe('No hay suficientes cortes.');
  });
});
