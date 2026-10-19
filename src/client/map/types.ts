// The map's view and its extension points (architecture §7.2, verbatim): Plan 4 draws user notes as markers, Plan 5 adds
// layout pins as markers and the line itself as an overlay. `MapMarker.text` is Plan 5's optional addition (its change
// request 9): note pins show `N1`, `N2`, … so that "pin 1" in a build step names one marker only.

/** What the map shows: `centerX`/`centerZ` in blocks at the middle of the canvas, `width`/`height` in CSS pixels. */
export interface MapViewport { dim: number; centerX: number; centerZ: number; pixelsPerBlock: number; width: number; height: number; y: number }
export interface MapOverlay { id: string; draw(ctx: CanvasRenderingContext2D, view: MapViewport): void; onPointer?(ev: { kind: 'down' | 'move' | 'up'; x: number; z: number }): boolean /* true = consumed (e.g. drag placement) */ }
export interface MapMarker {
  n?: number; pos: [number, number, number]; color: string; label: string;
  // optional addition
  /** Drawn in the marker's circle instead of `n`. */
  text?: string;
}
export interface MapViewProps { scanId: string; dim: number; focus?: [number, number]; overlays?: MapOverlay[]; markers?: MapMarker[]; onMarkerClick?: (m: MapMarker) => void }
