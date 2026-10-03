/** Prefix shared by every custom element the library defines, e.g. `<dv-viewer>`. */
export const ELEMENT_PREFIX = 'dv';

const ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Builds the prefixed custom element tag for a component name, e.g. `viewer` -> `dv-viewer`. */
export function elementTag(name: string): `${typeof ELEMENT_PREFIX}-${string}` {
  if (!ELEMENT_NAME.test(name)) {
    throw new Error(
      `Invalid element name "${name}". Use lowercase letters, digits, and single hyphens.`,
    );
  }
  return `${ELEMENT_PREFIX}-${name}`;
}
