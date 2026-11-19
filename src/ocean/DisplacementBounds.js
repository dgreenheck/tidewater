// Ocean quadtree bounds include the exact packed flood surface plus the ordinary
// spectral/shore-wave allowance. This controls culling, never water height.
// outer: the tsunami's 8 km outer ring, whose approach crest stands beyond the inner grid.
// far: the analytic wall beyond the ring (Field.farFieldBounds), { max, min } in m, or null.
export function updateOceanDisplacementBounds(lod,grid,outer,far=null){
 lod.minY=Math.min(0,grid?.stats.minSurface??0,outer?.stats.minSurface??0,far?.min??0)-25;
 lod.maxY=Math.max(0,grid?.stats.maxSurface??0,outer?.stats.maxSurface??0,far?.max??0)+25;
}
