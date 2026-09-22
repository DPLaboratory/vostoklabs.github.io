// The pattern engine's vocabulary. Millimetres, Y up, the same ring contract as @vostok/laser
// (`Ring` is structurally the export package's `CutRing`), but nothing here imports either — a
// pattern is maths, and the package has to drop into any tool, laser or not.
//
// Two kinds of pattern. A TILED one describes one period cell and the engine repeats it; a
// FIELD one draws straight into a box (rays about a centre, a spiral, random stipple). Both
// hand back the same three kinds of geometry, because the laser cares about exactly three
// things: a closed shape it can cut out or fill, a line it can score, and a line it may cut
// THROUGH without the sheet falling apart.

export type Pt = [number, number];
/** A closed polygon, implicitly closed, either winding. */
export type Ring = Pt[];
/** An open run of points. */
export type Polyline = Pt[];
/** One island: its outer ring first, holes after. */
export type Island = Ring[];
/** Islands of rings — the same shape as @vostok/laser's `Shapes`. */
export type Shapes = Island[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PatternGeometry {
  /** Closed shapes. As a CUT they are holes and the web between them must survive; as an
   *  ENGRAVE they are filled regions (an island may carry counters). */
  holes: Island[];
  /** Decoration lines: scored or engraved, never cut through — a lattice of cut lines is a
   *  pile of loose triangles. */
  lines: Polyline[];
  /** Lines that ARE safe to cut through: living-hinge slits. Scored or engraved like `lines`
   *  when the op is not a cut. */
  slits: Polyline[];
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

/** One knob. The kinds mirror the studio's field kinds so a host can render a form from
 *  `PatternDef.params` without a translation table. */
export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'toggle' | 'select';
  value: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export type PatternFamily =
  | 'geometric'
  | 'lines'
  | 'japanese'
  | 'islamic'
  | 'textile'
  | 'hinge'
  | 'radial'
  | 'engrave'
  | 'organic'
  | 'library';

export type PatternOp = 'cut' | 'score' | 'engrave';

export interface PatternSource {
  name: string;
  licence: string;
  url?: string;
}

export interface PatternDef {
  id: string;
  name: string;
  family: PatternFamily;
  tags?: string[];
  /** One line for a picker. */
  blurb?: string;
  /** The operations that make sense. `cut` needs holes or slits; a lines-only pattern is
   *  score/engrave. The first entry is the default. */
  ops: PatternOp[];
  params: ParamSpec[];
  /** Tiled: the period, in mm, at these params. */
  cell?(p: Params): { w: number; h: number };
  /** Tiled: one period drawn on 0..w × 0..h, Y up, with the motif centred on the cell's centre
   *  where there is a single motif. It may draw past the cell; the fill clips. Edges shared
   *  between neighbouring cells may be drawn by both — the engine merges duplicate and
   *  collinear line segments before anything is scored twice. */
  tile?(p: Params): PatternGeometry;
  /** Field: geometry covering `box` (pattern space, the region's centre at the origin). */
  generate?(box: Box, p: Params): PatternGeometry;
  /** Cut: the narrowest web the pattern leaves between its own holes at these params, mm. The
   *  fill warns when it is under the caller's minimum. Absent: the holes never approach one
   *  another (one hole per cell with the gap as a parameter says so through this). */
  web?(p: Params): number;
  /** Provenance for imported tiles (an MIT library, a customer's own SVG). */
  source?: PatternSource;
  /** How a picker tile shows this pattern: params that read at 40 mm, an overall scale, and for
   *  a tiled pattern how many periods span the tile (default 3). */
  thumb?: { params?: Partial<Params>; scale?: number; periods?: number };
  /** The width, mm, the pattern's lines are ENGRAVED at when the host asks for engraved
   *  lines — a tile library's stroke slider. Absent: lines engrave as hairlines. */
  strokeWidth?(p: Params): number;
}

export interface FillOptions {
  op: PatternOp;
  params?: Partial<Params>;
  /** Rotate the pattern about the region's centre, degrees, counter-clockwise. */
  angle?: number;
  /** Slide the pattern, mm, in the region's frame. */
  dx?: number;
  dy?: number;
  /** Uniform scale on top of the params (1 = as given). */
  scale?: number;
  /** Air between the pattern and the region's edge, mm. Default: `web` for a cut, 0 otherwise. */
  inset?: number;
  /** Cut: the least material to leave between a cut and the edge, and between one cut and the
   *  next — a hole nearer the edge than this is dropped. Default 1.5 (3 mm ply wants ≥ the
   *  material thickness; never under 1). */
  web?: number;
  /** A hole that crosses the (inset) edge: drop it, keep it whole for the host to clip, or
   *  clip it here — exact for convex holes; a concave one needs `clipPolygons`, else it is
   *  kept whole. Default: cut → drop, engrave → clip. */
  partial?: 'drop' | 'keep' | 'clip';
  /** A polygon boolean from the host (manifold's CrossSection intersect, say) for clipping
   *  concave holes. `subject ∩ clip`, islands in, islands out. */
  clipPolygons?: (subject: Shapes, clip: Shapes) => Shapes;
  /** Where the pattern's origin sits: the region's centre (default: a symmetric shape gets a
   *  symmetric fill) or its bottom-left corner. */
  align?: 'centre' | 'corner';
  /** Cut only: hand slits back as thin closed slots of this width instead of open paths, for a
   *  host whose cut layer takes closed shapes only. */
  slitWidth?: number;
  /** Engrave only: widen every line into a filled band this wide, mm, so a lines pattern
   *  engraves as strokes rather than hairlines. Default: the pattern's own `strokeWidth`, else
   *  hairlines (`paths`). The bands overlap at their joins; a host unions them. */
  strokeWidth?: number;
}

export interface FillStats {
  /** Cells the tiler laid down (0 for a field pattern). */
  cells: number;
  /** Closed shapes that survived. */
  holes: number;
  /** Closed shapes dropped at the edge or for the web rule. */
  dropped: number;
  /** Open runs that survived. */
  lines: number;
  /** Total length of the lines, mm. */
  lineLength: number;
  /** Total area of the closed shapes, mm². */
  area: number;
  /** Concave holes that crossed the edge and were kept whole because no `clipPolygons` was
   *  given — the host must clip them. */
  unclipped: number;
}

export interface FillResult {
  op: PatternOp;
  /** Closed shapes, one island each: the cut-outs (cut) or the filled regions (engrave), or
   *  the closed outlines that survived whole (score). */
  shapes: Shapes;
  /** Open runs: score/engrave lines, or cut slits. */
  paths: Polyline[];
  stats: FillStats;
  warnings: string[];
}
