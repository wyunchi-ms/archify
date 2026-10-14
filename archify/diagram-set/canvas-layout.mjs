import { rectsOverlap, segmentIntersectsRect, roundedPath } from '../renderers/shared/geometry.mjs';
import { shortestOrthogonalGridRoute } from '../renderers/shared/route-quality.mjs';

export function defaultRelationSplit(group, viewer = {}) {
  if (viewer.initial_relation_mode) return viewer.initial_relation_mode === 'expanded';
  return viewer.bundle_threshold !== undefined && group.count < viewer.bundle_threshold;
}
export function routeCanvasBridge({ start, end, fromSide, toSide, obstacles, offset = 0 }) {
  const stub = (point, side) => [point[0] + (side === 'right' ? 18 : side === 'left' ? -18 : 0),
    point[1] + (side === 'bottom' ? 18 : side === 'top' ? -18 : 0)];
  const outer = (point, side) => {
    const horizontal = side === 'left' || side === 'right';
    return [point[0] + (horizontal ? side === 'right' ? 18 : -18 : offset),
      point[1] + (horizontal ? offset : side === 'bottom' ? 18 : -18)];
  };
  const first = offset ? outer(start, fromSide) : start, last = offset ? outer(end, toSide) : end;
  const midpoint = fromSide === 'left' || fromSide === 'right'
    ? [(start[0] + end[0]) / 2, start[1] + offset] : [start[0] + offset, (start[1] + end[1]) / 2];
  const metrics = {};
  const route = shortestOrthogonalGridRoute({
    start: first, end: last, points: [first, midpoint, last], obstacles, fromSide, toSide,
    clearance: 6, endpointStubPx: 12 + Math.abs(offset), maximumObstacleCount: 64,
    maximumGridNodes: 12000, minimumSegmentPx: 6, bendPenaltyPx: 18, metrics,
  });
  const points = route && offset ? [start, stub(start, fromSide), ...route.points, stub(end, toSide), end] : route?.points;
  return route ? { points, path: roundedPath(points, 7), status: 'routed' }
    : { points: [start, end], path: `M${start.join(',')} L${end.join(',')}`, status: metrics.status };
}
export function placeCanvasCaption(points, width, height, obstacles, occupied = [], viewport = null) {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  for (const fraction of [.5, .35, .65, .2, .8]) {
    let remaining = total * fraction, anchor = points[0];
    for (const [i, length] of lengths.entries()) {
      if (remaining <= length) {
        const gain = length ? remaining / length : 0;
        anchor = [points[i][0] + (points[i + 1][0] - points[i][0]) * gain,
          points[i][1] + (points[i + 1][1] - points[i][1]) * gain];
        break;
      }
      remaining -= length;
    }
    for (const dy of [-height - 6, 8, -height - 22, 24]) {
      const rect = { x: anchor[0] - width / 2, y: anchor[1] + dy, width, height };
      if (viewport && (rect.x < viewport.x || rect.y < viewport.y
        || rect.x + width > viewport.x + viewport.width || rect.y + height > viewport.y + viewport.height)) continue;
      if (![...obstacles, ...occupied].some((box) => rectsOverlap(rect, box, 3))) return rect;
    }
  }
  return null;
}
function contrast(foreground, background, opacity = 1) {
  const parse = (value) => {
    const hex = value.match(/^#([a-f0-9]{6})$/i);
    if (hex) return [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16));
    const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return rgb ? rgb.slice(1).map(Number) : null;
  };
  const fg = parse(foreground), bg = parse(background);
  if (!fg || !bg) return null;
  const luminance = (color) => color.map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const a = luminance(fg.map((channel, i) => channel * opacity + bg[i] * (1 - opacity))), b = luminance(bg);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function checkCanvasQuality({ routes = [], labels = [], nodes = [], foreground, background, opacity = 1 } = {}) {
  const diagnostics = [];
  const add = (code, subject, evidence, fix) => diagnostics.push({
    code: `diagram-set/canvas-${code}`, severity: 'warning', subject, evidence,
    message: `Canvas ${code.replaceAll('-', ' ')}.`, supportedFixes: [fix],
  });
  for (const route of routes) {
    if (route.native) continue;
    if (route.status !== 'routed') add('route-budget', { relations: route.ids }, { status: route.status },
      'bundle links, narrow the relationship filters or separate obstructing nodes');
    const blocked = nodes.filter((node) => !route.endpoints.includes(node.key) && route.points.slice(1)
      .some((point, i) => segmentIntersectsRect({ start: route.points[i], end: point }, node)));
    if (blocked.length) add('node-obstruction', { relations: route.ids }, { nodes: blocked.map((node) => node.key) },
      'adjust the authored node placement or inspect these facts in the relationship list');
  }
  for (const [i, label] of labels.entries()) {
    const blocked = nodes.filter((node) => rectsOverlap(label, node));
    const overlaps = labels.slice(0, i).filter((other) => rectsOverlap(label, other));
    if (blocked.length || overlaps.length) add('label-overlap', { relations: label.ids },
      { nodes: blocked.map((node) => node.key), labels: overlaps.flatMap((other) => other.ids) },
      'move the caption into a free corridor or keep its text in the relationship inspector');
  }
  const ratio = foreground && background ? contrast(foreground, background, opacity) : null;
  if (ratio !== null && ratio < 3) add('low-contrast', {}, { ratio, minimum: 3 },
    'use a bridge color with at least 3:1 non-text contrast against the canvas');
  return { schemaVersion: 1, ok: diagnostics.length === 0, diagnostics,
    checks: { routes: routes.length, captions: labels.length, nodes: nodes.length, contrastRatio: ratio } };
}
