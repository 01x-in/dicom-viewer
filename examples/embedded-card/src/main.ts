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
    // A host command has no event of its own to redraw a lit state, so the button is not a toggle.
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The study UIDs of a QIDO-RS answer. Anything else than a list of DICOM JSON studies is an error. */
async function studyUids(): Promise<string[]> {
  const response = await fetch(`${wadoRoot}/studies`);
  if (!response.ok) throw new Error(`The server answered ${String(response.status)} for /studies.`);
  const found: unknown = await response.json();
  if (!Array.isArray(found)) throw new Error('The study list is not a list.');
  return found.flatMap((study: unknown) => {
    const value = isRecord(study) && isRecord(study['0020000D']) ? study['0020000D']['Value'] : [];
    return Array.isArray(value)
      ? value.filter((uid): uid is string => typeof uid === 'string')
      : [];
  });
}

/** Shows a failure where the host's own title is, so the card never stays on "Loading". */
function fail(error: unknown): void {
  title!.textContent = `Could not show the images: ${error instanceof Error ? error.message : String(error)}`;
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
      button.onclick = () => {
        viewer
          .setViewportSeries('vp-0', s.seriesInstanceUID)
          .then(() => {
            drawSeries(viewer, s.seriesInstanceUID);
          })
          .catch(fail);
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

element.addEventListener('dv-error', (event) => {
  fail((event as CustomEvent<{ error: Error }>).detail.error);
});
element.addEventListener('dv-ready', () => {
  const viewer = element.viewer;
  if (viewer === undefined) return;
  drawSeries(viewer, viewer.getState().viewports[0]?.seriesInstanceUID);
  let shownStudy = studies.value;
  studies.onchange = () => {
    // A switch that fails puts the dropdown back, so it never names a study that is not on screen.
    switchStudy(viewer, studies.value)
      .then(() => {
        shownStudy = studies.value;
      })
      .catch((error: unknown) => {
        studies.value = shownStudy;
        fail(error);
      });
  };
});

// `?study=` shows one study, so a public server with many studies is not listed.
let uids: string[];
try {
  const only = params.get('study');
  uids = only === null ? await studyUids() : [only];
} catch (error) {
  fail(error);
  uids = [];
}
studies.replaceChildren(
  ...uids.map((uid, at) => new Option(`Study ${String(at + 1)} of ${String(uids.length)}`, uid)),
);
if (uids[0] !== undefined) {
  element.wadoRoot = wadoRoot;
  element.studyInstanceUid = uids[0];
}
