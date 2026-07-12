/**
 * What do artists say about…
 * Interactive territory map for Dr Gil Dekel's PhD interview dataset.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const GROUPS = ['Poets', 'Painters', 'Installation artists'];
  const GROUP_SLUGS = {
    all: 'all',
    Poets: 'poets',
    Painters: 'painters',
    'Installation artists': 'installation-artists',
  };
  const SLUG_TO_GROUP = Object.fromEntries(
    Object.entries(GROUP_SLUGS).map(([group, slug]) => [slug, group === 'all' ? 'all' : group])
  );

  const BREATH_AMPLITUDE = 0.01;
  const BREATH_DURATION_MS = 13500;
  const TERRITORY_TRANSITION_MS = 900;
  const GLASS_GAP_PX = 10;
  const LABEL_SIZE_BONUS = 2;
  const HOVER_SCALE = 1.04;
  const HOVER_IN_MS = 480;
  const HOVER_OUT_MS = 100;

  const STAINED_GLASS = [
    '#a8c4d8', '#94b4c8', '#90c4bc', '#b4c4a0', '#a4b088',
    '#d8c888', '#ccba88', '#c8a090', '#c8a0a8', '#a898b8', '#b4a8c8',
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let rawData = [];
  let slugToTheme = new Map();
  let themeToSlug = new Map();

  const state = {
    artistGroup: 'all',
    searchQuery: '',
    currentTheme: null,
    view: 'home',
  };

  let themeNodes = [];
  let svg = null;
  let gRoot = null;
  let gGlass = null;
  let gLabels = null;
  let breathFrameId = null;
  let breathStart = 0;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dom = {};

  let themeTaxonomy = new Map();
  let taxonomyGraph = new Map();
  const taxonomyState = { theme: null };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function next() {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function themeSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function buildSlugMaps(data) {
    slugToTheme = new Map();
    themeToSlug = new Map();
    const themes = [...new Set(data.map((d) => d.theme))];
    themes.forEach((theme) => {
      let slug = themeSlug(theme);
      let unique = slug;
      let n = 2;
      while (slugToTheme.has(unique) && slugToTheme.get(unique) !== theme) {
        unique = `${slug}-${n++}`;
      }
      slugToTheme.set(unique, theme);
      themeToSlug.set(theme, unique);
    });
  }

  function slugToGroupParam(slug) {
    return SLUG_TO_GROUP[slug] || null;
  }

  function groupToSlugParam(group) {
    return GROUP_SLUGS[group] || 'all';
  }

  function deepenColor(hex, amount = 0.1) {
    const color = d3.color(hex);
    if (!color) return hex;

    const hsl = d3.hsl(color);
    if (!Number.isNaN(hsl.h)) {
      hsl.l = Math.max(0, hsl.l * (1 - amount));
      return hsl.formatHex();
    }

    color.r = Math.max(0, color.r * (1 - amount));
    color.g = Math.max(0, color.g * (1 - amount));
    color.b = Math.max(0, color.b * (1 - amount));
    return color.formatHex();
  }

  function assignGlassColors(nodes, delaunay) {
    const neighborSets = nodes.map((_, i) => {
      const set = new Set();
      for (const j of delaunay.neighbors(i)) set.add(j);
      return set;
    });

    const order = nodes
      .map((n, i) => ({ n, i, degree: neighborSets[i].size }))
      .sort((a, b) => b.degree - a.degree);

    nodes.forEach((n) => {
      n.colorIndex = -1;
    });

    order.forEach(({ n, i }) => {
      const used = new Set();
      for (const j of delaunay.neighbors(i)) {
        if (nodes[j].colorIndex >= 0) used.add(nodes[j].colorIndex);
      }

      let pick = (n.seed + i) % STAINED_GLASS.length;
      let guard = 0;
      while (used.has(pick) && guard < STAINED_GLASS.length) {
        pick = (pick + 1) % STAINED_GLASS.length;
        guard++;
      }

      n.colorIndex = pick;
      n.fill = STAINED_GLASS[pick];
      n.hoverFill = deepenColor(n.fill, 0.3);
    });
  }

  // ---------------------------------------------------------------------------
  // Label wrapping
  // ---------------------------------------------------------------------------

  function wrapLabel(text, maxChars = 14) {
    const words = text.split(/\s+/).flatMap((word) => {
      if (word.includes('/')) {
        return word.replace(/\//g, ' / ').split(/\s+/).filter(Boolean);
      }
      return [word];
    });

    const lines = [];
    let line = '';

    words.forEach((word) => {
      if (line && `${line} ${word}`.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 5);
  }

  function wordPerLineLabel(text) {
    return text.split(/\s+/).flatMap((word) => {
      if (word.includes('/')) {
        return word.replace(/\//g, ' / ').split(/\s+/).filter(Boolean);
      }
      return [word];
    });
  }

  const LABEL_OVERRIDES = {
    'Inspiration from outside': { wordPerLine: true, sizeAdjust: -2 },
    'Inspiration from inside': { wordPerLine: true, sizeAdjust: -2 },
    'Point of view': { sizeAdjust: -2 },
    Contrasts: { sizeAdjust: -2 },
    Logic: { sizeAdjust: -2 },
  };


  function polygonBoundsRect(polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    polygon.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function fitLabelInCell(node, polygon, center) {
    const bounds = polygonBoundsRect(polygon);
    const area = Math.abs(d3.polygonArea(polygon));
    const centroid = center || d3.polygonCentroid(polygon);

    node.cx = centroid[0];
    node.cy = centroid[1];
    node.cellArea = area;

    const maxW = bounds.width * 0.86;
    const maxH = bounds.height * 0.82;
    const override = LABEL_OVERRIDES[node.name];
    let maxChars = Math.max(5, Math.floor(maxW / 5.8));
    let lines = override?.wordPerLine
      ? wordPerLineLabel(node.name)
      : wrapLabel(node.name, maxChars);
    let fs = Math.min(20, Math.max(8.5, Math.sqrt(area) * 0.122));

    function textFits(testLines, testFs) {
      const textW = Math.max(...testLines.map((l) => l.length), 1) * testFs * 0.52;
      const textH = testLines.length * testFs * 1.2;
      return textW <= maxW && textH <= maxH;
    }

    while (!textFits(lines, fs) && fs > 6.5) {
      fs -= 0.35;
    }

    if (!override?.wordPerLine) {
      while (!textFits(lines, fs) && maxChars > 4) {
        maxChars -= 1;
        lines = wrapLabel(node.name, maxChars);
      }

      while (!textFits(lines, fs) && lines.length > 1) {
        lines = lines.slice(0, -1);
      }
    }

    const fittedFs = fs;

    if (override?.sizeAdjust != null) {
      fs = Math.max(6.5, fittedFs + override.sizeAdjust);
      while (!textFits(lines, fs) && fs > 6.5) {
        fs -= 0.35;
      }
    } else if (!override?.wordPerLine && textFits(lines, fittedFs + LABEL_SIZE_BONUS)) {
      fs = fittedFs + LABEL_SIZE_BONUS;
    }

    node.labelLines = lines;
    node.fontSize = fs;
  }

  // ---------------------------------------------------------------------------
  // Angular territory geometry
  // ---------------------------------------------------------------------------

  function angularPath(polygon) {
    if (!polygon || polygon.length < 3) return '';
    return (
      polygon
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
        .join(' ') + ' Z'
    );
  }

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /** Shrink polygon inward from its centre — creates uniform white mortar gaps. */
  function insetPolygon(polygon, gapPx) {
    if (!polygon || polygon.length < 3) return polygon || [];

    const [cx, cy] = d3.polygonCentroid(polygon);
    const inset = gapPx / 2;

    let minEdgeDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      minEdgeDist = Math.min(
        minEdgeDist,
        pointToSegmentDistance(cx, cy, a[0], a[1], b[0], b[1])
      );
    }

    if (minEdgeDist <= inset) return polygon.map(([x, y]) => [cx, cy]);

    const scale = (minEdgeDist - inset) / minEdgeDist;
    return polygon.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
  }

  function sqrtWeight(count, counts) {
    const extent = d3.extent(counts);
    if (extent[0] === extent[1]) return 1;
    return d3.scaleSqrt().domain(extent).range([0.55, 1.45])(count);
  }

  // ---------------------------------------------------------------------------
  // Data aggregation
  // ---------------------------------------------------------------------------

  function aggregateThemes(groupFilter = 'all', searchQuery = '') {
    const q = searchQuery.trim().toLowerCase();
    const filtered = rawData.filter((row) => {
      if (groupFilter !== 'all' && row.artist_group !== groupFilter) return false;
      if (!q) return true;
      return (
        row.theme.toLowerCase().includes(q) ||
        row.artist_name.toLowerCase().includes(q) ||
        row.quote.toLowerCase().includes(q)
      );
    });

    const byTheme = d3.rollups(
      filtered,
      (v) => v.length,
      (d) => d.theme
    );

    const allThemes = [...new Set(rawData.map((d) => d.theme))];
    const nodes = allThemes.map((name, index) => {
      const match = byTheme.find(([theme]) => theme === name);
      const count = match ? match[1] : 0;
      const seed = hashString(name);
      const tax = themeTaxonomy.get(name);
      return {
        name,
        count,
        slug: themeToSlug.get(name),
        seed,
        index,
        matchesSearch: count > 0,
        isHovered: false,
        conceptualGroup2: tax ? tax.g2 : '',
      };
    });

    return nodes.filter((n) => n.count > 0 || (!q && groupFilter === 'all'));
  }

  function getFilteredQuotes(theme, groupFilter, searchQuery) {
    const q = searchQuery.trim().toLowerCase();
    return rawData
      .filter((row) => row.theme === theme)
      .filter((row) => groupFilter === 'all' || row.artist_group === groupFilter)
      .filter((row) => {
        if (!q) return true;
        return (
          row.theme.toLowerCase().includes(q) ||
          row.artist_name.toLowerCase().includes(q) ||
          row.quote.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => +a.order - +b.order);
  }

  function normalizeThemeTitle(name) {
    return name.replace(/\s+\)/g, ')');
  }

  function formatArtistProfession(group) {
    const labels = {
      Poets: 'Poet',
      Painters: 'Painter',
      'Installation artists': 'Installation artist',
    };
    return labels[group] || group;
  }

  function formatAttribution(row) {
    const profession = formatArtistProfession(row.artist_group);
    return profession ? `${row.artist_name}; ${profession}` : row.artist_name;
  }

  // ---------------------------------------------------------------------------
  // Conceptual taxonomy (cached for hover disclosure — Group 2 only)
  // ---------------------------------------------------------------------------

  function buildTaxonomyCache() {
    themeTaxonomy.clear();
    taxonomyGraph.clear();

    rawData.forEach((row) => {
      const theme = row.theme;
      if (!themeTaxonomy.has(theme)) {
        themeTaxonomy.set(theme, {
          g2: row['Conceptual Group 2'] || '',
        });
      }
    });

    const themes = [...themeTaxonomy.keys()];
    themes.forEach((theme) => {
      const { g2 } = themeTaxonomy.get(theme);
      const sameG2 = themes.filter(
        (otherTheme) => otherTheme !== theme && themeTaxonomy.get(otherTheme).g2 === g2
      );
      taxonomyGraph.set(theme, { g2, sameG2 });
    });
  }

  function g2Family(themeName) {
    const graph = taxonomyGraph.get(themeName);
    return new Set([themeName, ...(graph ? graph.sameG2 : [])]);
  }

  function isTaxonomyDim(name) {
    if (!taxonomyState.theme) return false;
    return !g2Family(taxonomyState.theme).has(name);
  }

  function syncTaxonomyClasses() {
    if (!gGlass || !gLabels || !taxonomyState.theme) return;

    gGlass.selectAll('.territory-node').classed('is-taxonomy-dim', (d) => isTaxonomyDim(d.name));
    gLabels.selectAll('.territory-label').classed('is-taxonomy-dim', (d) => isTaxonomyDim(d.name));
  }

  function clearTaxonomyHover() {
    taxonomyState.theme = null;
    if (gGlass) gGlass.selectAll('.territory-node').classed('is-taxonomy-dim', false);
    if (gLabels) gLabels.selectAll('.territory-label').classed('is-taxonomy-dim', false);
  }

  function activateTaxonomyHover(node) {
    if (state.view !== 'home') return;

    taxonomyState.theme = node.name;
    syncTaxonomyClasses();
  }

  function onTerritoryPointerLeave(event) {
    const related = event.relatedTarget;
    if (related && typeof related.closest === 'function' && related.closest('.territory-node')) {
      return;
    }
    clearTaxonomyHover();
  }

  function onConstellationPointerLeave(event) {
    const related = event.relatedTarget;
    if (related && dom.constellation.contains(related)) return;
    clearTaxonomyHover();
  }

  // ---------------------------------------------------------------------------
  // Weighted Voronoi territory layout
  // ---------------------------------------------------------------------------

  function initSites(nodes, width, height, pad) {
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;

    nodes.forEach((n) => {
      const rng = mulberry32(n.seed);
      n.x = pad + innerW * (0.12 + rng() * 0.76);
      n.y = pad + innerH * (0.1 + rng() * 0.8);
    });
  }

  function simulateSites(nodes, width, height, pad) {
    const counts = nodes.map((n) => n.count);
    const weights = nodes.map((n) => {
      n.targetWeight = sqrtWeight(n.count, counts);
      return n.targetWeight * n.targetWeight;
    });
    const totalWeight = d3.sum(weights);
    const area = (width - pad * 2) * (height - pad * 2);

    nodes.forEach((n) => {
      const share = (n.targetWeight * n.targetWeight) / totalWeight;
      n.radius = Math.sqrt((share * area) / Math.PI) * 0.82;
    });

    const simulation = d3
      .forceSimulation(nodes)
      .force('x', d3.forceX(width / 2).strength(0.035))
      .force('y', d3.forceY(height / 2).strength(0.035))
      .force('collide', d3.forceCollide((d) => d.radius + 1.5).iterations(4))
      .force('charge', d3.forceManyBody().strength(-6))
      .stop();

    for (let i = 0; i < 140; i++) simulation.tick();
  }

  function lloydRelaxation(nodes, width, height, pad, iterations = 12) {
    const totalWeight = d3.sum(nodes, (n) => n.targetWeight * n.targetWeight);
    const totalArea = (width - pad * 2) * (height - pad * 2);
    const bounds = [pad, pad, width - pad, height - pad];

    for (let k = 0; k < iterations; k++) {
      const delaunay = d3.Delaunay.from(
        nodes,
        (d) => d.x,
        (d) => d.y
      );
      const voronoi = delaunay.voronoi(bounds);

      nodes.forEach((n, i) => {
        const poly = voronoi.cellPolygon(i);
        if (!poly || poly.length < 3) return;

        const centroid = d3.polygonCentroid(poly);
        const cellArea = Math.abs(d3.polygonArea(poly));
        const desiredArea = ((n.targetWeight * n.targetWeight) / totalWeight) * totalArea;
        const ratio = desiredArea / (cellArea || 1);
        const pull = Math.min(0.55, Math.max(0.18, 0.32 + (ratio - 1) * 0.12));

        n.x += (centroid[0] - n.x) * pull;
        n.y += (centroid[1] - n.y) * pull;
      });
    }

    const delaunay = d3.Delaunay.from(
      nodes,
      (d) => d.x,
      (d) => d.y
    );
    return delaunay.voronoi(bounds);
  }

  function buildTerritories(nodes, width, height) {
    const pad = 10;
    const visible = nodes.filter((n) => n.count > 0);
    if (!visible.length) return [];

    initSites(visible, width, height, pad);
    simulateSites(visible, width, height, pad);
    const voronoi = lloydRelaxation(visible, width, height, pad);
    const delaunay = d3.Delaunay.from(
      visible,
      (d) => d.x,
      (d) => d.y
    );
    assignGlassColors(visible, delaunay);

    visible.forEach((n, i) => {
      const poly = voronoi.cellPolygon(i);
      if (!poly || poly.length < 3) {
        n.polygon = [];
        n.basePoints = [];
        n.path = '';
        return;
      }

      n.polygon = poly.map((p) => [p[0], p[1]]);
      n.basePoints = n.polygon;
      const center = d3.polygonCentroid(n.polygon);
      n.renderPolygon = insetPolygon(n.polygon, GLASS_GAP_PX);
      n.path = angularPath(n.renderPolygon);
      fitLabelInCell(n, n.renderPolygon, center);
    });

    return visible;
  }

  // ---------------------------------------------------------------------------
  // Rendering — home territory map
  // ---------------------------------------------------------------------------

  function getConstellationSize() {
    const el = dom.constellation;
    return {
      width: Math.max(320, el.clientWidth),
      height: Math.max(320, el.clientHeight),
    };
  }

  function openTheme(node) {
    hideTooltip();
    navigateToTheme(node.name);
  }

  function applyTerritoryLabels(selection) {
    selection.each(function (d) {
      if (!d.labelLines || d.cx == null) return;
      const text = d3.select(this);
      text.selectAll('tspan').remove();

      const lines = d.labelLines;
      const fs = d.fontSize || 9;
      const lineHeight = fs * 1.2;
      const blockHeight = (lines.length - 1) * lineHeight;
      const firstDy = -blockHeight / 2;

      text
        .style('font-size', `${fs}px`)
        .attr('x', d.cx)
        .attr('y', d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle');

      lines.forEach((line, i) => {
        text
          .append('tspan')
          .attr('x', d.cx)
          .attr('dy', i === 0 ? firstDy : lineHeight)
          .text(line);
      });
    });
  }

  function hoverTransform(d, lift = 2) {
    return `translate(${d.cx},${d.cy - lift}) scale(${HOVER_SCALE}) translate(${-d.cx},${-d.cy})`;
  }

  function setTerritoryHover(nodeSelection, d, active) {
    const piece = nodeSelection.select('.territory-piece');
    const fillPath = nodeSelection.select('.territory-fill');
    piece.interrupt();
    fillPath.interrupt();
    nodeSelection.classed('is-hovered', active);

    const targetFill = active ? d.hoverFill || deepenColor(d.fill, 0.3) : d.fill;
    fillPath
      .transition()
      .duration(active ? 180 : HOVER_OUT_MS)
      .attr('fill', targetFill);

    if (prefersReducedMotion) {
      piece.attr('transform', active ? hoverTransform(d) : null);
    } else if (active) {
      piece
        .attr('transform', null)
        .transition()
        .duration(HOVER_IN_MS)
        .ease(d3.easeElasticOut.amplitude(1.05).period(0.38))
        .attr('transform', hoverTransform(d));
    } else {
      piece
        .transition()
        .duration(HOVER_OUT_MS)
        .ease(d3.easeCubicIn)
        .attr('transform', null);
    }

    if (active) {
      nodeSelection.raise();
      gLabels.selectAll('.territory-label').filter((label) => label.name === d.name).raise();
    }
  }

  function renderConstellation() {
    if (state.view !== 'home') return;

    clearTaxonomyHover();

    const { width, height } = getConstellationSize();
    const hasSearch = state.searchQuery.trim().length > 0;
    const nodes = aggregateThemes(state.artistGroup, state.searchQuery);
    themeNodes = buildTerritories(nodes, width, height);

    if (!svg) {
      svg = d3
        .select(dom.constellation)
        .append('svg')
        .attr('role', 'img')
        .attr('aria-label', 'Stained-glass map of creative themes from artist interviews');

      gRoot = svg.append('g').attr('class', 'map-root');
      gGlass = gRoot.append('g').attr('class', 'glass-pieces');
      gLabels = gRoot.append('g').attr('class', 'glass-labels');
      svg.append('defs');
    }

    const defs = svg.select('defs');
    svg.select('.map-background').remove();
    svg.insert('rect', ':first-child')
      .attr('class', 'map-background')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#F7F6F2');

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const bind = (layer, className) =>
      layer.selectAll(`.${className}`).data(themeNodes, (d) => d.name);

    // --- Glass pieces (fill + shine + hit area) ---
    const glassSel = bind(gGlass, 'territory-node');
    const glassEnter = glassSel
      .enter()
      .append('g')
      .attr('class', 'territory-node')
      .attr('tabindex', 0)
      .attr('role', 'button');

    glassEnter.append('path').attr('class', 'territory-hit');
    const piece = glassEnter.append('g').attr('class', 'territory-piece');
    piece.append('path').attr('class', 'territory-fill');

    const glassMerged = glassEnter.merge(glassSel);

    glassMerged
      .attr('aria-label', (d) => `${d.name}. ${d.count} quotations. Press Enter to explore.`)
      .on('click', function (event, d) {
        event.preventDefault();
        event.stopPropagation();
        if (prefersReducedMotion) {
          openTheme(d);
          return;
        }
        const pieceEl = d3.select(this).select('.territory-piece');
        pieceEl
          .transition()
          .duration(380)
          .attr('transform', hoverTransform(d, 3))
          .transition()
          .duration(220)
          .attr('transform', null);
        setTimeout(() => openTheme(d), 420);
      })
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTheme(d);
        }
      })
      .on('mouseenter focus', function (event, d) {
        d.isHovered = true;
        setTerritoryHover(d3.select(this), d, true);
        showTooltip(event, d);
        activateTaxonomyHover(d);
      })
      .on('mouseleave blur', function (event, d) {
        d.isHovered = false;
        setTerritoryHover(d3.select(this), d, false);
        hideTooltip();
        onTerritoryPointerLeave(event);
      })
      .classed('is-dimmed', (d) => hasSearch && !d.matchesSearch)
      .classed('is-hidden', (d) => d.count === 0)
      .classed('is-selected', (d) => state.currentTheme === d.name);

    glassMerged.each(function (d) {
      if (!d.path) return;

      const node = d3.select(this);
      node.select('.territory-hit').attr('d', d.path);
      node
        .select('.territory-fill')
        .attr('fill', d.fill)
        .attr('stroke', 'none')
        .transition()
        .duration(TERRITORY_TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr('d', d.path);
    });

    glassSel.exit().transition().duration(400).style('opacity', 0).remove();

    // --- Labels (top layer) ---
    const labelSel = bind(gLabels, 'territory-label');
    const labelEnter = labelSel.enter().append('text').attr('class', 'territory-label');
    const labelMerged = labelEnter.merge(labelSel);

    applyTerritoryLabels(labelMerged);

    labelMerged
      .each(function (d) {
        if (!d.path) return;
        const clipId = `clip-label-${d.slug}`;
        defs.select(`#${clipId}`).remove();
        defs.append('clipPath').attr('id', clipId).append('path').attr('d', d.path);
        d3.select(this).attr('clip-path', `url(#${clipId})`);
      })
      .classed('is-dimmed', (d) => hasSearch && !d.matchesSearch)
      .classed('is-hidden', (d) => d.count === 0);

    labelSel.exit().remove();
    gLabels.raise();

    renderMobileThemes(themeNodes);
    updateSearchStatus();
    startBreathing();
  }

  function renderMobileThemes(nodes) {
    const sorted = [...nodes]
      .filter((n) => n.count > 0)
      .sort((a, b) => b.count - a.count);

    const list = dom.mobileThemes;
    list.innerHTML = '';

    sorted.forEach((node) => {
      const li = document.createElement('li');
      li.className = 'mobile-theme-card';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-theme-button';
      btn.textContent = node.name;
      btn.setAttribute('aria-label', `${node.name}. ${node.count} quotations`);
      btn.addEventListener('click', () => openTheme(node));
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------------
  // Breathing animation — whole map
  // ---------------------------------------------------------------------------

  function startBreathing() {
    stopBreathing();
    if (prefersReducedMotion || state.view !== 'home' || !gRoot) return;

    breathStart = performance.now();

    function tick(now) {
      if (state.view !== 'home' || !gRoot) return;

      const elapsed = now - breathStart;
      const cycle = (elapsed % BREATH_DURATION_MS) / BREATH_DURATION_MS;
      const breath = 1 + BREATH_AMPLITUDE * Math.sin(cycle * Math.PI * 2);

      const { width, height } = getConstellationSize();
      const cx = width / 2;
      const cy = height / 2;

      gRoot.attr(
        'transform',
        `translate(${cx},${cy}) scale(${breath}) translate(${-cx},${-cy})`
      );

      breathFrameId = requestAnimationFrame(tick);
    }

    breathFrameId = requestAnimationFrame(tick);
  }

  function stopBreathing() {
    if (breathFrameId) {
      cancelAnimationFrame(breathFrameId);
      breathFrameId = null;
    }
    if (gRoot) gRoot.attr('transform', null);
  }

  // ---------------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------------

  function showTooltip(event, d) {
    const tooltip = dom.tooltip;
    tooltip.hidden = false;
    tooltip.innerHTML = `
      <strong>${escapeHtml(d.name)}</strong>
      ${d.count} quotation${d.count === 1 ? '' : 's'}
      <span class="hint">Click to explore</span>
    `;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const tooltip = dom.tooltip;
    const pad = 16;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const rect = tooltip.getBoundingClientRect();

    if (x + rect.width > window.innerWidth - pad) {
      x = event.clientX - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = event.clientY - rect.height - pad;
    }

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    dom.tooltip.hidden = true;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Theme view
  // ---------------------------------------------------------------------------

  function renderThemeView(theme) {
    dom.themeHeading.textContent = theme;
    const quotes = getFilteredQuotes(theme, state.artistGroup, state.searchQuery);
    const container = dom.quotations;
    container.innerHTML = '';

    if (!quotes.length) {
      container.innerHTML = '<p class="no-results">No quotations match the current filter.</p>';
      return;
    }

    quotes.forEach((row) => {
      const card = document.createElement('figure');
      card.className = 'quote-card';
      card.setAttribute('role', 'listitem');

      const blockquote = document.createElement('blockquote');
      blockquote.textContent = row.quote;

      const caption = document.createElement('figcaption');
      caption.textContent = formatAttribution(row);

      card.appendChild(blockquote);
      card.appendChild(caption);
      container.appendChild(card);
    });
  }

  function resetArtistFilter() {
    state.artistGroup = 'all';
    syncArtistGroupRadios();
  }

  function showHomeView(replace = false) {
    state.view = 'home';
    state.currentTheme = null;
    resetArtistFilter();

    dom.app.classList.remove('is-theme-view');

    dom.viewHome.hidden = false;
    dom.viewHome.classList.remove('hidden');
    dom.viewTheme.hidden = true;
    dom.viewTheme.classList.add('hidden');

    renderConstellation();

    const hash = buildHomeHash();
    updateHistory({ view: 'home' }, hash, replace);
  }

  function showThemeView(theme, replace = false) {
    stopBreathing();
    clearTaxonomyHover();
    hideTooltip();

    state.view = 'theme';
    state.currentTheme = theme;
    resetArtistFilter();

    if (dom.siteTitle) {
      dom.siteTitle.style.transform = '';
    }

    dom.app.classList.add('is-theme-view');

    dom.viewHome.hidden = true;
    dom.viewHome.classList.add('hidden');
    dom.viewTheme.hidden = false;
    dom.viewTheme.classList.remove('hidden');

    renderThemeView(theme);

    const slug = themeToSlug.get(theme);
    const hash = buildThemeHash(slug, 'all');
    updateHistory({ view: 'theme', theme, group: 'all' }, hash, replace);
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  function buildThemeHash(slug, group) {
    if (group && group !== 'all') {
      return `#${slug}?group=${groupToSlugParam(group)}`;
    }
    return `#${slug}`;
  }

  function buildHomeHash() {
    return '';
  }

  function parseLocation() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) {
      return { view: 'home', theme: null, group: 'all' };
    }

    const [slug, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    const groupSlug = params.get('group');
    const group = groupSlug ? slugToGroupParam(groupSlug) || 'all' : 'all';
    const theme = slugToTheme.get(slug);

    if (!theme) {
      return { view: 'home', theme: null, group: 'all' };
    }

    return { view: 'theme', theme, group };
  }

  function updateHistory(stateObj, hash, replace) {
    const url = hash ? `${window.location.pathname}${hash}` : window.location.pathname;
    if (replace) {
      history.replaceState(stateObj, '', url);
    } else {
      history.pushState(stateObj, '', url);
    }
  }

  function navigateToTheme(theme) {
    showThemeView(theme, false);
  }

  function navigateHome() {
    state.searchQuery = '';
    if (dom.searchInput) dom.searchInput.value = '';
    if (dom.searchStatus) {
      dom.searchStatus.textContent = '';
      dom.searchStatus.classList.add('visually-hidden');
    }
    showHomeView(false);
  }

  // ---------------------------------------------------------------------------
  // Search & filters
  // ---------------------------------------------------------------------------

  function updateSearchStatus() {
    const q = state.searchQuery.trim();
    const status = dom.searchStatus;

    if (!q) {
      status.textContent = '';
      status.classList.add('visually-hidden');
      return;
    }

    if (state.view === 'home') {
      const visible = themeNodes.filter((n) => n.matchesSearch).length;
      status.textContent = `${visible} theme${visible === 1 ? '' : 's'} match "${q}"`;
    } else if (state.currentTheme) {
      const count = getFilteredQuotes(state.currentTheme, state.artistGroup, q).length;
      status.textContent = `${count} quotation${count === 1 ? '' : 's'} match "${q}"`;
    }

    status.classList.remove('visually-hidden');
  }

  function onSearchInput(event) {
    state.searchQuery = event.target.value;
    if (state.view === 'home') {
      renderConstellation();
    } else if (state.currentTheme) {
      renderThemeView(state.currentTheme);
      updateSearchStatus();
    }
  }

  function syncArtistGroupRadios() {
    dom.artistFilters
      .querySelectorAll('input[name="artist-group"]')
      .forEach((input) => {
        input.checked = input.value === state.artistGroup;
      });
  }

  function onArtistGroupChange(event) {
    state.artistGroup = event.target.value;

    if (state.view === 'home') {
      renderConstellation();
    } else if (state.currentTheme) {
      renderThemeView(state.currentTheme);
      const slug = themeToSlug.get(state.currentTheme);
      updateHistory(
        { view: 'theme', theme: state.currentTheme, group: state.artistGroup },
        buildThemeHash(slug, state.artistGroup),
        true
      );
    }

    updateSearchStatus();
  }

  // ---------------------------------------------------------------------------
  // Data loading & init
  // ---------------------------------------------------------------------------

  async function loadData() {
    rawData = await d3.csv('dataset.csv');
    rawData.forEach((row) => {
      row.theme = normalizeThemeTitle(row.theme);
    });
    buildSlugMaps(rawData);
    buildTaxonomyCache();
  }

  function cacheDom() {
    dom.app = document.querySelector('.app');
    dom.artistFilters = document.getElementById('artist-filters');
    dom.searchInput = document.getElementById('search-input');
    dom.searchStatus = document.getElementById('search-results-status');
    dom.constellation = document.getElementById('constellation');
    dom.mobileThemes = document.getElementById('mobile-themes');
    dom.viewHome = document.getElementById('view-home');
    dom.viewTheme = document.getElementById('view-theme');
    dom.homeLink = document.getElementById('home-link');
    dom.siteTitle = document.querySelector('.site-title');
    dom.themeHeading = document.getElementById('theme-heading');
    dom.quotations = document.getElementById('quotations');
    dom.tooltip = document.getElementById('tooltip');
  }

  function bindEvents() {
    dom.searchInput.addEventListener('input', onSearchInput);
    dom.artistFilters.addEventListener('change', onArtistGroupChange);

    dom.constellation.addEventListener('mouseleave', onConstellationPointerLeave);

    dom.homeLink.addEventListener('click', (event) => {
      event.preventDefault();
      navigateHome();
    });

    document.querySelectorAll('a.external-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
      });
    });

    window.addEventListener('popstate', () => {
      const route = parseLocation();
      if (route.view === 'theme' && route.theme) {
        showThemeView(route.theme, true);
      } else {
        showHomeView(true);
      }
    });

    window.addEventListener(
      'resize',
      debounce(() => {
        if (state.view === 'home') renderConstellation();
      }, 200)
    );

    document.addEventListener('mousemove', (event) => {
      if (!dom.tooltip.hidden && event.target.closest('.territory-node')) {
        positionTooltip(event);
      }
    });
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  async function init() {
    cacheDom();
    bindEvents();

    try {
      await loadData();
    } catch (err) {
      dom.constellation.innerHTML =
        '<p class="no-results">Unable to load dataset.csv. Please ensure the file is in the same folder as this page.</p>';
      console.error(err);
      return;
    }

    const route = parseLocation();
    if (route.view === 'theme' && route.theme) {
      showThemeView(route.theme, true);
    } else {
      showHomeView(true);
    }
  }

  init();
})();
