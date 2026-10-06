import { describe, expect, it } from 'vitest';
import { fromEngineShape, toEngineShape } from '../measurements/mappers';
import type { Measurement, MeasurementType, Point3 } from '../measurements/model';
import {
  type AnnotationLike,
  HANDLE_COUNT,
  hydrateInputOf,
  shapeOfAnnotation,
} from './annotation-shape';

const IMAGE_IDS = new Map([
  ['wadors:a', 0],
  ['wadors:b', 1],
  ['wadors:c', 2],
]);

const TOOLS: ReadonlyMap<string, MeasurementType> = new Map([
  ['Length', 'length'],
  ['Bidirectional', 'bidirectional'],
  ['EllipticalROI', 'ellipse'],
  ['RectangleROI', 'rectangle'],
  ['Probe', 'probe'],
  ['Angle', 'angle'],
]);

const p = (x: number, y: number, z = 3): Point3 => [x, y, z];

function annotation(
  toolName: string,
  points: unknown,
  extra: { id?: string | undefined; imageId?: string | undefined } = {},
): AnnotationLike {
  return {
    annotationUID: 'id' in extra ? extra.id : 'uid-1',
    metadata: {
      toolName,
      referencedImageId: 'imageId' in extra ? extra.imageId : 'wadors:b',
    },
    data: { handles: { points } },
  };
}

describe('shapeOfAnnotation', () => {
  it.each([
    ['Length', 'length', [p(0, 0), p(1, 1)]],
    ['Bidirectional', 'bidirectional', [p(0, 0), p(4, 0), p(2, -1), p(2, 1)]],
    ['EllipticalROI', 'ellipse', [p(2, 1), p(2, -1), p(0, 0), p(4, 0)]],
    ['RectangleROI', 'rectangle', [p(0, 0), p(4, 0), p(0, 2), p(4, 2)]],
    ['Probe', 'probe', [p(7, 7)]],
    ['Angle', 'angle', [p(1, 0), p(0, 0), p(0, 1)]],
  ] as const)('reads a %s as a %s on the slice its image is', (toolName, type, points) => {
    expect(shapeOfAnnotation(annotation(toolName, points), IMAGE_IDS, TOOLS)).toEqual({
      id: 'uid-1',
      type,
      imageIndex: 1,
      points,
    });
  });

  it('copies the handles, so what Cornerstone changes afterwards does not change the shape', () => {
    const handles: [number, number, number][] = [
      [0, 0, 3],
      [1, 1, 3],
    ];
    const shape = shapeOfAnnotation(annotation('Length', handles), IMAGE_IDS, TOOLS);
    const first = handles[0];
    if (first !== undefined) first[0] = 99;
    expect(shape?.points[0]).toEqual([0, 0, 3]);
  });

  it('is undefined for an annotation on an image this stack does not have', () => {
    expect(
      shapeOfAnnotation(
        annotation('Length', [p(0, 0), p(1, 1)], { imageId: 'wadors:z' }),
        IMAGE_IDS,
        TOOLS,
      ),
    ).toBeUndefined();
    expect(
      shapeOfAnnotation(
        annotation('Length', [p(0, 0), p(1, 1)], { imageId: undefined }),
        IMAGE_IDS,
        TOOLS,
      ),
    ).toBeUndefined();
  });

  it('is undefined for a tool the viewer does not draw', () => {
    expect(
      shapeOfAnnotation(annotation('ArrowAnnotate', [p(0, 0), p(1, 1)]), IMAGE_IDS, TOOLS),
    ).toBeUndefined();
  });

  it('is undefined for an annotation with no id', () => {
    expect(
      shapeOfAnnotation(
        annotation('Length', [p(0, 0), p(1, 1)], { id: undefined }),
        IMAGE_IDS,
        TOOLS,
      ),
    ).toBeUndefined();
  });

  it('is undefined while the shape is not complete: an angle with two points', () => {
    expect(
      shapeOfAnnotation(annotation('Angle', [p(1, 0), p(0, 0)]), IMAGE_IDS, TOOLS),
    ).toBeUndefined();
  });

  it('is undefined for handles that are not points', () => {
    expect(shapeOfAnnotation(annotation('Length', undefined), IMAGE_IDS, TOOLS)).toBeUndefined();
    expect(shapeOfAnnotation(annotation('Length', 'nope'), IMAGE_IDS, TOOLS)).toBeUndefined();
    expect(
      shapeOfAnnotation(annotation('Length', [p(0, 0), [0, 0]]), IMAGE_IDS, TOOLS),
    ).toBeUndefined();
    expect(
      shapeOfAnnotation(annotation('Length', [p(0, 0), [0, Number.NaN, 0]]), IMAGE_IDS, TOOLS),
    ).toBeUndefined();
  });

  it('is undefined for an annotation without handles', () => {
    expect(
      shapeOfAnnotation(
        {
          annotationUID: 'x',
          metadata: { toolName: 'Length', referencedImageId: 'wadors:a' },
          data: {},
        },
        IMAGE_IDS,
        TOOLS,
      ),
    ).toBeUndefined();
  });
});

