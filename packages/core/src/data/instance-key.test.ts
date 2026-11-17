import { describe, expect, it } from 'vitest';
import { instanceKey } from './instance-key';

describe('instanceKey', () => {
  it('takes the frame out of a DICOMweb image id and keeps the owner fragment', () => {
    expect(
      instanceKey('wadors:http://pacs/studies/1/series/2/instances/3/frames/40#dv-source-1'),
    ).toBe('wadors:http://pacs/studies/1/series/2/instances/3#dv-source-1');
  });

  it('gives every frame of one instance the same key', () => {
    const keys = [1, 2, 64].map((frame) =>
      instanceKey(`wadors:http://pacs/studies/1/series/2/instances/3/frames/${frame.toString()}#x`),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('keeps instances apart', () => {
    expect(instanceKey('wadors:http://p/instances/3/frames/1')).not.toBe(
      instanceKey('wadors:http://p/instances/4/frames/1'),
    );
  });

  it('takes the frame out of a local file image id', () => {
    expect(instanceKey('dicomfile:7?frame=12')).toBe('dicomfile:7');
    expect(instanceKey('dicomfile:7?frame=1')).toBe(instanceKey('dicomfile:7?frame=30'));
  });

  it('leaves an image id with no frame as it is', () => {
    expect(instanceKey('dicomfile:7')).toBe('dicomfile:7');
    expect(instanceKey('fake:series/0/1')).toBe('fake:series/0/1');
  });
});
