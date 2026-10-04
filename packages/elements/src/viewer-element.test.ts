// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import './define';
import { elementTag } from './tags';
import type { DvViewerElement } from './viewer-element';

async function mount(): Promise<DvViewerElement> {
  const element = document.createElement(elementTag('viewer')) as DvViewerElement;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe('<dv-viewer>', () => {
  it('renders into the light DOM, so Cornerstone measures and listens on real elements', async () => {
    const element = await mount();
    expect(element.shadowRoot).toBeNull();
    expect(element.querySelector('.dv-viewport')).toBeInstanceOf(HTMLElement);
  });

  it('stays idle until it has a server, a study, and a series', async () => {
    const element = await mount();
    element.wadoRoot = 'http://localhost:1';
    element.studyInstanceUid = '1.2.3';
    await element.updateComplete;
    expect(element.status).toBe('idle');
  });

  it('is registered under the dv- prefix', () => {
    expect(customElements.get('dv-viewer')).toBeDefined();
  });
});
