import { describe, expect, it } from 'vitest';
import { buildSeries } from './series';
import type { DicomJsonInstance } from './types';

const STUDY = '1.2.3';
const SERIES = '1.2.3.4';
const AXIAL = [1, 0, 0, 0, 1, 0];
const CORONAL = [1, 0, 0, 0, 0, -1];

interface Spec {
  sop: string;
  position?: [number, number, number];
  orientation?: number[];
  number?: number;
  modality?: string;
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number] | 'none';
  frames?: number;
}

function dicom(spec: Spec): DicomJsonInstance {
  const instance: DicomJsonInstance = {
    '00080018': { vr: 'UI', Value: [spec.sop] },
    '00080060': { vr: 'CS', Value: [spec.modality ?? 'CT'] },
    '00280010': { vr: 'US', Value: [spec.rows ?? 128] },
    '00280011': { vr: 'US', Value: [spec.columns ?? 128] },
  };
  if (spec.pixelSpacing !== 'none') {
    instance['00280030'] = { vr: 'DS', Value: spec.pixelSpacing ?? [1, 1] };
  }
  if (spec.number !== undefined) instance['00200013'] = { vr: 'IS', Value: [spec.number] };
  if (spec.position !== undefined) instance['00200032'] = { vr: 'DS', Value: spec.position };
  // Geometry is all or nothing in these fixtures: a position brings an orientation (axial unless given).
  if (spec.position !== undefined || spec.orientation !== undefined) {
    instance['00200037'] = { vr: 'DS', Value: spec.orientation ?? AXIAL };
  }
  if (spec.frames !== undefined) instance['00280008'] = { vr: 'IS', Value: [spec.frames] };
  return instance;
}

function build(specs: Spec[]): ReturnType<typeof buildSeries> {
  return buildSeries({
    studyInstanceUID: STUDY,
    seriesInstanceUID: SERIES,
    metadata: specs.map(dicom),
    imageIdFor: (sop) => `test:${sop}`,
  });
}

function axial(count: number, step = 2): Spec[] {
  return Array.from({ length: count }, (_, index) => ({
    sop: `s${index.toString()}`,
    position: [0, 0, index * step] as [number, number, number],
    number: index + 1,
  }));
}

const sops = (series: ReturnType<typeof buildSeries>, stack = 0): string[] =>
  series.stacks[stack]?.instances.map((instance) => instance.sopInstanceUID) ?? [];

