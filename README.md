# Monorepo Dependency Graph

> Analyze relationships between NPM/Yarn packages in a monorepo

## Usage

Requires `bazel`.

### Visualising the dependencies between packages

Visialise the relationships between the packages, starting at some entrypoint. Example:

```bash
$ find example -name package.json | bazel run :bin four viz
<bazel stuff on stderr>
digraph G {
  "three"
  "three" -> "four"
  "four"
  "one"
  "one" -> "two"
  "one" -> "three"
  "two"
  "two" -> "four"
}
```

You can then paste this into graphviz to generate an SVG like the following:

![Example Graph](/doc/graph.svg)

### Generating an "ordering" of your dependencies, starting at an entrypoint

If for any reason you wanted to topologically order the packages in your monorepo, you can use the `topo` command.

```bash
$ find example -name package.json | bazel run :bin four topo
<bazel stuff on stderr>
one
three
two
four
```
