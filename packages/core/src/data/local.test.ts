import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataSourceError } from './errors';
import { getLocalFile } from './local-files';
import { createLocalFileDataSource } from './local';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));

function phantomFiles(directory: string): File[] {
  const folder = join(PHANTOM, directory);
  return readdirSync(folder)
    .filter((name) => name.endsWith('.dcm'))
    .sort()
    .map((name) => new File([readFileSync(join(folder, name))], `${directory}-${name}`));
}

const ALL = [
  ...phantomFiles('ct-j2k'),
  ...phantomFiles('ct-evrle'),
  ...phantomFiles('seg-body-bone'),
];

async function open(files: File[] = ALL): Promise<{
  source: ReturnType<typeof createLocalFileDataSource>;
  study: string;
}> {
  const source = createLocalFileDataSource(files);
  const [study] = await source.studyInstanceUIDs();
  if (study === undefined) throw new Error('no study');
  return { source, study };
}

describe('createLocalFileDataSource', () => {
  it('finds the one phantom study among the files', async () => {
    const { source, study } = await open();
    expect(await source.studyInstanceUIDs()).toEqual([study]);
  });

  it('lists the series of the study with modality, description, and instance count', async () => {
    const { source, study } = await open();
    const { series } = await source.getStudy(study);
    expect(series.map((item) => [item.modality, item.instanceCount]).sort()).toEqual([
      ['CT', 64],
      ['CT', 64],
      ['SEG', 1],
    ]);
    expect(series.every((item) => item.description !== undefined)).toBe(true);
  });

  it('builds one reconstructable 64-slice stack for a CT series, sorted along the normal', async () => {
    const { source, study } = await open();
    const { series } = await source.getStudy(study);
    const ct = series.find((item) => item.modality === 'CT');
    if (ct === undefined) throw new Error('no CT series');

    const loaded = await source.getSeries(study, ct.seriesInstanceUID);

    expect(loaded.stacks).toHaveLength(1);
    const [stack] = loaded.stacks;
    expect(stack?.imageIds).toHaveLength(64);
    expect(stack?.imageIds.every((id) => /^dicomfile:\d+$/.test(id))).toBe(true);
    expect(stack?.reconstructable.ok).toBe(true);
    const positions = stack?.instances.map(
      (instance) =>
        (instance.metadata['00200032']?.Value as number[] | undefined)?.[2] ?? Number.NaN,
    );
    expect(positions).toEqual([...(positions ?? [])].sort((a, b) => a - b));
  });

  it('points every image id at its own file', async () => {
    const { source, study } = await open(phantomFiles('ct-evrle'));
    const [first] = (await source.getStudy(study)).series;
    if (first === undefined) throw new Error('no series');
    const loaded = await source.getSeries(study, first.seriesInstanceUID);
    const files = loaded.stacks[0]?.imageIds.map((id) => getLocalFile(id)?.name);
    expect(new Set(files).size).toBe(64);
    expect(files?.every((name) => name?.startsWith('ct-evrle-'))).toBe(true);
  });

  it('gives a SEG series no stacks, and returns its file bytes for retrieval', async () => {
    const { source, study } = await open();
    const { series } = await source.getStudy(study);
    const seg = series.find((item) => item.modality === 'SEG');
    if (seg === undefined) throw new Error('no SEG series');

    const loaded = await source.getSeries(study, seg.seriesInstanceUID);
    expect(loaded.stacks).toEqual([]);
    const [instance] = loaded.instances;
    if (instance === undefined) throw new Error('no SEG instance');

    const bytes = await source.getInstanceBytes(
      study,
      seg.seriesInstanceUID,
      instance.sopInstanceUID,
      'SEG',
    );
    const original = readFileSync(join(PHANTOM, 'seg-body-bone', '0001.dcm'));
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(original));
  });

  it('allows whole-instance retrieval of any modality, since the bytes are already local', async () => {
    const { source } = await open();
    expect(source.capabilities).toEqual({ instanceRetrieve: 'all' });
    expect(source.frameRequests).toBeUndefined();
  });

  it('skips files that are not DICOM, and says which and why', async () => {
    const files = [
      new File(['hello'], 'notes.txt'),
      new File([new Uint8Array(200)], 'empty.dcm'),
      ...phantomFiles('ct-evrle'),
    ];
    const { source, study } = await open(files);

    expect((await source.getStudy(study)).series).toHaveLength(1);
    const skipped = await source.skipped();
    expect(skipped.map((entry) => entry.name).sort()).toEqual(['empty.dcm', 'notes.txt']);
    expect(skipped.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('skips a second copy of an instance', async () => {
    const files = phantomFiles('ct-evrle');
    const [first] = files;
    if (first === undefined) throw new Error('no files');
    const { source, study } = await open([
      ...files,
      new File([await first.arrayBuffer()], 'copy.dcm'),
    ]);

    const [series] = (await source.getStudy(study)).series;
    expect(series?.instanceCount).toBe(64);
    expect((await source.skipped()).map((entry) => entry.name)).toEqual(['copy.dcm']);
  });

  it('rejects when none of the files is DICOM', async () => {
    const source = createLocalFileDataSource([new File(['x'], 'a.txt')]);
    await expect(source.studyInstanceUIDs()).resolves.toEqual([]);
    await expect(source.getStudy('1.2.3')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a study or series it does not have', async () => {
    const { source, study } = await open();
    await expect(source.getStudy('1.2.3')).rejects.toMatchObject({ status: 404 });
    await expect(source.getSeries(study, '1.2.3')).rejects.toMatchObject({ status: 404 });
    await expect(source.getInstanceBytes(study, '1.2.3', '1.2.3.4', 'CT')).rejects.toBeInstanceOf(
      DataSourceError,
    );
  });

  it('refuses malformed UIDs like the DICOMweb source does', async () => {
    const { source } = await open(phantomFiles('ct-evrle'));
    await expect(source.getStudy('../x')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('dispose() releases the files', async () => {
    const { source, study } = await open(phantomFiles('ct-evrle'));
    const [first] = (await source.getStudy(study)).series;
    if (first === undefined) throw new Error('no series');
    const loaded = await source.getSeries(study, first.seriesInstanceUID);
    const ids = loaded.stacks[0]?.imageIds ?? [];
    expect(getLocalFile(ids[0] ?? '')).toBeDefined();

    source.dispose();

    expect(ids.every((id) => getLocalFile(id) === undefined)).toBe(true);
  });
});