describe('buildSeries', () => {
  it('describes the series from its first instance', () => {
    const series = buildSeries({
      studyInstanceUID: STUDY,
      seriesInstanceUID: SERIES,
      metadata: [
        { ...dicom({ sop: 'a', position: [0, 0, 0] }), '0008103E': { vr: 'LO', Value: ['Chest'] } },
      ],
      imageIdFor: (sop) => `test:${sop}`,
    });
    expect(series).toMatchObject({
      studyInstanceUID: STUDY,
      seriesInstanceUID: SERIES,
      modality: 'CT',
      description: 'Chest',
    });
  });

  it('sorts slices by position along the slice normal, not by instance number', () => {
    const series = build([
      { sop: 'c', position: [0, 0, 20], number: 1 },
      { sop: 'a', position: [0, 0, 0], number: 3 },
      { sop: 'b', position: [0, 0, 10], number: 2 },
    ]);
    expect(sops(series)).toEqual(['a', 'b', 'c']);
    expect(series.stacks[0]?.imageIds).toEqual(['test:a', 'test:b', 'test:c']);
  });

  it('keeps every instance, in instance-number order, apart from the stacks', () => {
    const series = build([
      { sop: 'c', position: [0, 0, 20], number: 1 },
      { sop: 'a', position: [0, 0, 0], number: 3 },
    ]);
    expect(series.instances.map((instance) => instance.sopInstanceUID)).toEqual(['c', 'a']);
  });

  it('follows the normal of a flipped series', () => {
    // Rows along +x and columns along -y make the normal -z.
    const flipped = [1, 0, 0, 0, -1, 0];
    const series = build([
      { sop: 'low', position: [0, 0, 0], orientation: flipped },
      { sop: 'high', position: [0, 0, 10], orientation: flipped },
    ]);
    expect(sops(series)).toEqual(['high', 'low']);
  });

  it('accepts DS and IS values encoded as strings, as DICOM JSON permits', () => {
    const asStrings = (sop: string, z: number): DicomJsonInstance => ({
      ...dicom({ sop }),
      '00200032': { vr: 'DS', Value: ['0', '0', String(z)] },
      '00200037': { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] },
      '00200013': { vr: 'IS', Value: [String(z)] },
    });
    const series = buildSeries({
      studyInstanceUID: STUDY,
      seriesInstanceUID: SERIES,
      metadata: [asStrings('c', 20), asStrings('a', 0), asStrings('b', 10)],
      imageIdFor: (sop) => `test:${sop}`,
    });
    expect(sops(series)).toEqual(['a', 'b', 'c']);
    expect(series.stacks[0]?.instances.map((instance) => instance.instanceNumber)).toEqual([
      0, 10, 20,
    ]);
  });

  describe('splitting', () => {
    it('splits a series with mixed orientations into one stack per orientation, largest first', () => {
      const series = build([
        { sop: 'cor0', position: [0, 0, 0], orientation: CORONAL },
        { sop: 'ax0', position: [0, 0, 0] },
        { sop: 'ax1', position: [0, 0, 2] },
        { sop: 'ax2', position: [0, 0, 4] },
      ]);
      expect(series.stacks).toHaveLength(2);
      expect(sops(series, 0)).toEqual(['ax0', 'ax1', 'ax2']);
      expect(sops(series, 1)).toEqual(['cor0']);
      expect(series.stacks.map((stack) => stack.index)).toEqual([0, 1]);
    });

    it('splits repeated positions into layers, as a multi-phase or dual-energy series has', () => {
      const series = build([
        { sop: 'a0', position: [0, 0, 0], number: 1 },
        { sop: 'b0', position: [0, 0, 0], number: 2 },
        { sop: 'a1', position: [0, 0, 2], number: 3 },
        { sop: 'b1', position: [0, 0, 2], number: 4 },
        { sop: 'a2', position: [0, 0, 4], number: 5 },
        { sop: 'b2', position: [0, 0, 4], number: 6 },
      ]);
      expect(series.stacks).toHaveLength(2);
      expect(new Set([...sops(series, 0), ...sops(series, 1)]).size).toBe(6);
      // Within each layer the slices still run along the normal.
      for (const stack of series.stacks) {
        const z = stack.instances.map((instance) => instance.sopInstanceUID.slice(1));
        expect(z).toEqual(['0', '1', '2']);
      }
    });

    it('treats positions that differ by less than a hundredth of a millimetre as repeated', () => {
      const series = build([
        { sop: 'a', position: [0, 0, 0] },
        { sop: 'b', position: [0, 0, 0.004] },
      ]);
      expect(series.stacks).toHaveLength(2);
    });

    it('puts an instance without a position into a geometry-less stack of its own', () => {
      const series = build([
        { sop: 'a', position: [0, 0, 0] },
        { sop: 'b', position: [0, 0, 2] },
        { sop: 'c', position: [0, 0, 4] },
        { sop: 'lost', number: 9 },
      ]);
      expect(sops(series, 0)).toEqual(['a', 'b', 'c']);
      expect(sops(series, 1)).toEqual(['lost']);
      expect(series.stacks[1]?.reconstructable).toEqual({ ok: false, reason: 'missing-geometry' });
    });
  });

  describe('reconstructability', () => {
    it('is ok for a uniform stack, and reports the spacing', () => {
      expect(build(axial(5, 2.5)).stacks[0]?.reconstructable).toEqual({ ok: true, spacingMm: 2.5 });
    });

    it('is not for a series without geometry, which is ordered by instance number', () => {
      const series = build([
        { sop: 'b', number: 2 },
        { sop: 'a', number: 1 },
        { sop: 'c', number: 3 },
      ]);
      expect(sops(series)).toEqual(['a', 'b', 'c']);
      expect(series.stacks[0]?.reconstructable).toEqual({ ok: false, reason: 'missing-geometry' });
    });

    it('is not with fewer than three slices', () => {
      expect(build(axial(2)).stacks[0]?.reconstructable).toEqual({
        ok: false,
        reason: 'too-few-slices',
      });
    });

    it('is not when slices differ in size or pixel spacing', () => {
      const specs = axial(4);
      expect(
        build(specs.map((spec, index) => (index === 2 ? { ...spec, rows: 256 } : spec))).stacks[0]
          ?.reconstructable,
      ).toEqual({ ok: false, reason: 'inconsistent-image-size' });
      expect(
        build(
          specs.map((spec, index) => (index === 1 ? { ...spec, pixelSpacing: [1, 0.5] } : spec)),
        ).stacks[0]?.reconstructable,
      ).toEqual({ ok: false, reason: 'inconsistent-image-size' });
    });

    it('is not when no slice says its pixel spacing, since there is no in-plane scale', () => {
      const specs = axial(4).map((spec) => ({ ...spec, pixelSpacing: 'none' as const }));
      expect(build(specs).stacks[0]?.reconstructable).toEqual({
        ok: false,
        reason: 'missing-pixel-spacing',
      });
    });

    it('is not for a gantry tilt, where slices are offset along a direction that is not the normal', () => {
      const tilted = Array.from({ length: 4 }, (_, index) => ({
        sop: `t${index.toString()}`,
        position: [0, index * 0.5, index * 2] as [number, number, number],
      }));
      expect(build(tilted).stacks[0]?.reconstructable).toEqual({ ok: false, reason: 'tilted' });
    });

    it('is not when the spacing is not uniform', () => {
      const uneven = [0, 2, 4, 9].map((z, index) => ({
        sop: `u${index.toString()}`,
        position: [0, 0, z] as [number, number, number],
      }));
      expect(build(uneven).stacks[0]?.reconstructable).toEqual({
        ok: false,
        reason: 'non-uniform-spacing',
      });
    });

    it('tolerates the rounding of DS values (a 1% spacing wobble)', () => {
      const wobbly = [0, 2.01, 3.99, 6].map((z, index) => ({
        sop: `w${index.toString()}`,
        position: [0, 0, z] as [number, number, number],
      }));
      expect(build(wobbly).stacks[0]?.reconstructable.ok).toBe(true);
    });
  });

  describe('what is displayable', () => {
    it('gives a SEG series no stacks, but keeps its instances for retrieval', () => {
      const series = build([{ sop: 'seg1', modality: 'SEG', frames: 64 }]);
      expect(series.modality).toBe('SEG');
      expect(series.stacks).toEqual([]);
      expect(series.instances.map((instance) => instance.sopInstanceUID)).toEqual(['seg1']);
    });

    it('does not refuse a multi-frame image series any more', () => {
      expect(() => build([{ sop: 'mf', frames: 40 }])).not.toThrow();
    });

    it('rejects a NumberOfFrames that is not a whole number from 1', () => {
      expect(() => build([{ sop: 'mf', frames: 0 }])).toThrow(/NumberOfFrames/);
      expect(() => build([{ sop: 'mf', frames: 2.5 }])).toThrow(/NumberOfFrames/);
    });
  });

  describe('single-frame instances', () => {
    it('are one image each, frame 1 of 1, with the metadata they came with', () => {
      const specs = axial(3);
      const metadata = specs.map(dicom);
      const calls: [string, number][] = [];
      const series = buildSeries({
        studyInstanceUID: STUDY,
        seriesInstanceUID: SERIES,
        metadata,
        imageIdFor: (sop, _metadata, frame) => {
          calls.push([sop, frame]);
          return `test:${sop}`;
        },
      });
      const [stack] = series.stacks;
      expect(stack?.instances.map((i) => [i.frameNumber, i.frameCount])).toEqual([
        [1, 1],
        [1, 1],
        [1, 1],
      ]);
      expect(stack?.instances.map((i) => i.metadata)).toEqual(metadata);
      expect(stack?.imageIds).toEqual(['test:s0', 'test:s1', 'test:s2']);
      expect(calls).toEqual([
        ['s0', 1],
        ['s1', 1],
        ['s2', 1],
      ]);
      expect(series.instances).toHaveLength(3);
    });

    it('treat NumberOfFrames of 1 as a single frame', () => {
      const series = build([{ sop: 'one', frames: 1, position: [0, 0, 0] }]);
      expect(series.stacks[0]?.instances.map((i) => i.frameCount)).toEqual([1]);
    });
  });

  describe('multi-frame instances', () => {
    const seq = (...items: DicomJsonInstance[]): { vr: string; Value: DicomJsonInstance[] } => ({
      vr: 'SQ',
      Value: items,
    });

    /** An enhanced instance: orientation and spacing shared, a position for each frame. */
    function enhanced(
      sop: string,
      zs: readonly number[],
      options: { orientation?: number[]; number?: number } = {},
    ): DicomJsonInstance {
      return {
        '00080018': { vr: 'UI', Value: [sop] },
        '00080060': { vr: 'CS', Value: ['CT'] },
        '00280008': { vr: 'IS', Value: [zs.length] },
        '00280010': { vr: 'US', Value: [128] },
        '00280011': { vr: 'US', Value: [128] },
        ...(options.number === undefined
          ? {}
          : { '00200013': { vr: 'IS', Value: [options.number] } }),
        '52009229': seq({
          '00209116': seq({ '00200037': { vr: 'DS', Value: options.orientation ?? AXIAL } }),
          '00289110': seq({ '00280030': { vr: 'DS', Value: [1, 1] } }),
        }),
        '52009230': seq(
          ...zs.map((z) => ({
            '00209113': seq({ '00200032': { vr: 'DS', Value: [0, 0, z] } }),
          })),
        ),
      };
    }

    function buildEnhanced(
      metadata: DicomJsonInstance[],
      calls: [string, number][] = [],
    ): ReturnType<typeof buildSeries> {
      return buildSeries({
        studyInstanceUID: STUDY,
        seriesInstanceUID: SERIES,
        metadata,
        imageIdFor: (sop, _metadata, frame) => {
          calls.push([sop, frame]);
          return `test:${sop}/${frame.toString()}`;
        },
      });
    }

    it('become one image for each frame, sorted by the position the frame says', () => {
      const calls: [string, number][] = [];
      // Frames stored top-down: the stack still runs from the lowest position up.
      const series = buildEnhanced([enhanced('mf', [6, 4, 2, 0])], calls);
      expect(series.stacks).toHaveLength(1);
      const [stack] = series.stacks;
      expect(stack?.instances.map((i) => i.frameNumber)).toEqual([4, 3, 2, 1]);
      expect(stack?.instances.every((i) => i.sopInstanceUID === 'mf' && i.frameCount === 4)).toBe(
        true,
      );
      expect(stack?.imageIds).toEqual(['test:mf/4', 'test:mf/3', 'test:mf/2', 'test:mf/1']);
      // One id for each frame, asked in frame order, whatever the order they end up in.
      expect(calls).toEqual([
        ['mf', 1],
        ['mf', 2],
        ['mf', 3],
        ['mf', 4],
      ]);
    });

    it('can be reformatted when the frames are even and parallel', () => {
      const [stack] = buildEnhanced([enhanced('mf', [0, 2, 4, 6, 8])]).stacks;
      expect(stack?.reconstructable).toEqual({ ok: true, spacingMm: 2 });
    });

    it('say why they cannot be reformatted when the spacing is uneven', () => {
      const [stack] = buildEnhanced([enhanced('mf', [0, 2, 4, 9])]).stacks;
      expect(stack?.reconstructable).toEqual({ ok: false, reason: 'non-uniform-spacing' });
    });

    it('give each frame the geometry it says, as a single-frame instance would have', () => {
      const [stack] = buildEnhanced([enhanced('mf', [0, 2.5, 5])]).stacks;
      const frame = stack?.instances[1];
      expect(frame?.metadata['00200032']?.Value).toEqual([0, 0, 2.5]);
      expect(frame?.metadata['00200037']?.Value).toEqual(AXIAL);
      expect(frame?.metadata['52009230']).toBeUndefined();
      expect(frame?.metadata['52009229']).toBeUndefined();
    });

    it('keep the real instance in `instances`, once, for retrieval', () => {
      const series = buildEnhanced([enhanced('mf', [0, 2, 4])]);
      expect(series.instances.map((i) => [i.sopInstanceUID, i.frameCount])).toEqual([['mf', 3]]);
    });

    it('put frames at the same positions into layers, as repeated slices are', () => {
      const series = buildEnhanced([enhanced('a', [0, 2, 4]), enhanced('b', [0, 2, 4])]);
      expect(series.stacks).toHaveLength(2);
      expect(series.stacks.map((s) => s.instances.map((i) => i.sopInstanceUID))).toEqual([
        ['a', 'a', 'a'],
        ['b', 'b', 'b'],
      ]);
    });

    it('mix with single-frame instances of the same plane in one stack', () => {
      const series = buildEnhanced([
        enhanced('mf', [0, 2]),
        dicom({ sop: 'single', position: [0, 0, 4] }),
      ]);
      expect(series.stacks).toHaveLength(1);
      expect(series.stacks[0]?.instances.map((i) => [i.sopInstanceUID, i.frameNumber])).toEqual([
        ['mf', 1],
        ['mf', 2],
        ['single', 1],
      ]);
    });

    it('keep frames with no geometry in frame order, in a stack that cannot be reformatted', () => {
      const series = buildEnhanced([dicom({ sop: 'loop', frames: 5 })]);
      expect(series.stacks).toHaveLength(1);
      const [stack] = series.stacks;
      expect(stack?.instances.map((i) => i.frameNumber)).toEqual([1, 2, 3, 4, 5]);
      expect(stack?.reconstructable).toEqual({ ok: false, reason: 'missing-geometry' });
    });

    it('order two loops by instance number, then by frame', () => {
      const series = buildEnhanced([
        dicom({ sop: 'second', frames: 2, number: 2 }),
        dicom({ sop: 'first', frames: 2, number: 1 }),
      ]);
      expect(series.stacks[0]?.instances.map((i) => [i.sopInstanceUID, i.frameNumber])).toEqual([
        ['first', 1],
        ['first', 2],
        ['second', 1],
        ['second', 2],
      ]);
    });

    it('do not expand a SEG, which has frames of its own that are not images', () => {
      const series = buildEnhanced([dicom({ sop: 'seg', modality: 'SEG', frames: 64 })]);
      expect(series.stacks).toEqual([]);
      expect(series.instances).toHaveLength(1);
    });
  });
});
