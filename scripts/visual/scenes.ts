import type { Page } from 'playwright';
import '../matrix/page-types.ts';

/** What a scene needs to open the example page and find the phantom series. */
export interface SceneContext {
  readonly page: Page;
  readonly ids: PhantomIds;
  /** Loads the example page with a series (the CT by default), or with nothing at all. */
  readonly open: (options?: { series?: string; study?: string; empty?: boolean }) => Promise<void>;
  /** Waits until two screenshots in a row are the same: volumes stream in and the engine draws a frame later. */
  readonly settle: () => Promise<void>;
}

export interface PhantomIds {
  readonly study: string;
  readonly ct: string;
  readonly seg: string;
  readonly tilted: { readonly study: string; readonly series: string };
}

export interface Scene {
  /** The file name of the baseline: `<name>.png`. */
  readonly name: string;
  readonly run: (context: SceneContext) => Promise<void>;
}

const MIDDLE_SLICE = 31;

async function showMiddleSlice(page: Page): Promise<void> {
  await page.evaluate(async (index) => {
    await window.__dvViewer?.viewports.get('vp-0')?.setImageIndex(index);
  }, MIDDLE_SLICE);
}

async function setAttribute(page: Page, name: string, value: string): Promise<void> {
  await page.evaluate(
    ({ attribute, to }) => document.querySelector('dv-viewer')?.setAttribute(attribute, to),
    { attribute: name, to: value },
  );
}

/** Plane, slice, and layout choices that need no mouse, so the pictures do not depend on where a pointer was. */
export const SCENES: readonly Scene[] = [
  {
    name: 'empty-state',
    run: async (context: SceneContext): Promise<void> => {
      const { open, settle } = context;
      await open({ empty: true });
      await settle();
    },
  },
  {
    name: 'stack-dark',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, settle } = context;
      await open();
      await showMiddleSlice(page);
      await settle();
    },
  },
  {
    name: 'stack-light',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, settle } = context;
      await open();
      await showMiddleSlice(page);
      await setAttribute(page, 'theme', 'light');
      await settle();
    },
  },
  {
    name: 'palette-navy',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, settle } = context;
      await open();
      await showMiddleSlice(page);
      await setAttribute(page, 'palette', 'navy');
      await settle();
    },
  },
  {
    name: 'palette-graphite-light',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, settle } = context;
      await open();
      await showMiddleSlice(page);
      await setAttribute(page, 'palette', 'graphite');
      await setAttribute(page, 'theme', 'light');
      await settle();
    },
  },
  {
    name: 'measurement-length',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, settle } = context;
      await open();
      await showMiddleSlice(page);
      await page.evaluate(() => window.__dvViewer?.tools.setActive('length'));
      const box = await page.locator('dv-viewer canvas').first().boundingBox();
      if (box === null) throw new Error('no canvas');
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
      await page.mouse.up();
      await page.mouse.move(0, 0);
      await settle();
    },
  },
  {
    name: 'segmentation',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, ids, settle } = context;
      await open();
      await showMiddleSlice(page);
      await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), ids.seg);
      await settle();
    },
  },
  {
    name: 'layout-2x2',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, ids, settle } = context;
      await open();
      await page.evaluate(
        async ({ series, middle }) => {
          const viewer = window.__dvViewer;
          if (viewer === undefined) throw new Error('no viewer');
          await viewer.setLayout('2x2');
          for (const [id, index] of [
            ['vp-0', middle],
            ['vp-1', 8],
            ['vp-2', 20],
            ['vp-3', 48],
          ] as const) {
            await viewer.setViewportSeries(id, series, { imageIndex: index });
          }
        },
        { series: ids.ct, middle: MIDDLE_SLICE },
      );
      await settle();
    },
  },
  {
    name: 'mpr-planes',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, ids, settle } = context;
      await open();
      await page.evaluate(async (series) => {
        const viewer = window.__dvViewer;
        if (viewer === undefined) throw new Error('no viewer');
        await viewer.setLayout('2x2');
        for (const [id, orientation] of [
          ['vp-0', 'axial'],
          ['vp-1', 'sagittal'],
          ['vp-2', 'coronal'],
        ] as const) {
          await viewer.setViewportSeries(id, series, { orientation });
        }
      }, ids.ct);
      await settle();
    },
  },
  {
    name: 'mpr-fallback-notice',
    run: async (context: SceneContext): Promise<void> => {
      const { open, page, ids, settle } = context;
      await open({ series: ids.tilted.series, study: ids.tilted.study });
      await page.evaluate(async (series) => {
        const viewer = window.__dvViewer;
        if (viewer === undefined) throw new Error('no viewer');
        await viewer.setViewportSeries('vp-0', series, { orientation: 'coronal' });
      }, ids.tilted.series);
      await settle();
    },
  },
];
