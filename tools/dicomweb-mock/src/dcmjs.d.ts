// dcmjs ships no type declarations. This covers only the part the mock server uses.
declare module 'dcmjs' {
  export interface DicomJsonElement {
    vr: string;
    Value?: unknown[];
  }
  export type DicomJson = Record<string, DicomJsonElement>;

  export interface DicomMessageStatic {
    readFile(buffer: ArrayBuffer): { meta: DicomJson; dict: DicomJson };
  }

  export const data: { DicomMessage: DicomMessageStatic };
}
