import {
  addTool,
  AngleTool,
  BidirectionalTool,
  CrosshairsTool,
  Enums,
  EllipticalROITool,
  init as initTools,
  LengthTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import type { MeasurementType } from '../measurements/model';
import type { MprOrientation } from '../mpr';
import { DEFAULT_PRIMARY_TOOL, isMeasureTool, PRIMARY_TOOLS, type PrimaryTool } from '../tools';

/**
 * The tool classes the v1 viewer will use. Referencing them all keeps the recorded bundle size
 * honest (tree-shaking would otherwise drop everything that is never named). Crosshairs wait for
 * M7.
 */
const V1_TOOLS = [
  StackScrollTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  ProbeTool,
  AngleTool,
  CrosshairsTool,
] as const;

/** Cornerstone types `toolName` as `any`; check it instead of trusting it. */
function nameOf(tool: { readonly toolName: unknown }): string {
  if (typeof tool.toolName !== 'string') throw new TypeError('A Cornerstone tool has no toolName.');
  return tool.toolName;
}

export function registerTools(): void {
  initTools();
  for (const tool of V1_TOOLS) addTool(tool);
}

const TOOL_NAMES: Readonly<Record<PrimaryTool, string>> = {
  'window-level': nameOf(WindowLevelTool),
  pan: nameOf(PanTool),
  zoom: nameOf(ZoomTool),
  'stack-scroll': nameOf(StackScrollTool),
  crosshairs: nameOf(CrosshairsTool),
  length: nameOf(LengthTool),
  bidirectional: nameOf(BidirectionalTool),
  ellipse: nameOf(EllipticalROITool),
  rectangle: nameOf(RectangleROITool),
  probe: nameOf(ProbeTool),
  angle: nameOf(AngleTool),
};

/** The measurement a Cornerstone tool draws, by the tool's name. */
export const MEASUREMENT_OF_TOOL: ReadonlyMap<string, MeasurementType> = new Map(
  PRIMARY_TOOLS.flatMap(({ id }) => (isMeasureTool(id) ? [[TOOL_NAMES[id], id] as const] : [])),
);

export function toolNameOf(type: MeasurementType): string {
  return TOOL_NAMES[type];
}

/** What each tool answers to whatever the left button drives: middle pans, right zooms, the wheel scrolls. */
const FIXED_BUTTONS: Readonly<Record<PrimaryTool, readonly Enums.MouseBindings[]>> = {
  'window-level': [],
  pan: [Enums.MouseBindings.Auxiliary],
  zoom: [Enums.MouseBindings.Secondary],
  'stack-scroll': [Enums.MouseBindings.Wheel],
  // The left button, only while it is the tool in use.
  crosshairs: [],
  // A measurement tool has the left button when it is chosen, and nothing else.
  length: [],
  bidirectional: [],
  ellipse: [],
  rectangle: [],
  probe: [],
  angle: [],
};

export interface StackTools {
  /** Makes the left mouse button drive `tool`. */
  setPrimary(tool: PrimaryTool): void;
  detach(): void;
}

/** What a plane of a volume can be driven by. Shapes are drawn on slices, so those tools are not here. */
const VOLUME_TOOLS: ReadonlySet<PrimaryTool> = new Set<PrimaryTool>([
  'window-level',
  'pan',
  'zoom',
  'stack-scroll',
  'crosshairs',
]);

type Group = NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;

/** Adds the tools, and gives each the buttons it keeps whatever the left button drives. */
function equip(group: Group, usable: readonly PrimaryTool[]): void {
  for (const id of usable) group.addTool(TOOL_NAMES[id]);
  // Set once: Cornerstone adds the bindings it is given to the ones a tool has, so they would only pile up.
  for (const id of usable) {
    const buttons = FIXED_BUTTONS[id];
    if (buttons.length > 0) {
      group.setToolActive(TOOL_NAMES[id], {
        bindings: buttons.map((mouseButton) => ({ mouseButton })),
      });
    }
  }
}

/** Makes the left button drive `primary`, and every other tool give it up. */
function drivePrimary(group: Group, usable: readonly PrimaryTool[], primary: PrimaryTool): void {
  for (const id of usable) {
    // Passive takes the left button away from a tool and leaves its other buttons. Crosshairs have
    // no other buttons, and draw their lines whenever they are not disabled, so they are switched off.
    if (id === 'crosshairs') group.setToolDisabled(TOOL_NAMES[id]);
    else group.setToolPassive(TOOL_NAMES[id]);
  }
  group.setToolActive(TOOL_NAMES[primary], {
    bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
  });
}

/** Tools for one stack of slices: its own tool group. */
export function attachStackTools(renderingEngineId: string, viewportId: string): StackTools {
  const groupId = `${viewportId}-tools`;
  const group = ToolGroupManager.createToolGroup(groupId);
  if (group === undefined) throw new Error(`Could not create tool group ${groupId}.`);
  const usable = PRIMARY_TOOLS.map(({ id }) => id).filter((id) => id !== 'crosshairs');
  equip(group, usable);
  group.addViewport(viewportId, renderingEngineId);
  const setPrimary = (wanted: PrimaryTool): void => {
    // Crosshairs link planes of a volume; on slices the left button stays on window / level.
    drivePrimary(group, usable, wanted === 'crosshairs' ? DEFAULT_PRIMARY_TOOL : wanted);
  };
  setPrimary(DEFAULT_PRIMARY_TOOL);
  return {
    setPrimary,
    detach(): void {
      ToolGroupManager.destroyToolGroup(groupId);
    },
  };
}

/** The lines of the crosshairs in each plane, so a person can tell which line belongs to which view. */
const PLANE_COLOURS: Readonly<Record<MprOrientation, string>> = {
  axial: 'rgb(230, 70, 70)',
  sagittal: 'rgb(240, 200, 60)',
  coronal: 'rgb(70, 200, 90)',
};

interface VolumeGroup {
  readonly group: Group;
  readonly usable: readonly PrimaryTool[];
  readonly viewports: Map<string, MprOrientation>;
  primary: PrimaryTool;
}

/** One tool group for all the planes of a volume, because crosshairs link the viewports of a group. */
const volumeGroups = new Map<string, VolumeGroup>();

/**
 * Tools for a plane of a volume. The planes of one volume share a tool group, so crosshairs can
 * link them. Shape tools are not here: shapes are drawn on slices, so with one chosen the left
 * button stays on window / level.
 */
export function attachVolumeTools(
  renderingEngineId: string,
  viewportId: string,
  volumeId: string,
  orientation: MprOrientation,
): StackTools {
  const groupId = `${renderingEngineId}-${volumeId}-tools`;
  let entry = volumeGroups.get(groupId);
  if (entry === undefined) {
    const group = ToolGroupManager.createToolGroup(groupId);
    if (group === undefined) throw new Error(`Could not create tool group ${groupId}.`);
    const usable = PRIMARY_TOOLS.map(({ id }) => id).filter((id) => VOLUME_TOOLS.has(id));
    equip(group, usable);
    group.setToolConfiguration(TOOL_NAMES.crosshairs, {
      getReferenceLineColor: (id: string): string =>
        PLANE_COLOURS[entry?.viewports.get(id) ?? 'axial'],
      // The lines show where the other planes are; dragging one moves the slice of that plane.
      getReferenceLineControllable: () => true,
      getReferenceLineDraggableRotatable: () => false,
      getReferenceLineSlabThicknessControlsOn: () => false,
    });
    entry = { group, usable, viewports: new Map(), primary: DEFAULT_PRIMARY_TOOL };
    volumeGroups.set(groupId, entry);
    drivePrimary(group, usable, DEFAULT_PRIMARY_TOOL);
  }
  const joined = entry;
  joined.viewports.set(viewportId, orientation);
  joined.group.addViewport(viewportId, renderingEngineId);
  return {
    setPrimary(wanted): void {
      joined.primary = VOLUME_TOOLS.has(wanted) ? wanted : DEFAULT_PRIMARY_TOOL;
      drivePrimary(joined.group, joined.usable, joined.primary);
    },
    detach(): void {
      joined.group.removeViewports(renderingEngineId, viewportId);
      joined.viewports.delete(viewportId);
      if (joined.viewports.size > 0) return;
      volumeGroups.delete(groupId);
      ToolGroupManager.destroyToolGroup(groupId);
    },
  };
}
