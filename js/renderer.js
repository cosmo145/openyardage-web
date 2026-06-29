/**
 * renderer.js — SVG-based hole rendering engine
 */

import {
  wayToPixels, rotatePoints, rotatePointsList, translateFeatures,
  getRotateAngle, getMidpointAngle, filterFeatures, distToLine,
  getYardsPerPixel, getCanvasDimensions,
} from './coords.js';

const MAX_CANVAS_PX = 6000;

export async function renderHole({ holeWay, features, elevationGrid, bbox, colors, options, holeNum, par }) {
  const { width, height } = getCanvasDimensions(bbox, MAX_CANVAS_PX);
  const ypp = getYardsPerPixel(bbox, width, height);
  const cx = width / 2, cy = height / 2;

  const toPixels = (nodeArrays) => nodeArrays.map(nodes => wayToPixels(nodes, bbox, width, height));

  const holePixels = wayToPixels(holeWay.nodes, bbox, width, height);
  let pixFairways  = toPixels(features.fairways);
  let pixTeeBoxes  = toPixels(features.teeBoxes);
  let pixWater     = toPixels(features.waterHazards);
  let pixSand      = toPixels(features.sandTraps);
  let pixWoods     = toPixels(features.woods);
  let pixTrees     = features.trees.map(n => wayToPixels([n], bbox, width, height)[0]);
  let pixGreen     = features.green ? wayToPixels(features.green, bbox, width, height) : null;
  let pixAllGreens = toPixels(features.allGreens || []);

  const angle = getRotateAngle(holePixels);

  const rotHole    = rotatePoints(holePixels, cx, cy, angle);
  pixFairways      = rotatePointsList(pixFairways, cx, cy, angle);
  pixTeeBoxes      = rotatePointsList(pixTeeBoxes, cx, cy, angle);
  pixWater         = rotatePointsList(pixWater,    cx, cy, angle);
  pixSand          = rotatePointsList(pixSand,     cx, cy, angle);
  pixWoods         = rotatePointsList(pixWoods,    cx, cy, angle);
  pixTrees         = rotatePoints(pixTrees, cx, cy, angle);
  pixAllGreens     = rotatePointsList(pixAllGreens, cx, cy, angle);
  const rotGreen   = pixGreen ? [rotatePoints(pixGreen, cx, cy, angle)] : [];

  const { newWidth, newHeight, offsetX, offsetY } = getRotatedCanvasSize(width, height, angle);
  const adj = (arrays) => translateFeatures(arrays, -offsetX, -offsetY);

  pixFairways  = adj(pixFairways);
  pixTeeBoxes  = adj(pixTeeBoxes);
  pixWater     = adj(pixWater);
  pixSand      = adj(pixSand);
  pixWoods     = adj(pixWoods);
  pixTrees     = pixTrees.map(([x, y]) => [x + offsetX, y + offsetY]);
  pixAllGreens = adj(pixAllGreens);
  const adjGreen = adj(rotGreen);
  const adjHole  = translateFeatures([rotHole], -offsetX, -offsetY)[0];

  const drawAll = !!options.drawAllFeatures;
  const fBase = { filterYards: options.holeWidth, shortFactor: options.shortFilter, medFactor: (options.shortFilter + 1) / 2, drawAllFeatures: drawAll };
  
  pixFairways = filterFeatures(adjHole, pixFairways, ypp, par, { ...fBase, isFairway: true });
  pixTeeBoxes = filterFeatures(adjHole, pixTeeBoxes, ypp, par, { ...fBase, isTeeBox: true });
  pixSand     = filterFeatures(adjHole, pixSand,     ypp, par, fBase);
  pixWoods    = filterFeatures(adjHole, pixWoods,    ypp, par, { filterYards: null });
  pixWater    = filterFeatures(adjHole, pixWater,    ypp, par, { filterYards: null });
  const filteredTreeArrays = filterFeatures(adjHole, pixTrees.map(p => [p]), ypp, par, { filterYards: 25, drawAllFeatures: drawAll });
  pixTrees = filteredTreeArrays.map(a => a[0]);
  if (drawAll) pixAllGreens = filterFeatures(adjHole, pixAllGreens, ypp, par, { filterYards: fBase.filterYards, drawAllFeatures: true });

  // Compute crop bounds
  const boundsArrays = drawAll ? [...pixTeeBoxes, ...pixSand, ...adjGreen] : [...pixFairways, ...pixTeeBoxes, ...pixSand, ...adjGreen];
  const bounds = _getArraysBounds(boundsArrays);
  const teeMaxY = _getArraysMaxY(pixTeeBoxes) ?? _getArraysMaxY([adjHole]) ?? newHeight;

  const bMinX = bounds?.minX ?? 0;
  const bMinY = bounds?.minY ?? 0;
  const bMaxX = bounds?.maxX ?? newWidth;

  const pad20 = 20 / ypp;
  const pad10 = 10 / ypp;
  const pad5  =  5 / ypp;

  let lbx = Math.max(0, Math.round(bMinX  - pad20));
  let lby = Math.max(0, Math.round(bMinY  - pad5 - 100));
  let ubx = Math.min(newWidth, Math.round(bMaxX  + pad20 + 100));
  let uby = Math.min(newHeight, Math.round(teeMaxY + pad10 + 100));

  let cropW = ubx - lbx;
  let cropH = uby - lby;
  if (cropW <= 0 || cropH <= 0) { lbx = 0; lby = 0; cropW = newWidth; cropH = newHeight; }

  let finalW, finalH;
  if (cropH / cropW > 2.83) { finalH = cropH; finalW = Math.ceil(cropH / 2.83); } 
  else { finalW = cropW; finalH = Math.ceil(2.83 * cropW); }

  const destX = Math.round((finalW - cropW) / 2);
  const destY = Math.round((finalH - cropH) / 2);

  // Initialize Canvas2Svg with the perfectly cropped dimensions
  const ctx = new C2S(finalW, finalH);
  ctx.fillStyle = colors.rough;
  ctx.fillRect(0, 0, finalW, finalH);

  // Translate the massive coordinate space to fit inside our crop window
  ctx.save();
  ctx.translate(destX - lbx, destY - lby);

  drawPolygons(ctx, pixWoods,    colors.trees);    
  drawPolygons(ctx, pixWater,    colors.water);
  drawPolygons(ctx, pixFairways, colors.fairway);
  drawPolygons(ctx, pixTeeBoxes, colors.teeBox);
  if (drawAll && pixAllGreens.length) drawPolygons(ctx, pixAllGreens, colors.green);
  if (adjGreen.length) drawPolygons(ctx, adjGreen, colors.green);
  drawPolygons(ctx, pixSand,     colors.sand);
  if (options.includeTrees) drawTrees(ctx, pixTrees, colors.trees, Math.max(5, Math.round(5 / ypp)));

  const baseFontSize = Math.max(11, Math.round(3.5 / ypp));
  const fontSize = baseFontSize * (options.textSizeMult || 1.0);
  const textColor = colors.text;
  const effectivePar = par ?? 4;
  const showBg = options.textBackground !== false;

  if (effectivePar === 3) {
    _drawGreenDistancesMin(ctx, adjHole, pixTeeBoxes, ypp, fontSize, textColor, options.inMeters, 1, showBg);
  } else {
    const { right: r1, left: l1 } = drawCarryDistances(ctx, adjHole, pixTeeBoxes, pixSand,  ypp, fontSize, textColor, options.inMeters, showBg);
    const { right: r2, left: l2 } = drawCarryDistances(ctx, adjHole, pixTeeBoxes, pixWater, ypp, fontSize, textColor, options.inMeters, showBg);
    drawExtraCarries(ctx, adjHole, pixTeeBoxes, r1 + r2, l1 + l2, ypp, fontSize, textColor, options.inMeters, showBg);
    _drawGreenDistancesMin(ctx, adjHole, pixSand, ypp, fontSize, textColor, options.inMeters, 0, showBg);
    _drawGreenDistancesMin(ctx, adjHole, pixWater, ypp, fontSize, textColor, options.inMeters, 0, showBg);
    _drawGreenDistancesMax(ctx, adjHole, pixFairways, ypp, fontSize, textColor, options.inMeters, showBg);
    if (options.includeTrees) _drawGreenDistancesTree(ctx, adjHole, pixTrees, ypp, fontSize, textColor, options.inMeters, showBg);
    drawArcDistances(ctx, adjHole, ypp, 50, fontSize, textColor, options.inMeters, showBg);
  }

  ctx.restore();
  return { svgString: ctx.getSerializedSvg(true), width: finalW, height: finalH };
}

