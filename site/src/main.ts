import '@fontsource-variable/fraunces';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import { DvViewerElement } from '@01x/dicom-viewer-elements';
import '@01x/dicom-viewer-elements/define';

// The public sample server of the OHIF viewer demo (viewer.ohif.org) and one CT study on it. The
// browser talks to it directly. It is not ours: if the study goes away, the demo shows its fallback.
const DEMO_WADO_ROOT = 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb';
const DEMO_STUDY_UID = '2.16.840.1.114362.1.11972228.22789312658.616067305.306.2';

function requireElement<T extends Element>(selector: string, type: abstract new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`The page is missing ${selector}`);
  return element;
}

function setStatus(text: string, state: 'loading' | 'error' | 'ready'): void {
  const status = requireElement('#status', HTMLElement);
  requireElement('#status-text', HTMLElement).textContent = text;
  status.dataset['state'] = state;
}

// A server can accept the connection and then never answer, which raises no error.
const DEMO_LOAD_TIMEOUT_MS = 45_000;

function startDemo(): void {
  const viewer = requireElement('#viewer', DvViewerElement);

  const showFailure = (): void => {
    setStatus(
      'The demo server did not answer. Try again later, or read the tutorial to run the viewer on your own machine.',
      'error',
    );
  };
  const timeout = window.setTimeout(() => {
    console.error('The demo viewer was not ready after', DEMO_LOAD_TIMEOUT_MS, 'ms');
    showFailure();
  }, DEMO_LOAD_TIMEOUT_MS);

  viewer.addEventListener('dv-ready', () => {
    window.clearTimeout(timeout);
    setStatus('', 'ready');
  });
  viewer.addEventListener('dv-error', (event) => {
    window.clearTimeout(timeout);
    const { error } = (event as CustomEvent<{ error: Error }>).detail;
    console.error('The demo viewer reported an error:', error.message);
    showFailure();
  });

  // A phone is too narrow for a side panel on each side of the image.
  const narrow = window.matchMedia('(max-width: 760px)');
  const applyPanels = (): void => {
    viewer.hideSeriesPanel = narrow.matches;
    viewer.hideMeasurementsPanel = narrow.matches;
    viewer.hideSegmentationsPanel = narrow.matches;
  };
  applyPanels();
  narrow.addEventListener('change', applyPanels);

  setStatus('Loading a CT study from the public server…', 'loading');
  viewer.wadoRoot = DEMO_WADO_ROOT;
  viewer.studyInstanceUid = DEMO_STUDY_UID;
}

// The viewer engine is large, so it starts when the demo is about to be seen.
function startDemoWhenNear(): void {
  const section = requireElement('#demo', HTMLElement);
  if (!('IntersectionObserver' in window)) {
    startDemo();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        startDemo();
      }
    },
    { rootMargin: '400px 0px' },
  );
  observer.observe(section);
}

function setUpCopyButton(): void {
  const button = requireElement('#copy', HTMLButtonElement);
  const command = requireElement('#install-cmd', HTMLElement);
  button.addEventListener('click', () => {
    const done = (label: string): void => {
      button.textContent = label;
      window.setTimeout(() => {
        button.textContent = button.dataset['label'] ?? 'Copy';
      }, 1600);
    };
    navigator.clipboard.writeText(command.textContent).then(
      () => {
        done('Copied');
      },
      () => {
        done('Press Ctrl+C');
      },
    );
  });
}

function setUpTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (selected: HTMLButtonElement, focus: boolean): void => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const panelId = tab.getAttribute('aria-controls');
      const panel = panelId === null ? null : document.getElementById(panelId);
      if (panel !== null) panel.hidden = !active;
    }
    if (focus) selected.focus();
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => {
      select(tab, false);
    });
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      if (next !== undefined) select(next, true);
    });
  }
}

setUpCopyButton();
setUpTabs();
startDemoWhenNear();
