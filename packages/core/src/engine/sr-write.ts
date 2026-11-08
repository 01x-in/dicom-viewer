import { adaptersSR } from '@cornerstonejs/adapters';
import { metaData } from '@cornerstonejs/core';
import { data } from 'dcmjs';
import { z } from 'zod';
import type { SeriesInstance } from '../data/types';
import type { SrWriteInput, SrWriteMeasurement } from '../measurements/sr-write';
import { finishReport, labelFinding, TOOL_OF_TYPE } from './sr-finish';

const reportSchema = z.object({ dataset: z.record(z.string(), z.unknown()) });
const planeSchema = z.object({ frameOfReferenceUID: z.string().optional() });

/** The numbers the viewer holds, in the names the writer reads them by. A number that is not there stays out. */
function cachedStatsOf(measurement: SrWriteMeasurement): Record<string, unknown> {
  const { values } = measurement;
  switch (measurement.type) {
    case 'length':
      return { length: values.lengthMm, unit: 'mm' };
    case 'bidirectional':
      return { length: values.lengthMm, width: values.widthMm, unit: 'mm', widthUnit: 'mm' };
    case 'ellipse':
    case 'rectangle':
      return {
        area: values.areaMm2,
        areaUnit: 'mm2',
        mean: values.meanHu,
        stdDev: values.stdDevHu,
        min: values.minHu,
        max: values.maxHu,
        modalityUnit: 'HU',
      };
    case 'angle':
      return { angle: values.degrees };
    case 'probe':
      // The writer has no place for a probe's value. It is put in afterwards.
      return {};
  }
}

interface WriterEntry {
  readonly measurement: SrWriteMeasurement;
  readonly entry: Record<string, unknown>;
}

/**
 * What the writer asks of Cornerstone's metadata, from the instances themselves, so it does not
 * depend on what the registry holds: the instance, its class, and its frame. The geometry of the
 * image (which turns patient millimetres into pixels) comes from what Cornerstone knows, which the
 * caller has made sure of.
 */
function metadataProvider(instances: readonly SeriesInstance[]): {
  get(type: string, imageId: string): unknown;
} {
  const naturalized = new Map<string, Record<string, unknown>>();
  const byImage = new Map(instances.map((instance) => [instance.imageId, instance]));
  const datasetOf = (imageId: string): Record<string, unknown> | undefined => {
    const known = naturalized.get(imageId);
    if (known !== undefined) return known;
    const instance = byImage.get(imageId);
    if (instance === undefined) return undefined;
    const dataset: unknown = data.DicomMetaDictionary.naturalizeDataset({ ...instance.metadata });
    const parsed = z.record(z.string(), z.unknown()).parse(dataset);
    naturalized.set(imageId, parsed);
    return parsed;
  };
  return {
    get(type, imageId): unknown {
      switch (type) {
        case 'instance':
          return datasetOf(imageId);
        case 'sopCommonModule': {
          const dataset = datasetOf(imageId);
          return dataset === undefined
            ? undefined
            : { sopInstanceUID: dataset['SOPInstanceUID'], sopClassUID: dataset['SOPClassUID'] };
        }
        case 'frameNumber':
          return 1;
        default:
          return metaData.get(type, imageId);
      }
    },
  };
}

/**
 * Writes the measurements as a TID 1500 Structured Report, as the bytes of a DICOM file. Cornerstone's
 * writer makes the content, and `finishReport` mends what it gets wrong. The images the measurements
 * are on must be known to Cornerstone (the caller registers them). The patient and study are copied
 * from those images, so the file says who the patient is. Throws for a measurement on an image that
 * is not among `instances`.
 */
export function writeStructuredReport(input: SrWriteInput): ArrayBuffer {
  const provider = metadataProvider(input.instances);
  const imageIdBySop = new Map(
    input.instances.map((instance) => [instance.sopInstanceUID, instance.imageId]),
  );
  const toolState: Record<string, Record<string, { data: WriterEntry['entry'][] }>> = {};
  const entries: WriterEntry[] = [];
  const grouped = new Map<string, Map<string, SrWriteMeasurement[]>>();
  for (const measurement of input.measurements) {
    const imageId = imageIdBySop.get(measurement.sopInstanceUID);
    if (imageId === undefined) {
      throw new Error(`The measurement ${measurement.id} is on an image the report was not given.`);
    }
    const plane = planeSchema.safeParse(metaData.get('imagePlaneModule', imageId));
    const tool = TOOL_OF_TYPE[measurement.type];
    const entry: Record<string, unknown> = {
      data: {
        handles: { points: measurement.points },
        cachedStats: { [`imageId:${imageId}`]: cachedStatsOf(measurement) },
      },
      metadata: {
        referencedImageId: imageId,
        FrameOfReferenceUID: plane.success ? plane.data.frameOfReferenceUID : undefined,
      },
      finding:
        measurement.label === undefined || measurement.label === ''
          ? undefined
          : labelFinding(measurement.label),
      findingSites: [],
    };
    const byImage = (toolState[imageId] ??= {});
    (byImage[tool] ??= { data: [] }).data.push(entry);
    entries.push({ measurement, entry });
    const tools = grouped.get(imageId) ?? new Map<string, SrWriteMeasurement[]>();
    tools.set(tool, [...(tools.get(tool) ?? []), measurement]);
    grouped.set(imageId, tools);
  }
  // The order the writer makes its groups in: by image, then by kind of shape, as the keys are listed.
  const written: SrWriteMeasurement[] = [];
  for (const imageId of Object.keys(toolState)) {
    for (const tool of Object.keys(toolState[imageId] ?? {})) {
      written.push(...(grouped.get(imageId)?.get(tool) ?? []));
    }
  }
  const generated: unknown = adaptersSR.Cornerstone3D.MeasurementReport.generateReport(
    toolState,
    provider,
    {
      SeriesInstanceUID: input.seriesInstanceUID,
      SOPInstanceUID: input.sopInstanceUID,
      SeriesNumber: input.seriesNumber,
      SeriesDescription: input.seriesDescription,
      InstanceNumber: 1,
    },
  );
  const { dataset } = reportSchema.parse(generated);
  finishReport(dataset, {
    written,
    listOrder: input.measurements.map((measurement) => measurement.id),
    madeAt: input.madeAt,
  });
  return data.datasetToDict(dataset).write();
}
