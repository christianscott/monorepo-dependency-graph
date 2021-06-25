import assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

enum Mode {
  TOPO = 1 << 1,
  VIZ = 1 << 2,
  ALL = TOPO & VIZ,
}

function parseCliArgs(argv: string[]): {
  debug: boolean;
  entrypoint: string;
  mode: Mode;
} {
  let args = argv.slice(2);
  let debug = false;
  if (args.includes("--debug")) {
    args = args.filter((arg) => arg !== "--debug");
    debug = true;
  }

  const [entrypoint, modeRaw] = args;
  assert.strict(entrypoint != null, `missing entrypoint`);

  let mode: Mode;
  switch (modeRaw) {
    case "topo":
      mode = Mode.TOPO;
      break;
    case "viz":
      mode = Mode.VIZ;
      break;
    case undefined:
      mode = Mode.ALL;
      break;
    default:
      throw new Error(`invalid mode ${modeRaw} (must be one of topo, viz)`);
  }

  return { debug, entrypoint, mode };
}

async function main() {
  const { debug, entrypoint, mode } = parseCliArgs(process.argv);

  const packageJsonPaths = await readAllLinesFromStdin();

  let graph = new DirectedGraph<string>();
  for (const p of packageJsonPaths) {
    const json = maybeReadJson(p);
    if (json == null) {
      debug && console.error(`skipping ${p} (unparseable)`);
      continue;
    }

    const name = json.name;
    if (name == null) {
      debug && console.error(`skipping ${p} (no name)`);
      continue;
    }

    const deps = [
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.devDependencies ?? {}),
    ];
    graph.addAll(name, ...deps);
  }

  if (!graph.edges.has(entrypoint)) {
    throw new Error(`could not find ${entrypoint}`);
  }

  if (entrypoint != null) {
    const inverted = graph.invert();
    const transitivelyDependsOnEntrypoint = inverted.walk(entrypoint);
    graph = graph.subgraph(transitivelyDependsOnEntrypoint);
  }

  mode & Mode.TOPO && console.log(graph.topoSort().join("\n"));
  mode & Mode.VIZ && console.log(graph.printAsGraphVis());
}

function maybeReadJson(p: string) {
  if (!path.isAbsolute(p) && process.env.BUILD_WORKING_DIRECTORY != null) {
    p = path.join(process.env.BUILD_WORKING_DIRECTORY, p);
  }

  const json = fs.readFileSync(p, "utf-8");
  try {
    return JSON.parse(json);
  } catch (error) {
    return undefined;
  }
}

function readAllLinesFromStdin(): Promise<string[]> {
  const lines: string[] = [];

  return new Promise((resolve, reject) => {
    const linereader = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    linereader.on("line", (line) => lines.push(line));

    linereader.on("close", () => resolve(lines));
  });
}

class DirectedGraph<T> {
  readonly edges: Map<T, Set<T>> = new Map();

  addAll(from: T, ...to: T[]) {
    let dependencies = this.edges.get(from);
    if (dependencies == null) {
      dependencies = new Set();
      this.edges.set(from, dependencies);
    }
    Sets.addAll(dependencies, to);
    this.ensureAll(to);
  }

  private ensureAll(nodes: Iterable<T>) {
    for (const node of nodes) {
      if (!this.edges.has(node)) {
        this.edges.set(node, new Set());
      }
    }
  }

  isCyclic(): boolean {
    const seenOnAllWalks = new Set<T>();
    for (const node of this.edges.keys()) {
      if (seenOnAllWalks.has(node)) {
        continue;
      }

      const seenOnThisWalk = new Set<T>();
      const toVisit = [...this.edges.get(node)!];
      while (toVisit.length > 0) {
        const nextNode = toVisit.shift()!;
        if (seenOnThisWalk.has(nextNode)) {
          return true; // cyclic
        }
        seenOnThisWalk.add(nextNode);
        const nextNodeChildren = this.edges.get(nextNode);
        nextNodeChildren && toVisit.push(...nextNodeChildren);
      }

      Sets.addAll(seenOnAllWalks, seenOnThisWalk);
    }

    return false;
  }

  indegrees() {
    const inDegrees = new Map<T, number>();
    for (const [node, neighbours] of this.edges.entries()) {
      if (!inDegrees.has(node)) {
        inDegrees.set(node, 0);
      }

      for (const neighbour of neighbours) {
        const count = inDegrees.get(neighbour) || 0;
        inDegrees.set(neighbour, count + 1);
      }
    }
    return inDegrees;
  }

  topoSort(): readonly T[] {
    const inDegrees = this.indegrees();
    const sources: T[] = [];
    for (const [node, count] of inDegrees.entries()) {
      if (count === 0) {
        sources.push(node);
      }
    }

    assert.strict(
      sources.length > 0,
      `a DAG must have at least one source (a node with an in-degree of 0)`
    );

    const topologicalOrdering = [];
    while (sources.length > 0) {
      const node = sources.pop()!;
      topologicalOrdering.push(node);
      const neighbours = this.edges.get(node) || new Set();
      for (const neighbour of neighbours) {
        const neighbourIndegree = inDegrees.get(neighbour)! - 1;
        inDegrees.set(neighbour, neighbourIndegree);
        if (neighbourIndegree === 0) {
          sources.push(neighbour);
        }
      }
    }

    assert.strict(
      topologicalOrdering.length === this.edges.size,
      `Graph has a cycle! No topological ordering exists.`
    );

    return topologicalOrdering;
  }

  invert(): DirectedGraph<T> {
    const inverted = new DirectedGraph<T>();
    for (const [edge, deps] of this.edges) {
      inverted.addAll(edge);
      for (const dep of deps) {
        inverted.addAll(dep, edge);
      }
    }
    return inverted;
  }

  walk(start: T): Set<T> {
    const toVisit = [start];
    const seen = new Set<T>();
    while (toVisit.length > 0) {
      const next = toVisit.shift()!;
      for (const dep of this.edges.get(next)!) {
        if (seen.has(dep)) {
          continue;
        }
        toVisit.push(dep);
      }
      seen.add(next);
    }
    return seen;
  }

  subgraph(keep: Set<T>): DirectedGraph<T> {
    const subgraph = new DirectedGraph<T>();
    for (const [node, deps] of this.edges) {
      if (!keep.has(node)) {
        continue;
      }
      subgraph.addAll(node, ...[...deps].filter((dep) => keep.has(dep)));
    }
    return subgraph;
  }

  printAsGraphVis(): string {
    let out = "";
    const line = (s: string) => (out += s + "\n");

    line("digraph G {");
    for (const [pkg, deps] of this.edges) {
      line(`  "${pkg}"`);
      for (const dep of deps) {
        line(`  "${pkg}" -> "${dep}"`);
      }
    }
    line("}");

    return out;
  }
}

class Sets {
  static addAll<T>(s: Set<T>, xs: Iterable<T>) {
    for (const x of xs) {
      s.add(x);
    }
  }
}

main().catch((err) => {
  throw err;
});
