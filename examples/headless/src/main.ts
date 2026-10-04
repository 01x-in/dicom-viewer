import {
  createDicomWebDataSource,
  createViewer,
  decodeViewerState,
  encodeViewerState,
  getEngineDiagnostics,
  type DataSource,
  type StudyData,
  type Viewer,
  type ViewerStateV1,
  type ViewportApi,
} from '@scope/viewer-core';
import { createLocalFileDataSource, type LocalFileDataSource } from '@scope/viewer-core/local';

// The installability matrix drives this page through the query string and reads the result back
// from `data-dv-status` and `window.__dv*`. Everything else is a plain headless viewer: no
// framework, no UI package, just the core and a few buttons.
declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvViewer?: Viewer;
    __dvError?: string;
    __dvCycles?: unknown;
    /** Set by the test through Playwright when the server asks for a new token. */
    __refreshToken?: () => Promise<string>;
    __dvRefreshes?: number;
    __dvSkipped?: readonly { name: string; reason: string }[];
  }
}

const params = new URLSearchParams(location.search);
const viewportElement = document.querySelector<HTMLElement>('#viewport');
const seriesList = document.querySelector<HTMLElement>('#series');
const position = document.querySelector<HTMLElement>('#position');
const fileInput = document.querySelector<HTMLInputElement>('#files');
if (viewportElement === null || seriesList === null || position === null || fileInput === null) {
  throw new Error('missing page elements');
}
const mount = viewportElement;
const filePicker = fileInput;
const seriesPane = seriesList;
const positionLabel = position;
const status = (value: string): void => {
  document.documentElement.dataset['dvStatus'] = value;
};

function fail(error: unknown): void {
  window.__dvError = error instanceof Error ? error.message : String(error);
  status('error');
}

const assetsBaseUrl = params.get('assets');
const viewerSettings = {
  ...(assetsBaseUrl === null ? {} : { assets: { mode: 'url', baseUrl: assetsBaseUrl } as const }),
  ...(params.has('cpu') ? { cpuRendering: true } : {}),
};

function restoredState(): ViewerStateV1 | undefined {
  if (location.hash.length <= 1) return undefined;
  const decoded = decodeViewerState(location.hash);
  if (!decoded.ok) {
    fail(new Error(`The link's state is invalid: ${decoded.error}`));
    return undefined;
  }
  return decoded.state;
}

function dicomWebSource(): DataSource {
  const wadoRoot = params.get('wadoRoot');
  if (wadoRoot === null) throw new Error('wadoRoot is required');
  let token = params.get('token');
  return createDicomWebDataSource({
    wadoRoot,
    // A new token is read on every request, so a refresh takes effect at once.
    getRequestHeaders: () => (token === null ? {} : { Authorization: `Bearer ${token}` }),
    onUnauthorized: async () => {
      const refresh = window.__refreshToken;
      if (refresh === undefined) throw new Error('no way to refresh the token');
      token = await refresh();
      window.__dvRefreshes = (window.__dvRefreshes ?? 0) + 1;
    },
    retry: { retries: 2, baseDelayMs: 20 },
  });
}

let localSource: LocalFileDataSource | undefined;
let viewer: Viewer | undefined;

function describeSeries(study: StudyData): string[] {
  return study.series.map(
    (item) =>
      `${item.modality} ${item.description ?? item.seriesInstanceUID} (${(item.instanceCount ?? '?').toString()})`,
  );
}

function renderSeriesList(current: Viewer, study: StudyData): void {
  seriesPane.replaceChildren();
  study.series.forEach((item, index) => {
    const button = document.createElement('button');
    button.textContent = describeSeries(study)[index] ?? item.seriesInstanceUID;
    button.dataset['series'] = item.seriesInstanceUID;
    button.disabled = item.modality === 'SEG';
    button.addEventListener('click', () => {
      current.setViewportSeries('vp-0', item.seriesInstanceUID).catch(fail);
    });
    seriesPane.append(button);
  });
}

function reflectSelection(state: ViewerStateV1): void {
  const shown = state.viewports[0]?.seriesInstanceUID;
  for (const button of seriesPane.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset['series'] === shown));
  }
}

