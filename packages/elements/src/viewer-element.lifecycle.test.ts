// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DvViewerElement } from './viewer-element';

interface FakeViewer {
  loadSeries: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const created: FakeViewer[] = [];
let finishLoad: (value: { imageCount: number }) => void = () => undefined;

vi.mock('@scope/viewer-core', () => ({
  createDicomWebDataSource: () => ({}),
  createViewer: (): FakeViewer => {
    const viewer: FakeViewer = {
      loadSeries: vi.fn(
        () =>
          new Promise((resolve) => {
            finishLoad = resolve;
          }),
      ),
      destroy: vi.fn(),
    };
    created.push(viewer);
    return viewer;
  },
}));

await import('./define');

afterEach(() => {
  document.body.replaceChildren();
  created.length = 0;
});

async function mountComplete(): Promise<DvViewerElement> {
  const element = document.createElement('dv-viewer') as DvViewerElement;
  document.body.append(element);
  await element.updateComplete;
  element.wadoRoot = 'http://pacs';
  element.studyInstanceUid = '1.2.3';
  element.seriesInstanceUid = '1.2.3.4';
  await element.updateComplete;
  return element;
}

describe('<dv-viewer> lifecycle', () => {
  it('starts loading once it has every input', async () => {
    const element = await mountComplete();
    expect(created).toHaveLength(1);
    expect(element.status).toBe('loading');
  });

  it('tears the viewer down and goes idle when a required input is removed', async () => {
    const element = await mountComplete();
    element.seriesInstanceUid = undefined;
    await element.updateComplete;
    expect(created[0]?.destroy).toHaveBeenCalledOnce();
    expect(element.status).toBe('idle');
  });

  it('does not announce readiness for a load whose inputs were removed meanwhile', async () => {
    const element = await mountComplete();
    const onReady = vi.fn();
    element.addEventListener('dv-ready', onReady);

    element.studyInstanceUid = undefined;
    await element.updateComplete;
    finishLoad({ imageCount: 64 });
    await Promise.resolve();
    await Promise.resolve();

    expect(onReady).not.toHaveBeenCalled();
    expect(element.status).toBe('idle');
  });
});