export async function renderGreenInset({ holeWay, features, bbox, colors, options, holeNum, par }) {
  const { width, height } = getCanvasDimensions(bbox, MAX_CANVAS_PX);
  const ypp = getYardsPerPixel(bbox, width, height);
  const cx = width / 2, cy = height / 2;

  const toPixels = (nodeArrays) => nodeArrays.map(nodes => wayToPixels(nodes, bbox, width, height));
  const holePixels = wayToPixels(holeWay.nodes, bbox, width, height);
  let pixFairways  = toPixels(features.fairways);
  let pixTeeBoxes  = toPixels(features.teeBoxes);
  let pixWater     = toPixels(features.waterHazards);
  let pixSand      = toPixels(features.sandTraps);
  let pixWoods     = toPixels(features.woods);
  let pixGreen     = features.green ? wayToPixels(features.green, bbox, width, height) : null;

  const angle = getMidpointAngle(holePixels);

  const rotHole  = rotatePoints(holePixels, cx, cy, angle);
  pixFairways    = rotatePointsList(pixFairways, cx, cy, angle);
  pixTeeBoxes    = rotatePointsList(pixTeeBoxes, cx, cy, angle);
  pixWater       = rotatePointsList(pixWater,    cx, cy, angle);
  pixSand        = rotatePointsList(pixSand,     cx, cy, angle);
  pixWoods       = rotatePointsList(pixWoods,    cx, cy, angle);
  const rotGreen = pixGreen ? [rotatePoints(pixGreen, cx, cy, angle)] : [];

  const { newWidth, newHeight, offsetX, offsetY } = getRotatedCanvasSize(width, height, angle);
  const adj = (arrays) => translateFeatures(arrays, -offsetX, -offsetY);

  pixFairways = adj(pixFairways);
  pixTeeBoxes = adj(pixTeeBoxes);
  pixWater    = adj(pixWater);
  pixSand     = adj(pixSand);
  pixWoods    = adj(pixWoods);
  const adjGreen = adj(rotGreen);
  const adjHole  = translateFeatures([rotHole], -offsetX, -offsetY)[0];

  const drawAll = !!options.drawAllFeatures;
  const fBase = { filterYards: options.holeWidth, shortFactor: options.shortFilter, medFactor: (options.shortFilter + 1) / 2, drawAllFeatures: drawAll };
  pixFairways = filterFeatures(adjHole, pixFairways, ypp, par, { ...fBase, isFairway: true });
  pixTeeBoxes = filterFeatures(adjHole, pixTeeBoxes, ypp, par, { ...fBase, isTeeBox: true });
  pixSand     = filterFeatures(adjHole, pixSand,     ypp, par, { filterYards: null });
  pixWoods    = filterFeatures(adjHole, pixWoods,    ypp, par, { filterYards: null });
  pixWater    = filterFeatures(adjHole, pixWater,    ypp, par, { filterYards: null });

  const greenCenter = adjHole[adjHole.length - 1];
  const { xmin, ymin, xmax, ymax, lineThickness } = drawGreenGrid(null, greenCenter, ypp, true);

  const cropX = Math.max(0, xmin);
  const cropY = Math.max(0, ymin);
  const cropW = Math.min(newWidth, xmax) - cropX;
  const cropH = Math.min(newHeight, ymax) - cropY;

  const bw = lineThickness;
  const finalW = cropW + bw * 2;
  const finalH = cropH + bw * 2;

  if (cropW <= 0 || cropH <= 0) return { svgString: '<svg></svg>', width: 1, height: 1 };

  const ctx = new C2S(finalW, finalH);
  
  // Border
  ctx.fillStyle = '#8C8C8C';
  ctx.fillRect(0, 0, finalW, finalH);

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(bw, bw, cropW, cropH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bw, bw, cropW, cropH);
  ctx.clip(); // Prevent bleeding into the border

  ctx.translate(bw - cropX, bw - cropY);

  drawPolygons(ctx, pixWoods,    '#B4B4B4');
  drawPolygons(ctx, pixWater,    '#B4B4B4');
  drawPolygons(ctx, pixFairways, '#EBEBEB');
  drawPolygons(ctx, pixTeeBoxes, '#C3C3C3');
  
  if (adjGreen.length) {
    drawPolygons(ctx, adjGreen, '#FFFFFF');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    for (const poly of adjGreen) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }
  drawPolygons(ctx, pixSand, '#D2D2D2');

  // Draw Grid
  drawGreenGrid(ctx, greenCenter, ypp, false);

  ctx.restore();
  return { svgString: ctx.getSerializedSvg(true), width: finalW, height: finalH };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing Primitives
// ─────────────────────────────────────────────────────────────────────────────
export function drawPolygons(ctx, polygons, color) {
  ctx.fillStyle = color;
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawPolylines(ctx, polylines, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of polylines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
    ctx.stroke();
  }
}

export function drawTrees(ctx, positions, color, radius = 8) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  const [r, g, b] = hexToRgb(color);
  const darkColor = `rgb(${Math.max(0, Math.round(r * 0.6))}, ${Math.max(0, Math.round(g * 0.6))}, ${Math.max(0, Math.round(b * 0.6))})`;

  for (const [x, y] of positions) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = darkColor;
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI) / 3;
      const dx = Math.cos(angle) * radius * 0.75;
      const dy = Math.sin(angle) * radius * 0.75;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
  }
}

