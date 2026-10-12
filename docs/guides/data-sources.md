# Data sources

A data source tells the viewer where studies, series, and images come from. Two are built in. You can also write
your own: the `DataSource` interface in `@tushar-im/dicom-viewer-core` is small.

## DICOMweb

```ts
import { createDicomWebDataSource } from '@tushar-im/dicom-viewer-core';

const dataSource = createDicomWebDataSource({
  wadoRoot: 'https://pacs.example.org/dicom-web',
  qidoRoot: 'https://pacs.example.org/dicom-web', // optional; defaults to wadoRoot
  getRequestHeaders: () => ({ Authorization: `Bearer ${session.token}` }),
  onUnauthorized: async () => session.refresh(),
  retry: { retries: 2, baseDelayMs: 250 },
  capabilities: { instanceRetrieve: 'seg-sr-only' },
});
```

What the client does:

- **Lists series with QIDO at series level** and reads metadata per series. It does not ask for a whole study.
- **Loads images as WADO-RS frames**, one image id for each instance. A UID that comes from a link or from your code is
  checked before it reaches a request path, so a bad one is refused rather than becoming a path.
- **Validates what the server says** (DICOM JSON) with Zod, so a malformed answer is an error with a message, not a
  half-drawn viewer.
- **Sorts a series by position** along its slice normal, and splits it into separate stacks when the orientation is
  mixed or positions repeat. Each series is told whether it can be reformatted into planes, and why not if it cannot.

### Tokens

`getRequestHeaders` is called synchronously for **every** request, including the frame requests Cornerstone makes
itself, so a token that rotates is always read fresh. After a 401, `onUnauthorized` runs once for all the requests
that failed at the same time, and then each is sent again once. Refresh the credentials inside it.

### Retries

A 5xx answer is tried again (default two more times, 250 ms and then twice that). **A 403 or a 404 is never tried
again**, and a second 401 after a refresh is an error: the viewer does not loop on a server that says no.

### Servers that limit what they hand out

Some servers (for example a proxy in front of a PACS) refuse whole-study and whole-series retrieval and serve images
as frames only. The viewer works with that: it needs frames for CT and MR images.

DICOM SEG and SR objects are different. They are not images, so the viewer needs the **whole instance**.
`capabilities.instanceRetrieve` says what the server allows:

| Value | Meaning |
|---|---|
| `'seg-sr-only'` (default) | The server hands out whole SEG and SR instances, but not other instances |
| `'all'` | Whole instances of any kind |
| `'none'` | No whole instances: loading a SEG fails with an error that names this setting |

The mock server in `tools/dicomweb-mock` has an `oncotrace-proxy` mode that reproduces such a server (whole-study
retrieval answers 403, frames are limited per request), and the installability matrix runs against it.

## Local files

```ts
import { createLocalFileDataSource } from '@tushar-im/dicom-viewer-core/local';

const dataSource = createLocalFileDataSource([...input.files]); // File[] from a picker or a drop
```

The headers are read when the study is first used; pixel data is read later, when a slice is shown. A file that is not
DICOM, is unreadable, or repeats an instance is skipped rather than failing the rest, and `await dataSource.skipped()`
lists them. `await dataSource.studyInstanceUIDs()` lists the studies found. The files stay on the machine: nothing is
uploaded. **Call the source's `dispose()` yourself** when you are done with it: destroying the viewer does not dispose its data source, so the source keeps its references to the files until you do.

## Your own source

A data source implements `getStudy` (the series of a study), `getSeries` (the instances, their metadata, and the image
ids to load), `getInstanceBytes` (one whole instance, used for SEG), and says what the server allows in `capabilities`. Read `DataSource` and `LoadedSeriesData` in the API reference and the
DICOMweb implementation (`packages/core/src/data/dicomweb.ts`) as a model.
