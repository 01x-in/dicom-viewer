// dcmjs ships no types. This is the part of it the engine uses, to read a DICOM file into the
// named form the Cornerstone adapters take, and to write one in the tests.
declare module 'dcmjs' {
  export interface DicomDict {
    readonly dict: Record<string, unknown>;
    write(): ArrayBuffer;
  }
  export const data: {
    readonly DicomMessage: { readFile(buffer: ArrayBuffer): DicomDict };
    readonly DicomMetaDictionary: {
      naturalizeDataset(dict: Record<string, unknown>): Record<string, unknown>;
    };
    datasetToDict(dataset: unknown): DicomDict;
  };
}