describe('hydrateInputOf', () => {
  const shape = (
    type: MeasurementType,
    points: Point3[],
  ): Parameters<typeof hydrateInputOf>[0] => ({
    id: 'x',
    type,
    imageIndex: 0,
    points,
  });

  it('gives the handles to every tool but the bidirectional one', () => {
    expect(hydrateInputOf(shape('length', [p(0, 0), p(1, 1)]))).toEqual({
      kind: 'handles',
      points: [p(0, 0), p(1, 1)],
    });
    expect(hydrateInputOf(shape('probe', [p(5, 5)]))).toEqual({
      kind: 'handles',
      points: [p(5, 5)],
    });
  });

  it('gives a bidirectional measurement its two axes: the long one first, as it was drawn', () => {
    expect(hydrateInputOf(shape('bidirectional', [p(0, 0), p(4, 0), p(2, -1), p(2, 1)]))).toEqual({
      kind: 'axes',
      axes: [
        [p(0, 0), p(4, 0)],
        [p(2, -1), p(2, 1)],
      ],
    });
  });

  it('is undefined for the wrong number of points', () => {
    expect(hydrateInputOf(shape('length', [p(0, 0)]))).toBeUndefined();
    expect(hydrateInputOf(shape('bidirectional', [p(0, 0), p(1, 1)]))).toBeUndefined();
    expect(hydrateInputOf(shape('angle', [p(0, 0), p(1, 1), p(2, 2), p(3, 3)]))).toBeUndefined();
  });

  it('gives copies, so the engine changing them does not change the measurement', () => {
    const original: Point3[] = [p(0, 0), p(1, 1)];
    const input = hydrateInputOf(shape('length', original));
    if (input?.kind === 'handles' && input.points[0] !== undefined) input.points[0][0] = 99;
    expect(original[0]).toEqual(p(0, 0));
  });
});

describe('HANDLE_COUNT', () => {
  it('is what each tool of Cornerstone ends up with', () => {
    expect(HANDLE_COUNT).toEqual({
      length: 2,
      bidirectional: 4,
      ellipse: 4,
      rectangle: 4,
      probe: 1,
      angle: 3,
    });
  });
});

describe('a measurement through the engine and back', () => {
  const reference = {
    studyInstanceUID: '1.2.3',
    seriesInstanceUID: '1.2.3.1',
    sopInstanceUID: '1.2.3.1.0.1',
  };
  const TOOL_OF: Readonly<Record<MeasurementType, string>> = {
    length: 'Length',
    bidirectional: 'Bidirectional',
    ellipse: 'EllipticalROI',
    rectangle: 'RectangleROI',
    probe: 'Probe',
    angle: 'Angle',
  };
  const measurements: readonly Measurement[] = [
    { id: 'a', type: 'length', reference, points: [p(0, 0), p(3, 4)] },
    { id: 'b', type: 'bidirectional', reference, points: [p(0, 0), p(10, 0), p(5, -2), p(5, 2)] },
    { id: 'c', type: 'ellipse', reference, points: [p(5, 2), p(5, -2), p(0, 0), p(10, 0)] },
    { id: 'd', type: 'rectangle', reference, points: [p(0, 0), p(10, 0), p(0, 4), p(10, 4)] },
    { id: 'e', type: 'probe', reference, points: [p(7, 2)] },
    { id: 'f', type: 'angle', reference, points: [p(1, 0), p(0, 0), p(0, 1)] },
  ];

  it.each(measurements)(
    'keeps a $type: what is drawn comes back as the same measurement',
    (measurement) => {
      // To the engine: the shape it is given, which `hydrate` turns into an annotation.
      const drawn = hydrateInputOf(toEngineShape(measurement, 1));
      expect(drawn).toBeDefined();
      const handles =
        drawn?.kind === 'axes' ? [...drawn.axes[0], ...drawn.axes[1]] : (drawn?.points ?? []);
      const annotationOfIt: AnnotationLike = {
        annotationUID: measurement.id,
        metadata: { toolName: TOOL_OF[measurement.type], referencedImageId: 'wadors:b' },
        data: { handles: { points: handles } },
      };
      // From the engine: what Cornerstone reports, as plain data, and then as a measurement.
      const reported = shapeOfAnnotation(annotationOfIt, IMAGE_IDS, TOOLS);
      expect(reported).toEqual(toEngineShape(measurement, 1));
      expect(reported && fromEngineShape(reported, reference)).toEqual(measurement);
    },
  );
});
