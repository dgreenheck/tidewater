import { BufferAttribute } from '../geometry/BufferAttribute.js';

// CPU-deformed batches need the last rendered vertex position as well as the
// previous object matrix. Keep updates local to the changed fragment ranges.
const dirty = new Map();
const snapshots = new WeakMap();
// Material views can share positions while using separate BufferGeometry objects.
export function inheritGeometryMotion(geometry) {
 const previous = snapshots.get(geometry.getAttribute('position'));
 if (previous && geometry.getAttribute('previousPosition') !== previous) geometry.setAttribute('previousPosition', previous);
 return previous;
}
export function enableGeometryMotion(geometry) {
 let previous = inheritGeometryMotion(geometry) || geometry.getAttribute('previousPosition');
 if (!previous) {
  previous = new BufferAttribute(geometry.getAttribute('position').array.slice(), 3);
  geometry.setAttribute('previousPosition', previous);
 }
 snapshots.set(geometry.getAttribute('position'), previous);
 return previous;
}
export function markGeometryMotion(geometry, start, count) {
 enableGeometryMotion(geometry);
 let ranges = dirty.get(geometry);
 if (!ranges) { ranges = []; dirty.set(geometry, ranges); }
 ranges.push([start * 3, count * 3]);
}
// Call after the GPU command submission, once per rendered frame. Updating the
// CPU attribute here makes the next upload correct even when simulation pauses.
export function commitGeometryMotion() {
 for (const [geometry, ranges] of dirty) {
  const current = geometry.getAttribute('position').array;
  const previous = geometry.getAttribute('previousPosition');
  for (const [start, count] of ranges) {
   previous.array.set(current.subarray(start, start + count), start);
   previous.addUpdateRange(start, count);
  }
  previous.needsUpdate = true;
 }
 dirty.clear();
}
