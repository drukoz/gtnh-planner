// The map's view and its extension points (architecture §7.2, verbatim): Plan 4 draws user notes as markers, Plan 5 adds
// layout pins as markers and the line itself as an overlay.

/** What the map shows: `centerX`/`centerZ` in blocks at the middle of the canvas, `width`/`height` in CSS pixels. */
export interface MapViewport { dim: number; centerX: number; centerZ: number; pixelsPerBlock: number; width: number; height: number; y: number }
export interface MapOverlay { id: string; draw(ctx: CanvasRenderingContext2D, view: MapViewport): void; onPointer?(ev: { kind: 'down' | 'move' | 'up'; x: number; z: number }): boolean /* true = consumed (e.g. drag placement) */ }
export interface MapMarker { n?: number; pos: [number, number, number]; color: string; label: string }
export interface MapViewProps { scanId: string; dim: number; focus?: [number, number]; overlays?: MapOverlay[]; markers?: MapMarker[]; onMarkerClick?: (m: MapMarker) => void }
