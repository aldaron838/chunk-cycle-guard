/**
 * Every static import cycle between the chunks of a Rollup or Vite output
 * bundle.
 *
 * Bundle shape: the object Rollup hands to its `generateBundle` hook. Each key
 * is an output file name and equals that entry's `fileName`. A chunk entry has
 * `type: 'chunk'`, `fileName`, `imports` and `dynamicImports`. An asset entry
 * has `type: 'asset'` and takes no part in the graph.
 *
 * Edges: chunk A's `imports` containing chunk B's file name is the edge A to B.
 * `dynamicImports` is ignored unless `options.includeDynamic` is true, in which
 * case dynamic edges join the static ones. An import target that is not a chunk
 * in the bundle is ignored, which covers assets and externals. A repeated
 * target counts once. A missing `imports` or `dynamicImports` reads as empty.
 *
 * Result: every elementary cycle, each reported once. A cycle is an array of
 * file names in import order with no repeated element, and the edge from its
 * last element back to its first is implied. A chunk importing itself is the
 * one element cycle `[fileName]`.
 *
 * Canonical form: each cycle is rotated to start at its lexicographically
 * smallest file name, by rotation only and never by reversal. The result is
 * sorted by comparing cycles element by element, and a cycle that is a prefix
 * of another sorts first.
 *
 * Throws a TypeError when `bundle` is not a non-null object.
 *
 * @param {Record<string, { type?: string, fileName?: string, imports?: string[], dynamicImports?: string[] }>} bundle
 * @param {{ includeDynamic?: boolean }} [options]
 * @returns {string[][]}
 */
export function findCircularChunks(bundle, options = {}) {
  if (bundle === null || typeof bundle !== 'object') {
    throw new TypeError('bundle must be a non-null object');
  }

  const graph = buildGraph(bundle, options?.includeDynamic === true);
  const cycles = [];

  // Each cycle is found from its smallest chunk only: the search from `start`
  // visits only chunks that sort after `start`. Thus each cycle is reported
  // once, and it is already rotated to its canonical form. Because the start
  // chunks and the edge lists are sorted, the cycles also come out in the
  // canonical order.
  for (const start of graph.keys()) {
    const allowed = chunksThatReach(start, graph);
    const path = [start];
    const onPath = new Set(path);

    const visit = (name) => {
      for (const next of graph.get(name)) {
        if (next === start) {
          cycles.push([...path]);
        } else if (allowed.has(next) && !onPath.has(next)) {
          path.push(next);
          onPath.add(next);
          visit(next);
          onPath.delete(next);
          path.pop();
        }
      }
    };

    visit(start);
  }

  return cycles;
}

/**
 * The chunk graph as a map from each chunk's file name to the sorted,
 * de-duplicated file names of the chunks it imports. The map's keys are sorted
 * too.
 */
function buildGraph(bundle, includeDynamic) {
  const names = Object.keys(bundle)
    .filter((name) => bundle[name]?.type === 'chunk')
    .sort(compareNames);
  const isChunk = new Set(names);

  const graph = new Map();
  for (const name of names) {
    const { imports = [], dynamicImports = [] } = bundle[name];
    const targets = includeDynamic ? [...imports, ...dynamicImports] : imports;
    const edges = new Set(targets.filter((target) => isChunk.has(target)));
    graph.set(name, [...edges].sort(compareNames));
  }
  return graph;
}

/**
 * The chunks that sort after `start` and can reach `start` through chunks that
 * sort after it. A search that stays inside this set never enters a dead end,
 * so a graph without cycles costs no search at all.
 */
function chunksThatReach(start, graph) {
  const importers = new Map();
  for (const [name, edges] of graph) {
    if (name < start) continue;
    for (const target of edges) {
      if (target < start) continue;
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push(name);
    }
  }

  const reached = new Set();
  const pending = [start];
  while (pending.length > 0) {
    for (const name of importers.get(pending.pop()) ?? []) {
      if (name !== start && !reached.has(name)) {
        reached.add(name);
        pending.push(name);
      }
    }
  }
  return reached;
}

/** Plain code unit order, which does not depend on the machine's locale. */
function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One cycle as the closed path a build log can print, for example
 * `native-sdk -> vendor -> native-sdk`: the cycle's elements joined by ` -> `
 * with its first element repeated at the end. A one element cycle renders as
 * `a -> a`.
 *
 * Throws a TypeError when `cycle` is not a non-empty array of strings.
 *
 * @param {string[]} cycle
 * @returns {string}
 */
export function formatCycle(cycle) {
  if (
    !Array.isArray(cycle) ||
    cycle.length === 0 ||
    !cycle.every((name) => typeof name === 'string')
  ) {
    throw new TypeError('cycle must be a non-empty array of strings');
  }
  return [...cycle, cycle[0]].join(' -> ');
}
