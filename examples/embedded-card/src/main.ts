import type { Viewer, ViewerConfigV1 } from '@tushar-im/dicom-viewer-core';
import '@tushar-im/dicom-viewer-elements/define';
import type { DvViewerElement } from '@tushar-im/dicom-viewer-elements';
import config from '../card.config.json';

// A host page shaped like a patient record with a viewer card. What it shows of the package:
// the look comes from the config file and a few CSS tokens; the actions the toolbar names that the
// package does not have (a window preset with a lit button, full screen) are the host's commands;
// the study dropdown and the series buttons are the host's own HTML calling the viewer.
const params = new URLSearchParams(location.search);
const wadoRoot = params.get('wadoRoot') ?? 'http://127.0.0.1:8042';
const element = document.querySelector<DvViewerElement>('#viewer');
if (element === null) throw new Error('missing <dv-viewer>');

const WINDOWS: Record<string, { center: number; width: number }> = {
  'soft-tissue': { center: 40, width: 400 },
  lung: { center: -600, width: 1500 },
  bone: { center: 480, width: 2500 },
  abdomen: { center: 60, width: 400 },
};

element.commands = {
  'host.window': {
    run: ({ viewer, viewportId }, args) =>
      viewer.viewports.get(viewportId)?.applyWindowPreset((args as { id: string }).id),
    // The button of the window that is on screen is lit.
    pressed: ({ viewer, viewportId }, args) => {
      const now = viewer.getState().viewports.find((v) => v.id === viewportId)?.window;
      const want = WINDOWS[(args as { id: string }).id];
      return (
        now !== undefined &&
        want !== undefined &&
        now.center === want.center &&
        now.width === want.width
      );
    },
  },
  'host.fullscreen': {
    run: () =>
      document.fullscreenElement === null ? element.requestFullscreen() : document.exitFullscreen(),
    pressed: () => document.fullscreenElement === element,
    enabled: () => true,
  },
};
element.config = config as ViewerConfigV1;
// A machine without a usable GPU (a test browser, a remote desktop) asks for `?cpu`.
element.cpuRendering = params.has('cpu');

const studies = document.querySelector<HTMLSelectElement>('#studies');
const seriesBar = document.querySelector<HTMLElement>('#series');
const title = document.querySelector<HTMLElement>('#title');
const meta = document.querySelector<HTMLElement>('#meta');
if (studies === null || seriesBar === null || title === null || meta === null)
  throw new Error('page');

async function studyUids(): Promise<string[]> {
  const found = (await (await fetch(`${wadoRoot}/studies`)).json()) as Array<
    Record<string, { Value?: string[] }>
  >;
  return found.flatMap((study) => study['0020000D']?.Value ?? []);
}

function drawSeries(viewer: Viewer, activeUid?: string): void {
  const cts = (viewer.getStudy()?.series ?? []).filter(
    (s) => s.modality === 'CT' && (s.instanceCount ?? 2) > 1,
  );
  seriesBar!.replaceChildren(
    ...cts.map((s, at) => {
      const button = document.createElement('button');
      button.textContent = `CT ${String(at + 1)}`;
      button.title = s.description ?? '';
      button.setAttribute('aria-pressed', String(s.seriesInstanceUID === activeUid));
      button.onclick = async () => {
        await viewer.setViewportSeries('vp-0', s.seriesInstanceUID);
        drawSeries(viewer, s.seriesInstanceUID);
      };
      return button;
    }),
  );
  const current = cts.find((s) => s.seriesInstanceUID === activeUid);
  title!.textContent = current?.description ?? 'CT';
  meta!.textContent = `${String(cts.length)} series`;
}

async function switchStudy(viewer: Viewer, uid: string): Promise<void> {
  const study = await viewer.loadStudy(uid);
  const first = study.series.find((s) => s.modality === 'CT' && (s.instanceCount ?? 2) > 1);
  if (first !== undefined) await viewer.setViewportSeries('vp-0', first.seriesInstanceUID);
  drawSeries(viewer, first?.seriesInstanceUID);
}

// `?study=` shows one study, so a public server with many studies is not listed.
const only = params.get('study');
const uids = only === null ? await studyUids() : [only];
studies.replaceChildren(
  ...uids.map((uid, at) => new Option(`Study ${String(at + 1)} of ${String(uids.length)}`, uid)),
);
element.addEventListener('dv-ready', () => {
  const viewer = element.viewer;
  if (viewer === undefined) return;
  drawSeries(viewer, viewer.getState().viewports[0]?.seriesInstanceUID);
  studies.onchange = () => void switchStudy(viewer, studies.value);
});
element.addEventListener('dv-error', (event) => {
  title.textContent = `Could not show the images: ${(event as CustomEvent<{ error: Error }>).detail.error.message}`;
});
// Redraw the lit buttons when the browser enters or leaves full screen.
document.addEventListener('fullscreenchange', () => element.requestUpdate());
element.wadoRoot = wadoRoot;
element.studyInstanceUid = uids[0];
