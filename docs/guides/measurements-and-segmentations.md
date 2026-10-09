# Measurements and segmentations

Both are kept by the viewer as plain data, whatever is on screen. The engine only draws a copy for the stacks that are
on screen, and gives it back when a stack goes away. So you can read and change them from code at any time, and they
survive a layout change.

## Measurements

The tools are length, bidirectional, ellipse, rectangle, probe, and angle. Choose one with
`viewer.tools.setActive('length')` (or the toolbar) and draw with the left mouse button.

A measurement is data: a `type`, a `reference` (the instance it is on) and `points` in **patient millimetres**
(DICOM patient coordinates), so it stays correct if the image is zoomed, panned, or shown in another viewport. The
statistics (mean, spread, minimum, maximum in Hounsfield units for the ellipse and the rectangle, and the value of a
probe) are read from the pixels when the image is on screen, and are within 0.5 HU of the truth on the phantom.

```ts
viewer.measurements.list();                       // every measurement, in the order they were made
viewer.measurements.list({ seriesInstanceUID });  // or those on one series (also: studyInstanceUID, sopInstanceUID)

await viewer.measurements.add({
  type: 'probe',
  reference: { studyInstanceUID, seriesInstanceUID, sopInstanceUID },
  points: [[-12.5, 4, 30]],
});

await viewer.measurements.update(id, { label: 'Lesion 1' });  // rename, or move the handles
await viewer.measurements.jumpTo(id);                         // show the image it is on
await viewer.measurements.remove(id);
```

Calls that can be wrong reject with a `RangeError` that says what (an id that is taken, points that do not fit the
type, an id that is not there). `add` and `update` wait for the viewer's queue, so they come after the calls made before
them.

### Saving and restoring

```ts
const document = viewer.measurements.exportJson();   // { format: 'measurements/v1', measurements: [...] }
localStorage.setItem('m', JSON.stringify(document));

await viewer.measurements.importJson(localStorage.getItem('m'), { mode: 'merge' }); // or 'replace'
```

`importJson` accepts the document or its JSON text, checks it with a schema, and is **all or nothing**: a document with
anything wrong in it adds nothing and rejects. A measurement with the same id is replaced under `merge`.

### Events

`measurement:added`, `measurement:updated`, `measurement:removed`, and `measurement:selected` come with an `origin`
(`user` for the mouse, `api` for your calls), so you can tell your own changes from the person's:

```ts
viewer.on('measurement:added', ({ measurement, origin }) => {
  if (origin === 'user') save(measurement);
});
```

## Segmentations (DICOM SEG)

A SEG is loaded against the series it names. It belongs to the study on screen, and goes when the study does.

```ts
const info = await viewer.segmentations.load(segSeriesInstanceUID);
// info.segments: [{ number, label, color, opacity, visible, voxelCount, imageCount, centroid }, ...]

await viewer.segmentations.setVisible(segSeriesInstanceUID, false);        // the whole SEG
await viewer.segmentations.setSegmentVisible(segSeriesInstanceUID, 2, false);
await viewer.segmentations.setSegmentColor(segSeriesInstanceUID, 2, '#ff7a00'); // or [255, 122, 0]
await viewer.segmentations.setSegmentOpacity(segSeriesInstanceUID, 2, 0.4);    // 0 to 1
await viewer.segmentations.setOpacity(segSeriesInstanceUID, 0.6);              // the whole SEG
```

What is drawn for a segment is its opacity times the opacity of the SEG. Visibility, colour, and opacity are the same
in every viewport, including one that is made later (and in a plane of a volume: see the layouts section of the README).

### Highlight and jump

```ts
await viewer.segmentations.highlight(uid, [2], { mode: 'dim-others' }); // or 'outline'
await viewer.segmentations.highlight(uid, undefined);                  // take it away

const where = await viewer.segmentations.jumpToSegment(uid, 2, { strategy: 'largestSlice' });
// strategies: 'largestSlice' (the image with most of the segment), 'centroid', 'nearestTo'
```

`jumpToSegment` shows an image in the series the SEG segments. It rejects for a segment that has no pixels. In an MPR
plane it moves the viewport to slices.

### Navigating from outside

`viewer.navigateTo` takes a SOP instance and, if you like, the SEGs to show and the segments to highlight, in one
call, so a host page can say "show this image with that lesion":

```ts
await viewer.navigateTo({
  seriesInstanceUID,
  sopInstanceUID,
  segmentations: [{ seriesInstanceUID: segUid, visible: true, highlightSegments: [3] }],
});
```

The image loads first and the rest of the series follows outward from it. A SEG that cannot be loaded is reported in
the result's `failedSegmentations` and does not stop the image from showing.

### When a SEG does not fit

A SEG that does not lie on the images it names is still drawn, with a `segmentation:warning` event (the Segments panel
shows the message). A SEG that cannot be read at all, or whose server does not hand out whole instances (see
[data sources](data-sources.md)), rejects from `load`.

Loading is fast enough for large SEGs: a binary SEG of 512 by 512 by 300 pixels with 100 segments decodes in a worker,
in about 2 seconds on a developer machine.
