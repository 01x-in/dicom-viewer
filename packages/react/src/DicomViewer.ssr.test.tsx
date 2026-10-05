import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DicomViewer } from './DicomViewer';

describe('<DicomViewer> on the server', () => {
  it('renders the element without touching the browser, the engine, or the data source', () => {
    // A node environment: no window, no document, no customElements. Anything that reached for them would throw.
    const html = renderToString(
      <DicomViewer
        options={{
          dataSource: {
            getStudy: () => Promise.reject(new Error('never called')),
            getSeries: () => Promise.reject(new Error('never called')),
            getInstanceBytes: () => Promise.reject(new Error('never called')),
            capabilities: { instanceRetrieve: 'none' },
          },
        }}
        studyInstanceUID="1.2.3"
        banner={<b>Not for diagnosis</b>}
      />,
    );
    expect(html).toContain('<dv-viewer');
    expect(html).toContain('slot="banner"');
    expect(html).toContain('Not for diagnosis');
  });
});
