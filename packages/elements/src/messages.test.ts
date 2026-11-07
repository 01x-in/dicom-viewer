import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLBAR, TOOLBAR_ACTIONS } from './toolbar-config';
import { fallbackMessage, itemLabel, toolLabel, warningMessage } from './messages';

describe('shell messages', () => {
  it('translates built-in actions and preserves custom labels', () => {
    const reset = DEFAULT_TOOLBAR.find((item) => item.type === 'action' && item.id === 'reset');
    if (reset?.type !== 'action') throw new Error('No reset action');
    expect(itemLabel(reset, { reset: 'Restablecer' })).toBe('Restablecer');
    expect(itemLabel({ ...reset, label: 'My reset' }, { reset: 'Restablecer' })).toBe('My reset');
    expect(itemLabel({ ...reset, label: 'Reset' }, { reset: 'Restablecer' })).toBe('Reset');
    expect(
      itemLabel(
        { id: 'layout-1x1', label: 'One viewport', run: () => undefined },
        { layoutSingle: 'Un visor' },
        { ...TOOLBAR_ACTIONS.layout },
      ),
    ).toBe('One viewport');
    expect(
      itemLabel(
        { id: 'layout-1x1', label: 'One viewport', run: () => undefined },
        { layoutSingle: 'Un visor' },
        TOOLBAR_ACTIONS.layout,
      ),
    ).toBe('Un visor');
    expect(toolLabel('pan', { toolPan: 'Desplazar' })).toBe('Desplazar');
  });

  it('names additional overlap pairs only when more pairs exist', () => {
    const warning = {
      code: 'overlapping-segments' as const,
      message: 'Segments share pixels.',
      parameters: { pairs: 'A / B', count: 0 },
    };
    const messages = {
      warningOverlappingSegments: 'Segmentos superpuestos: {pairs}.',
      warningOverlappingSegmentsMore: 'Segmentos superpuestos: {pairs}. Otros pares: {count}.',
    };
    expect(warningMessage(warning, messages)).toBe('Segmentos superpuestos: A / B.');
    expect(
      warningMessage({ ...warning, parameters: { ...warning.parameters, count: 2 } }, messages),
    ).toBe('Segmentos superpuestos: A / B. Otros pares: 2.');
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
