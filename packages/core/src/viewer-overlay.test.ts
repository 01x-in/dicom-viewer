// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function show(h: Harness, imageIndex = 5): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT, { imageIndex });
}

const corner = (h: Harness, name: string): string | undefined =>
  h.element.querySelector(`[data-dv-corner="${name}"]`)?.textContent;

describe('the overlay', () => {
  it('shows the slice indicator, the window, the series, and the image size over the picture', async () => {
    const h = harness();
    await show(h);
    expect(corner(h, 'bottom-right')).toBe('Image 6 / 10');
    expect(corner(h, 'bottom-left')).toBe('W 400  L 40');
    expect(corner(h, 'top-left')).toBe('CT');
    expect(corner(h, 'top-right')).toBe('CT\n512 × 256');
    expect(h.element.querySelector('.dv-overlay')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not show who the patient is', async () => {
    const h = harness();
    await show(h);
    expect(h.element.textContent).not.toContain('DOE');
    expect(h.element.textContent).not.toContain('ID-7');
  });

  it('shows the patient when asked', async () => {
    const h = harness({ viewer: { overlay: { showPatientInfo: true } } });
    await show(h);
    expect(corner(h, 'top-left')).toBe('DOE JANE\nID-7\nCT');
  });

  it('follows the slice, whoever moves it', async () => {
    const h = harness();
    await show(h);
    await h.viewer.viewports.get('vp-0')?.setImageIndex(0);
    expect(corner(h, 'bottom-right')).toBe('Image 1 / 10');
    h.port.stacks[0]?.emitImage(8);
    expect(corner(h, 'bottom-right')).toBe('Image 9 / 10');
  });

  it('follows the window, the inversion, and the zoom', async () => {
    const h = harness();
    await show(h);
    const api = h.viewer.viewports.get('vp-0');
    await api?.applyWindowPreset('lung');
    await api?.setInvert(true);
    await api?.setZoom(2);
    expect(corner(h, 'bottom-left')).toBe('W 1500  L -600\nZoom 200%\nInverted');
    await api?.resetView();
    expect(corner(h, 'bottom-left')).toBe('W 400  L 40');
  });

  it('is replaced with the series', async () => {
    const h = harness();
    await show(h);
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(h.element.querySelectorAll('.dv-overlay')).toHaveLength(1);
    expect(corner(h, 'bottom-right')).toMatch(/^Image \d+ \/ 6$/);
  });

  it('goes with the viewport: detach, destroy, and a render that failed', async () => {
    const h = harness();
    await show(h);
    h.viewer.viewports.detach('vp-0');
    await h.viewer.loadStudy(STUDY);
    expect(h.element.querySelector('.dv-overlay')).toBeNull();

    const other = harness();
    await show(other);
    other.viewer.destroy();
    expect(other.element.querySelector('.dv-overlay')).toBeNull();

    const failing = harness();
    await show(failing);
    await expect(failing.viewer.setViewportSeries('vp-0', '1.2.3.77')).rejects.toThrow();
    expect(failing.element.querySelector('.dv-overlay')).toBeNull();
  });

  it('can be left out', async () => {
    const h = harness({ viewer: { overlay: false } });
    await show(h);
    expect(h.element.querySelector('.dv-overlay')).toBeNull();
  });

  it('makes the element a positioning context, and gives that back', async () => {
    const h = harness();
    await show(h);
    expect(h.element.style.position).toBe('relative');
    h.viewer.viewports.detach('vp-0');
    await h.viewer.loadStudy(STUDY);
    expect(h.element.style.position).toBe('');

    const positioned = harness();
    positioned.element.style.position = 'absolute';
    await show(positioned);
    expect(positioned.element.style.position).toBe('absolute');
  });
});
