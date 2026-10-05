import { DvSeriesBrowserElement } from './series-browser';
import { elementTag } from './tags';
import { DvToolbarElement } from './toolbar';
import { DvViewerElement } from './viewer-element';

function define(name: string, constructor: CustomElementConstructor): void {
  const tag = elementTag(name);
  if (!customElements.get(tag)) customElements.define(tag, constructor);
}

define('viewer', DvViewerElement);
define('toolbar', DvToolbarElement);
define('series-browser', DvSeriesBrowserElement);
