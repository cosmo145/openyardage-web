/**
 * generator.js — Top-level generation orchestrator
 */
import { fetchCourseData, categorizeFeatures } from './osm.js';
import { renderHole, renderGreenInset } from './renderer.js';
import { fetchElevationGrid } from './elevation.js';

export async function generateBook({ bbox, courseName, colors, options, cachedOsmData, onProgress, onHoleStatus, onDone, onError }) {
  try {
    let holeWays, allFeatures;
    if (cachedOsmData) {
      onProgress({ pct: 2, message: 'Using cached course data…' });
      allFeatures = cachedOsmData.allFeatures;
      holeWays = allFeatures.ways.filter(w => w.tags.golf === 'hole' && w.nodes.length >= 2)
        .sort((a, b) => (parseInt(a.tags.ref, 10) || 0) - (parseInt(b.tags.ref, 10) || 0));
    } else {
      onProgress({ pct: 2, message: 'Fetching course data from OpenStreetMap…' });
      const fetched = await fetchCourseData(bbox);
      holeWays    = fetched.holeWays;
      allFeatures = { ways: fetched.ways, nodes: fetched.nodes, relations: fetched.relations };
    }

    if (!holeWays || holeWays.length === 0) throw new Error('No golf holes found in the selected area.');
    const totalHoles = holeWays.length;
    onProgress({ pct: 14, message: `Found ${totalHoles} hole${totalHoles !== 1 ? 's' : ''}. Processing…` });

    let elevationGrid = null;
    if (options.includeTopo) {
      if (cachedOsmData?.elevationGrid) elevationGrid = cachedOsmData.elevationGrid;
      else { onProgress({ pct: 16, message: 'Fetching elevation data…' }); try { elevationGrid = await fetchElevationGrid(bbox); } catch (e) {} }
    }

    const renderedHoles = [];
    const pctPerHole = 70 / totalHoles;

    for (let i = 0; i < holeWays.length; i++) {
      const holeWay = holeWays[i], holeNum = parseInt(holeWay.tags?.ref, 10) || (i + 1), par = parseInt(holeWay.tags?.par, 10) || null;
      onHoleStatus({ holeNum, par, status: 'running' });

      try {
        const features = categorizeFeatures(allFeatures, bbox, holeWay);
        if (!features.green) { onProgress({ pct: 14 + (i + 1) * pctPerHole, message: `Skipped hole ${holeNum}` }); continue; }

        const holeResult = await renderHole({ holeWay, features, elevationGrid, bbox, colors, options, holeNum, par });
        const greenResult = await renderGreenInset({ holeWay, features, bbox, colors, options, holeNum, par });

        const holeSvg = holeResult.svgString;
        const greenSvg = greenResult.svgString;
        
        // Convert SVG directly to a Data URL for the HTML image viewer
        const holeImageUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(holeSvg);
        const greenImageUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(greenSvg);

        renderedHoles.push({
          holeNum, par,
          holeImageUrl, greenImageUrl,
          holeSvg, greenSvg,
          holeWidth: holeResult.width, holeHeight: holeResult.height,
          greenWidth: greenResult.width, greenHeight: greenResult.height,
          holeWay
        });

        onProgress({ pct: 14 + (i + 1) * pctPerHole, message: `Rendered hole ${holeNum} of ${totalHoles}…` });
      } catch (holeErr) { console.error(holeErr); }
    }

    if (renderedHoles.length === 0) throw new Error('No holes could be rendered.');
    onProgress({ pct: 100, message: `Done!` });
    onDone({ holeCount: renderedHoles.length, renderedHoles, osmData: { allFeatures, elevationGrid, bbox } });

  } catch (err) { onError({ message: err.message || 'An unexpected error occurred.' }); }
}

export async function reRenderHole({ holeWay, allFeatures, elevationGrid, bbox, colors, options }) {
  const holeNum = parseInt(holeWay.tags?.ref, 10) || 0, par = parseInt(holeWay.tags?.par, 10) || null;
  const features = categorizeFeatures(allFeatures, bbox, holeWay);

  const holeResult = await renderHole({ holeWay, features, elevationGrid, bbox, colors, options, holeNum, par });
  const greenResult = await renderGreenInset({ holeWay, features, bbox, colors, options, holeNum, par });

  const holeSvg = holeResult.svgString;
  const greenSvg = greenResult.svgString;
  const holeImageUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(holeSvg);
  const greenImageUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(greenSvg);

  return { 
    holeNum, par, holeImageUrl, greenImageUrl, holeSvg, greenSvg, 
    holeWidth: holeResult.width, holeHeight: holeResult.height, greenWidth: greenResult.width, greenHeight: greenResult.height, holeWay 
  };
}