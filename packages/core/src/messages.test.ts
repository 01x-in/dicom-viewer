import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWER_MESSAGES, formatViewerMessage, resolveViewerMessages } from './messages';

describe('viewer messages', () => {
  it('keeps English defaults when a host supplies only some messages', () => {
    const messages = resolveViewerMessages({ seriesPanel: 'Series en español' });
    expect(messages.seriesPanel).toBe('Series en español');
    expect(messages.toolZoom).toBe('Zoom');
    expect(DEFAULT_VIEWER_MESSAGES.seriesPanel).toBe('Series');
  });

  it('substitutes named values as plain text without interpreting replacement syntax', () => {
    expect(formatViewerMessage('Show {name}', { name: '$& <patient>' })).toBe('Show $& <patient>');
    expect(formatViewerMessage('{index} of {count}', { index: 1, count: 2 })).toBe('1 of 2');
    expect(formatViewerMessage('{missing}', {})).toBe('{missing}');
  });
});
