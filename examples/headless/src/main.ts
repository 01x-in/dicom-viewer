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
} from '@tushar-im/dicom-viewer-core';
import {
  createLocalFileDataSource,
  type LocalFileDataSource,
} from '@tushar-im/dicom-viewer-core/local';

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
    /** The data source of the DICOMweb page, so the test can ask which instances a series has. */
    __dvSource?: DataSource;
    /** What the engine holds, so the test can see whether anything is left over. */
    __dvDiagnostics?: typeof getEngineDiagnostics;
  }
}

window.__dvDiagnostics = getEngineDiagnostics;

const params = new URLSearchParams(location.search);
const viewportElement = document.querySelector<HTMLElement>('#viewport');
const seriesList = document.querySelector<HTMLElement>('#series');
const toolsList = document.querySelector<HTMLElement>('#tools');
const position = document.querySelector<HTMLElement>('#position');
const fileInput = document.querySelector<HTMLInputElement>('#files');
if (
  viewportElement === null ||
  seriesList === null ||
  toolsList === null ||
  position === null ||
  fileInput === null
) {
  throw new Error('missing page elements');
}
const mount = viewportElement;
const filePicker = fileInput;
const seriesPane = seriesList;
const toolsPane = toolsList;
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
  // `prefetch=0` loads only the slices that are asked for, which keeps fault-injection scenarios deterministic.
  ...(params.get('prefetch') === '0' ? { prefetch: false as const } : {}),
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
  const source = createDicomWebDataSource({
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
  window.__dvSource = source;
  return source;
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

/** One button per tool, window preset, and action the viewer offers, so the page can be driven without the keyboard. */
function renderTools(current: Viewer): void {
  toolsPane.replaceChildren();
  const add = (
    label: string,
    onClick: () => Promise<void> | void,
    data: Record<string, string>,
  ): void => {
    const button = document.createElement('button');
    button.textContent = label;
    Object.assign(button.dataset, data);
    button.addEventListener('click', () => {
      Promise.resolve(onClick()).catch(fail);
    });
    toolsPane.append(button);
  };
  const viewport = (): ViewportApi | undefined => current.viewports.get('vp-0');
  for (const tool of current.tools.list()) {
    add(tool.label, () => current.tools.setActive(tool.id), { tool: tool.id });
  }
  for (const preset of current.tools.windowPresets()) {
    add(preset.label, () => viewport()?.applyWindowPreset(preset.id), { preset: preset.id });
  }
  add('Invert', () => viewport()?.toggleInvert(), { action: 'invert' });
  add('Reset', () => viewport()?.resetView(), { action: 'reset' });
  add(
    'Play',
    () => {
      const cine = viewport()?.cine;
      if (cine?.playing === true) cine.stop();
      else return cine?.play({ fps: 15 });
    },
    { action: 'cine' },
  );
  const reflectTool = (active: string): void => {
    for (const button of toolsPane.querySelectorAll<HTMLButtonElement>('button[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset['tool'] === active));
    }
  };
  reflectTool(current.tools.getActive());
  current.on('tool:active', ({ tool }) => {
    reflectTool(tool);
  });
  current.on('viewport:cine', ({ playing }) => {
    const button = toolsPane.querySelector<HTMLButtonElement>('button[data-action="cine"]');
    if (button !== null) button.textContent = playing ? 'Stop' : 'Play';
  });
}

function reflectSelection(state: ViewerStateV1): void {
  const shown = state.viewports[0]?.seriesInstanceUID;
  for (const button of seriesPane.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset['series'] === shown));
  }
}

let addressTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAddressUpdate(current: Viewer): void {
  clearTimeout(addressTimer);
  addressTimer = setTimeout(() => {
    history.replaceState(null, '', `#${encodeViewerState(current.getState())}`);
  }, 200);
}

/** The state in a layout with a `vp-1`, keeping everything a restored link said. */
function withSecondViewport(state: ViewerStateV1 | undefined): ViewerStateV1 {
  const base: ViewerStateV1 = state ?? { version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] };
  return base.viewports.some((viewport) => viewport.id === 'vp-1')
    ? base
    : {
        ...base,
        layout: '1x2',
        viewports: [...base.viewports, { id: 'vp-1' }],
      };
}

