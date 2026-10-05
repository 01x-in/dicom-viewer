import { renderToString } from 'vue/server-renderer';
import { createSSRApp, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { DicomViewer } from './index';

describe('<DicomViewer> on the server', () => {
  it('renders the element without touching the browser, the engine, or the data source', async () => {
    // A node environment: no window, no document, no customElements. Anything that reached for them would throw.
    const never = (): Promise<never> => Promise.reject(new Error('never called'));
    const app = createSSRApp({
      render: () =>
        h(
          DicomViewer,
          {
            options: {
              dataSource: {
                getStudy: never,
                getSeries: never,
                getInstanceBytes: never,
                capabilities: { instanceRetrieve: 'none' },
              },
            },
            studyInstanceUid: '1.2.3',
          },
          { banner: () => h('b', 'Not for diagnosis') },
        ),
    });
    const html = await renderToString(app);
    expect(html).toContain('<dv-viewer');
    expect(html).toContain('slot="banner"');
    expect(html).toContain('Not for diagnosis');
  });
});