/** Starts a viewer on `dataSource`, restores what the link says, and wires the page to it. */
async function start(
  dataSource: DataSource,
  studyUid: string,
  seriesUid: string | null,
): Promise<void> {
  viewer?.destroy();
  const initialState = restoredState();
  const created = createViewer({
    dataSource,
    ...viewerSettings,
    ...(initialState === undefined ? {} : { initialState }),
  });
  viewer = created;
  window.__dvViewer = created;
  created.viewports.attach('vp-0', mount);

  created.on('error', (event) => {
    fail(event.error);
  });
  created.on('state:changed', ({ state, origin }) => {
    reflectSelection(state);
    // The page's own address always describes the viewer, so a copied link restores it.
    if (origin !== 'url') history.replaceState(null, '', `#${encodeViewerState(state)}`);
  });
  created.on('viewport:image', ({ imageIndex, imageCount }) => {
    positionLabel.textContent = `${(imageIndex + 1).toString()} / ${imageCount.toString()}`;
  });

  const study = await created.loadStudy(studyUid);
  renderSeriesList(created, study);
  const restoredSeries = created.getState().viewports[0]?.seriesInstanceUID;
  if (restoredSeries === undefined) {
    const chosen =
      seriesUid ?? study.series.find((item) => item.modality === 'CT')?.seriesInstanceUID;
    if (chosen === undefined) throw new Error('The study has no CT series to show.');
    await created.setViewportSeries('vp-0', chosen);
  } else {
    // Restored from the link: wait for it to be on screen.
    await created.setState({});
  }
  window.__dv = created.viewports.get('vp-0');
  reflectSelection(created.getState());
  status('ready');
}

/** Mounts and unmounts a viewer many times and records what is left behind, for the leak test. */
async function runCycles(count: number): Promise<void> {
  const wadoRoot = params.get('wadoRoot');
  const studyUid = params.get('study');
  const seriesUid = params.get('series');
  if (wadoRoot === null || studyUid === null || seriesUid === null) {
    throw new Error('cycles needs wadoRoot, study and series');
  }
  const results: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const host = document.createElement('div');
    host.style.cssText = 'width:256px;height:256px';
    document.body.append(host);
    const cycleViewer = createViewer({
      dataSource: createDicomWebDataSource({ wadoRoot }),
      ...viewerSettings,
    });
    cycleViewer.viewports.attach('vp-0', host);
    await cycleViewer.setState({
      studyInstanceUID: studyUid,
      viewports: [{ id: 'vp-0', seriesInstanceUID: seriesUid, imageIndex: index % 16 }],
    });
    const viewport = cycleViewer.viewports.get('vp-0');
    await viewport?.setImageIndex((index * 7) % 64);
    cycleViewer.destroy();
    host.remove();
    // Let teardown finish before the next cycle.
    await new Promise((done) => setTimeout(done, 50));
    results.push({ cycle: index + 1, diagnostics: getEngineDiagnostics() });
    window.__dvCycles = results;
  }
  status('cycles-done');
}

async function main(): Promise<void> {
  const cycles = Number(params.get('cycles') ?? '0');
  if (cycles > 0) {
    await runCycles(cycles);
    return;
  }
  if (params.has('local')) {
    // Waits for the user to pick files (the test does it with setInputFiles).
    status('waiting-for-files');
    filePicker.addEventListener('change', () => {
      void (async (): Promise<void> => {
        try {
          localSource?.dispose();
          const source = createLocalFileDataSource([...(filePicker.files ?? [])]);
          localSource = source;
          window.__dvSkipped = await source.skipped();
          const [study] = await source.studyInstanceUIDs();
          if (study === undefined) throw new Error('No DICOM study in those files.');
          await start(source, study, params.get('series'));
        } catch (error) {
          fail(error);
        }
      })();
    });
    return;
  }
  const studyUid = params.get('study');
  if (studyUid === null) throw new Error('study is required');
  await start(dicomWebSource(), studyUid, params.get('series'));
}

main().catch(fail);