/** Starts a viewer on `dataSource`, restores what the link says, and wires the page to it. */
async function start(
  dataSource: DataSource,
  studyUid: string,
  seriesUid: string | null,
): Promise<void> {
  viewer?.destroy();
  // `second` asks for a second viewport on the same series, to see that what a SEG looks like follows it.
  const restored = restoredState();
  const initialState: ViewerStateV1 | undefined = params.has('second')
    ? withSecondViewport(restored)
    : restored;
  const created = createViewer({
    dataSource,
    ...viewerSettings,
    ...(initialState === undefined ? {} : { initialState }),
  });
  viewer = created;
  window.__dvViewer = created;
  try {
    await show(created, studyUid, seriesUid);
  } catch (error) {
    // A viewer that did not come up must not keep its engine, worker threads, or cache.
    created.destroy();
    if (viewer === created) viewer = undefined;
    throw error;
  }
}

async function show(created: Viewer, studyUid: string, seriesUid: string | null): Promise<void> {
  created.viewports.attach('vp-0', mount);
  renderTools(created);

  created.on('error', (event) => {
    fail(event.error);
  });
  created.on('state:changed', ({ state, origin }) => {
    reflectSelection(state);
    // The page's own address always describes the viewer, so a copied link restores it. A drag
    // changes the state on every mouse move, and browsers limit how often the address may change.
    if (origin !== 'url') scheduleAddressUpdate(created);
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
  if (params.has('second')) {
    // A viewer started again (local files picked again) must not leave the last one's viewport behind.
    document.querySelector('#viewport2')?.remove();
    const second = document.createElement('div');
    second.id = 'viewport2';
    second.style.cssText = 'width:512px;height:512px;background:#000';
    document.querySelector('#app')?.append(second);
    created.viewports.attach('vp-1', second);
    const shown = created.getState().viewports[0]?.seriesInstanceUID;
    if (shown !== undefined) await created.setViewportSeries('vp-1', shown);
  }
  reflectSelection(created.getState());
  status('ready');
}

/** Waits until the engine holds nothing, or five seconds have passed. */
async function settled(): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    await new Promise((done) => setTimeout(done, 25));
    const held = getEngineDiagnostics();
    // No diagnostics means the engine was never loaded: nothing to wait for.
    if (held === undefined) return;
    if (
      held.cacheBytes +
        held.workers +
        held.renderingEngines +
        held.viewports +
        held.activeEngines +
        held.volumes ===
      0
    ) {
      return;
    }
    if (Date.now() > deadline) return;
  }
}

/** A rectangle on one slice, so the leak test covers the shapes the engine draws and the slices it reads for them. */
async function measureSomething(
  target: Viewer,
  source: DataSource,
  studyUid: string,
  seriesUid: string,
  imageIndex: number,
): Promise<void> {
  const series = await source.getSeries(studyUid, seriesUid);
  const instance = series.stacks[0]?.instances[imageIndex];
  if (instance === undefined) throw new Error(`The series has no slice ${imageIndex.toString()}.`);
  const [x = 0, y = 0, z = 0] = (instance.metadata['00200032']?.Value ?? []).map(Number);
  await target.measurements.add({
    type: 'rectangle',
    reference: {
      studyInstanceUID: studyUid,
      seriesInstanceUID: seriesUid,
      sopInstanceUID: instance.sopInstanceUID,
    },
    points: [
      [x + 15, y + 15, z],
      [x + 45, y + 15, z],
      [x + 15, y + 45, z],
      [x + 45, y + 45, z],
    ],
  });
}

