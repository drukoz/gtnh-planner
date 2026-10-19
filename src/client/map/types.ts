// The map's view and its extension points (architecture §7.2, verbatim): Plan 4 draws user notes as markers, Plan 5 adds
// layout pins as markers and the line itself as an overlay.

/** What the map shows: `centerX`/`centerZ` in blocks at the middle of the canvas, `width`/`height` in CSS pixels. */
export interface MapViewport { dim: number; centerX: number; centerZ: number; pixelsPerBlock: number; width: number; height: number; y: number }
export interface MapOverlay { id: string; draw(ctx: CanvasRenderingContext2D, view: MapViewport): void; onPointer?(ev: { kind: 'down' | 'move' | 'up'; x: number; z: number }): boolean /* true = consumed (e.g. drag placement) */ }
export interface MapMarker { n?: number; pos: [number, number, number]; color: string; label: string }
export interface MapViewProps { scanId: string; dim: number; focus?: [number, number]; overlays?: MapOverlay[]; markers?: MapMarker[]; onMarkerClick?: (m: MapMarker) => void }

// ---- Optional additions (architecture §11, Map hover) ----
// Interface merges, so the §7.2 lines above stay as they are.

import type { WorldScan } from '../../shared/types/world.ts';

/** The overlay's own lines about column (x, z) for the map's hover tooltip, shown after the map's own; null for none. */
export interface MapOverlay { describe?(x: number, z: number): string[] | null }
/** The finished scan `scanId` names: with it the hover tooltip also says what the scan found at a column and its base. */
export interface MapViewProps { scan?: WorldScan }