export function drawLabel(ctx, text, x, y, fontSize, color, align = 'center', showBg = true) {
  ctx.font = `400 ${fontSize}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (showBg) {
    const metrics = ctx.measureText(text);
    const padX = 4, padY = 3;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;
    const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const by = y - h / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(bx, by, w, h);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function drawGreenGrid(ctx, greenCenter, ypp, calcOnly = false) {
  const [gx, gy] = greenCenter;
  const step = 3 / ypp; 
  const xmin = Math.round(gx - 30 / ypp);
  const xmax = Math.round(gx + 30 / ypp);
  const ymin = Math.round(gy - 30 / ypp);
  const ymax = Math.round(gy + 39 / ypp);
  const lineThickness = (xmax - xmin) > 850 ? 2 : 1;

  if (calcOnly) return { xmin, ymin, xmax, ymax, lineThickness };

  const dotHalf = Math.max(1, Math.round(0.5 / ypp));
  ctx.fillStyle = '#000000';
  ctx.fillRect(Math.round(gx) - dotHalf, Math.round(gy) - dotHalf, dotHalf * 2, dotHalf * 2);

  ctx.strokeStyle = '#8C8C8C'; 
  ctx.lineWidth = lineThickness;

  let lx = gx;
  while (lx < xmax) { ctx.beginPath(); ctx.moveTo(Math.round(lx), ymin); ctx.lineTo(Math.round(lx), ymax); ctx.stroke(); lx += step; }
  lx = gx - step;
  while (lx > xmin) { ctx.beginPath(); ctx.moveTo(Math.round(lx), ymin); ctx.lineTo(Math.round(lx), ymax); ctx.stroke(); lx -= step; }

  let ly = gy;
  while (ly < ymax) { ctx.beginPath(); ctx.moveTo(xmin, Math.round(ly)); ctx.lineTo(xmax, Math.round(ly)); ctx.stroke(); ly += step; }
  ly = gy - step;
  while (ly > ymin) { ctx.beginPath(); ctx.moveTo(xmin, Math.round(ly)); ctx.lineTo(xmax, Math.round(ly)); ctx.stroke(); ly -= step; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Annotations — Private Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _getThreeWaypoints(holeCenterline) {
  let holeOrigin  = holeCenterline[0];
  let greenCenter = holeCenterline[holeCenterline.length - 1];
  if (Math.abs(holeOrigin[0] - greenCenter[0]) < 0.00001) greenCenter = [greenCenter[0] + 0.001, greenCenter[1]];
  const midpoint = holeCenterline.length === 2 ? [(holeOrigin[0] + greenCenter[0]) / 2, (holeOrigin[1] + greenCenter[1]) / 2] : holeCenterline[1];
  return { holeOrigin, midpoint, greenCenter };
}

function _getMinYPoint(polygon) { let best = polygon[0]; for (const p of polygon) if (p[1] < best[1]) best = p; return best; }
function _getMaxYPoint(polygon) { let best = polygon[0]; for (const p of polygon) if (p[1] > best[1]) best = p; return best; }
function _pixDist(a, b) { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2); }
function _yardDist(a, b, ypp) { return _pixDist(a, b) * ypp; }
function _displayDist(yards, inMeters) { return Math.round(inMeters ? yards * 0.9144 : yards); }
function _getLine(p1, p2) {
  const dx = p2[0] - p1[0];
  if (Math.abs(dx) < 1e-10) return { vertical: true, x: p1[0] };
  const slope = (p2[1] - p1[1]) / dx;
  return { vertical: false, slope, intercept: p1[1] - slope * p1[0] };
}

function _getAngle(greenCenter, otherPoint) {
  const [x, y] = greenCenter, [x2, y2] = otherPoint;
  const bigy = Math.max(y, y2), smally = Math.min(y, y2);
  const denom = Math.sqrt((x2 - x) ** 2 + (bigy - smally) ** 2);
  if (denom < 1e-10) return 0;
  let angle = (Math.acos(Math.max(-1, Math.min(1, (bigy - smally) / denom))) * 180) / Math.PI;
  if (y > y2 && x > x2) angle = 180 - angle; else if (y > y2 && x < x2) angle = 180 + angle; else if (y < y2 && x < x2) angle = 360 - angle;
  return angle;
}

function _getPointOnOtherLine(originPoint, midpoint, greenCenter, distYards, ypp) {
  const distance = distYards / ypp;
  const [x0, y0] = greenCenter, [x1, y1] = midpoint, [x2, y2] = originPoint;
  const A = y2 - y1, B = x1 - x2, C = x2 * y1 - x1 * y2;
  if (Math.abs(B) < 3 && B > -3) return null;
  const qa = A ** 2 + B ** 2, qb = 2*A*C + 2*A*B*y0 - 2*(B**2)*x0, qc = C**2 + 2*B*C*y0 - (B**2) * (distance**2 - x0**2 - y0**2);
  const disc = qb**2 - 4*qa*qc;
  if (disc < 0) return null;
  let xInt = (-qb + Math.sqrt(disc)) / (2 * qa), yInt = -((A * xInt + C) / B);
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  if (!(xInt > minX && xInt < maxX && yInt > minY && yInt < maxY)) {
    xInt = (-qb - Math.sqrt(disc)) / (2 * qa); yInt = -((A * xInt + C) / B);
  }
  return [Math.round(xInt), Math.round(yInt)];
}

function _drawTriangle(ctx, [x, y], base, height, color) {
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - height / 2); ctx.lineTo(x - base / 2, y + height / 2); ctx.lineTo(x + base / 2, y + height / 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function _drawDistanceText(ctx, distance, [x, y], fontSize, textColor, showBg = true) {
  drawLabel(ctx, String(distance), x, y + Math.round(fontSize * 0.9), fontSize, textColor, 'center', showBg);
}

function _drawDot(ctx, [x, y], radius, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function _drawCarry(ctx, greenCenter, carryPoint, teeBoxPoints, ypp, fontSize, textColor, right, inMeters, showBg = true) {
  if (teeBoxPoints.length === 0) return 0;
  const distYardsList = teeBoxPoints.map(tee => _yardDist(tee, carryPoint, ypp));
  const maxDistYards = Math.max(...distYardsList);
  if (maxDistYards < 185 || maxDistYards > 325) return 0;

  const distList = distYardsList.map(d => _displayDist(d, inMeters)).sort((a, b) => a - b);
  const lineSpacing = Math.round(fontSize * 1.6), totalH = lineSpacing * (distList.length - 1), dotR = Math.max(3, Math.round(1 / ypp));
  ctx.font = `400 ${fontSize}px sans-serif`;
  const approxW = ctx.measureText(String(distList[distList.length - 1])).width;
  const baseX = right ? Math.round(carryPoint[0] + Math.round(10 * (fontSize / 30 + 0.1) + 5)) : Math.round(carryPoint[0] - Math.round(10 * (fontSize / 30 + 0.1) + 5) - approxW);
  let y = Math.round(carryPoint[1] - totalH / 2);

  for (const d of distList) {
    const label = String(d), lw = ctx.measureText(label).width;
    if (showBg) { ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(baseX - 4, y - fontSize / 2 - 3, lw + 8, fontSize + 6); }
    ctx.fillStyle = textColor; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, baseX, y);
    y += lineSpacing;
  }
  _drawDot(ctx, carryPoint, dotR, textColor);
  for (const tee of teeBoxPoints) _drawDot(ctx, tee, dotR, textColor);
  if (_yardDist(greenCenter, carryPoint, ypp) < 40 || maxDistYards < 215 || maxDistYards > 290) return 0;
  return 1;
}

export function drawCarryDistances(ctx, holeCenterline, teeBoxes, carries, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!carries.length || !teeBoxes.length) return { right: 0, left: 0 };
  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const carryPoints = carries.map(poly => _getMinYPoint(poly)), teeBoxPoints = teeBoxes.map(poly => _getMaxYPoint(poly));
  let rightCarries = 0, leftCarries = 0; const drawnCarries = [];

  for (const carry of carryPoints) {
    if (drawnCarries.some(past => _yardDist(carry, past, ypp) < 20)) continue;
    const refA = carry[1] < midpoint[1] ? midpoint : holeOrigin, refB = carry[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(carry, refA, refB, ypp) > 40) continue;
    const lineInfo = _getLine(refA, refB);
    let right = true;
    if (!lineInfo.vertical && carry[0] < (carry[1] - lineInfo.intercept) / lineInfo.slope) right = false;
    const count = _drawCarry(ctx, greenCenter, carry, teeBoxPoints, ypp, fontSize, textColor, right, inMeters, showBg);
    if (right) rightCarries += count; else leftCarries += count;
    drawnCarries.push(carry);
  }
  return { right: rightCarries, left: leftCarries };
}

export function drawExtraCarries(ctx, holeCenterline, teeBoxes, rightCarries, leftCarries, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (rightCarries + leftCarries > 0 || !teeBoxes.length) return;
  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const teeBoxPoints = teeBoxes.map(poly => _getMaxYPoint(poly)), holeLenYards = _yardDist(holeOrigin, greenCenter, ypp);
  let carryY;
  if (holeLenYards < 380) carryY = greenCenter[1] + (95 / ypp);
  else if (holeLenYards < 430) carryY = greenCenter[1] + (145 / ypp);
  else if (holeLenYards < 480) carryY = greenCenter[1] + (195 / ypp);
  else carryY = holeOrigin[1] - (230 / ypp);

  const lineInfo = (midpoint[1] > carryY) ? _getLine(midpoint, greenCenter) : _getLine(midpoint, holeOrigin);
  if (lineInfo.vertical) return;
  const baseX = (carryY - lineInfo.intercept) / lineInfo.slope, goRight = midpoint[0] >= greenCenter[0];
  _drawCarry(ctx, greenCenter, [baseX + (goRight ? 20 : -20) / ypp, carryY], teeBoxPoints, ypp, fontSize, textColor, goRight, inMeters, showBg);
}

function _drawGreenDistancesMin(ctx, holeCenterline, features, ypp, fontSize, textColor, inMeters = false, par3Tees = 0, showBg = true) {
  if (!features.length) return;
  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const holeDistYards = _yardDist(holeOrigin, greenCenter, ypp), drawnPoints = [], base = Math.max(4, Math.round(2 / ypp)), triH = Math.round((3 / 5) * base);
  for (const poly of features) {
    const point = _getMaxYPoint(poly), distYards = _yardDist(point, greenCenter, ypp);
    if (distYards < 40 || distYards > 305 || (!par3Tees && distYards > 0.75 * holeDistYards)) continue;
    if (drawnPoints.some(past => _yardDist(point, past, ypp) < 15)) continue;
    if (distToLine(point, point[1] < midpoint[1] ? midpoint : holeOrigin, point[1] < midpoint[1] ? greenCenter : midpoint, ypp) > 40) continue;
    _drawTriangle(ctx, point, base, triH, textColor);
    _drawDistanceText(ctx, _displayDist(distYards, inMeters), point, fontSize, textColor, showBg);
    drawnPoints.push(point);
  }
}

function _drawGreenDistancesMax(ctx, holeCenterline, features, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!features.length) return;
  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline), holeDistYards = _yardDist(holeOrigin, greenCenter, ypp), base = Math.max(4, Math.round(2 / ypp)), triH = Math.round((3 / 5) * base);
  for (const poly of features) {
    const point = _getMinYPoint(poly), distYards = _yardDist(point, greenCenter, ypp);
    if (distYards < 40 || distYards > 0.75 * holeDistYards) continue;
    if (distToLine(point, point[1] < midpoint[1] ? midpoint : holeOrigin, point[1] < midpoint[1] ? greenCenter : midpoint, ypp) > 40) continue;
    _drawTriangle(ctx, point, base, triH, textColor);
    _drawDistanceText(ctx, _displayDist(distYards, inMeters), point, fontSize, textColor, showBg);
  }
}

function _drawGreenDistancesTree(ctx, holeCenterline, trees, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!trees.length) return;
  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline), holeDistYards = _yardDist(holeOrigin, greenCenter, ypp), drawnPoints = [], lineLen = Math.max(20, Math.round(8 / ypp));
  for (const point of trees) {
    const distYards = _yardDist(point, greenCenter, ypp), mod50 = distYards % 50;
    if (distYards < 40 || distYards > 0.75 * holeDistYards || mod50 < 7 || mod50 > 43) continue;
    if (drawnPoints.some(past => _yardDist(point, past, ypp) < 20)) continue;
    const refA = point[1] < midpoint[1] ? midpoint : holeOrigin, refB = point[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(point, refA, refB, ypp) > 25) continue;
    const lineInfo = _getLine(refA, refB);
    let right = true;
    if (!lineInfo.vertical && point[0] < (point[1] - lineInfo.intercept) / lineInfo.slope) right = false;
    ctx.strokeStyle = textColor; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(point[0], point[1]); ctx.lineTo(point[0] + (right ? -lineLen : lineLen), point[1]); ctx.stroke();
    drawLabel(ctx, String(_displayDist(distYards, inMeters)), point[0] + (right ? -lineLen - 4 : lineLen + 4), point[1], fontSize, textColor, right ? 'right' : 'left', showBg);
    drawnPoints.push(point);
  }
}

export function drawArcDistances(ctx, holeCenterline, ypp, startDist, fontSize, textColor, inMeters = false, showBg = true) {
  const ANGLE_OFFSETS = { 50: 30, 100: 15.2, 150: 9.8, 200: 7.5, 250: 6, 300: 5, 350: 4.6 };
  if (holeCenterline.length < 2) return;
  const greenCenter = holeCenterline[holeCenterline.length - 1], segDists = [];
  for (let i = holeCenterline.length - 2; i >= 0; i--) segDists.push((segDists.length === 0 ? 0 : segDists[segDists.length - 1]) + _yardDist(holeCenterline[i], i === holeCenterline.length - 2 ? greenCenter : holeCenterline[i + 1], ypp));
  const totalLen = segDists[segDists.length - 1], holeLenLimit = Math.min(350, Math.max(segDists[0], Math.max(totalLen * 0.6, totalLen - 200)));
  let drawDist = startDist;

  for (let seg = 0; seg < holeCenterline.length - 1; seg++) {
    const segStart = holeCenterline[holeCenterline.length - 2 - seg], segEnd = holeCenterline[holeCenterline.length - 1 - seg], segLimit = segDists[seg];
    while (drawDist < segLimit && drawDist <= holeLenLimit) {
      const drawpoint = _getPointOnOtherLine(segStart, segEnd, greenCenter, drawDist, ypp);
      if (drawpoint) {
        const drawnAngle = _getAngle(greenCenter, drawpoint) + 90, offset = ANGLE_OFFSETS[drawDist] ?? 4, pixelDist = Math.round(drawDist / ypp);
        ctx.strokeStyle = textColor; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(greenCenter[0], greenCenter[1], pixelDist, (drawnAngle - offset) * Math.PI / 180, (drawnAngle + offset) * Math.PI / 180); ctx.stroke();
        _drawDistanceText(ctx, _displayDist(drawDist, inMeters), drawpoint, fontSize, textColor, showBg);
      }
      drawDist += 50;
    }
    if (drawDist > holeLenLimit) break;
  }
}

export function getRotatedCanvasSize(width, height, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const newWidth = Math.ceil(width * cos + height * sin), newHeight = Math.ceil(width * sin + height * cos);
  return { newWidth, newHeight, offsetX: (newWidth - width) / 2, offsetY: (newHeight - height) / 2 };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function _getArraysBounds(arrays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
  for (const arr of arrays) for (const [x, y] of arr) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; found = true; }
  return found ? { minX, minY, maxX, maxY } : null;
}

function _getArraysMaxY(arrays) {
  let maxY = -Infinity, found = false;
  for (const arr of arrays) for (const [, y] of arr) if (y > maxY) { maxY = y; found = true; }
  return found ? maxY : null;
}