/** Mounts and unmounts a viewer many times and records what is left behind, for the leak test. */
async function runCycles(count: number, alternateAssets: boolean): Promise<void> {
  const wadoRoot = params.get('wadoRoot');
  const studyUid = params.get('study');
  const seriesUid = params.get('series');
  // With `seg`, each cycle also loads that SEG (and highlights it as an outline, which Cornerstone
  // draws with a second labelmap), so the leak test covers what a SEG holds.
  const segUid = params.get('seg');
  if (wadoRoot === null || studyUid === null || seriesUid === null) {
    throw new Error('cycles needs wadoRoot, study and series');
  }
  const results: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const host = document.createElement('div');
    host.style.cssText = 'width:256px;height:256px';
    document.body.append(host);
    const extraHosts: HTMLElement[] = [];
    // With `alternate`, every other cycle runs with the other assets mode, which the runtime only
    // allows while no viewer is running.
    const assets =
      alternateAssets && assetsBaseUrl !== null
        ? index % 2 === 0
          ? ({ mode: 'inline' } as const)
          : ({ mode: 'url', baseUrl: assetsBaseUrl } as const)
        : undefined;
    const cycleSource = createDicomWebDataSource({ wadoRoot });
    const cycleViewer = createViewer({
      dataSource: cycleSource,
      ...viewerSettings,
      ...(assets === undefined ? {} : { assets }),
    });
    try {
      cycleViewer.viewports.attach('vp-0', host);
      await cycleViewer.setState({
        studyInstanceUID: studyUid,
        viewports: [{ id: 'vp-0', seriesInstanceUID: seriesUid, imageIndex: index % 16 }],
      });
      const viewport = cycleViewer.viewports.get('vp-0');
      await viewport?.setImageIndex((index * 7) % 64);
      await measureSomething(cycleViewer, cycleSource, studyUid, seriesUid, (index * 7) % 64);
      if (params.has('mpr')) {
        // Three planes of one volume, so the leak test covers what a volume and its viewports hold.
        await cycleViewer.setLayout('2x2');
        const planes = ['axial', 'sagittal', 'coronal'] as const;
        for (const [at, orientation] of planes.entries()) {
          const planeHost = document.createElement('div');
          planeHost.style.cssText = 'width:192px;height:192px';
          document.body.append(planeHost);
          extraHosts.push(planeHost);
          const id = `vp-${(at + 1).toString()}`;
          cycleViewer.viewports.attach(id, planeHost);
          await cycleViewer.setViewportSeries(id, seriesUid, { orientation });
        }
      }
      if (segUid !== null) {
        await cycleViewer.segmentations.load(segUid);
        await cycleViewer.segmentations.highlight(segUid, [2], { mode: 'outline' });
        // Every other cycle unloads it; the others leave it to `destroy()`, which must give it back.
        if (index % 2 === 0) await cycleViewer.segmentations.unload(segUid);
      }
    } finally {
      cycleViewer.destroy();
      host.remove();
      for (const extra of extraHosts) extra.remove();
    }
    // Teardown finishes once the images still on their way have landed. Wait for that, not for a
    // fixed time, then record what is left.
    await settled();
    results.push({ cycle: index + 1, diagnostics: getEngineDiagnostics() });
    window.__dvCycles = results;
  }
  status('cycles-done');
}

async function main(): Promise<void> {
  const cycles = Number(params.get('cycles') ?? '0');
  if (cycles > 0) {
    await runCycles(cycles, params.has('alternate'));
    return;
  }
  if (params.has('local')) {
    // Waits for the user to pick files (the test does it with setInputFiles).
    status('waiting-for-files');
    // Only the latest selection may take over: an older one that finishes late is discarded.
    let selection = 0;
    filePicker.addEventListener('change', () => {
      selection += 1;
      const mine = selection;
      // The viewer goes before the source it reads from, or it could ask for a file that is gone.
      viewer?.destroy();
      viewer = undefined;
      // Its second viewport goes with it, even if the new selection turns out not to be a study.
      document.querySelector('#viewport2')?.remove();
      localSource?.dispose();
      localSource = undefined;
      void (async (): Promise<void> => {
        const source = createLocalFileDataSource([...(filePicker.files ?? [])]);
        try {
          const skipped = await source.skipped();
          const [study] = await source.studyInstanceUIDs();
          if (mine !== selection) return;
          window.__dvSkipped = skipped;
          if (study === undefined) throw new Error('No DICOM study in those files.');
          localSource = source;
          await start(source, study, params.get('series'));
        } catch (error) {
          if (mine === selection) fail(error);
        } finally {
          if (mine !== selection || localSource !== source) source.dispose();
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
