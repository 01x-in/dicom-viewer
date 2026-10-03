import { elementTag } from './tags';
import { DvViewerElement } from './viewer-element';

const tag = elementTag('viewer');
if (!customElements.get(tag)) {
  customElements.define(tag, DvViewerElement);
}
