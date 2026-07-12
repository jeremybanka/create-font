# react-konva under Preact compatibility

`@trigraph/editor` uses `react-konva` through Preact's React-compatibility
layer. Keep this boundary deliberate:

- Pin `react-konva` to `18.2.16` and Konva to `10.3.0`. React-Konva 19
  rejects Preact Compat's reported React 18 version at runtime.
- Use genuine React and ReactDOM `18.3.1` for isolated React-Konva roots.
  React-Konva's private reconciler needs React internals that Preact Compat
  does not implement; a global React-to-Preact alias will build but crashes
  when a Stage first updates.
- Keep the ordinary editor shell in Preact. Mount each Konva scene into a host
  element with a genuine `react-dom/client` root and pass only plain immutable
  view data and callbacks across that boundary. Never invoke hooks from one
  runtime in the other tree.
- Bind atom.io to Preact through a small adapter over the document Silo's
  public read, write, and subscribe methods. Do not rely on conditional React
  aliases inside Atom.io dependencies.
- Keep React type declarations on the React 18 line. React-Konva 18's type
  graph still relies on the global JSX namespace removed by React 19 types.
- Keep the React-Konva scene factories and React-root bridge centralized under
  `packages/editor/src/`; do not weaken strict TypeScript settings or cast a
  React component into a Preact component.
- Read atom.io state in ordinary Preact components and pass plain geometry
  and callbacks into the Konva tree. Write state from event callbacks.
- Set a Stage's real width and height from its container. Do not resize it
  with CSS transforms, which can desynchronize drawing and hit testing.
- Keep drag movement local during a gesture, then commit one state
  transaction on drag end so one gesture remains one undo step.
- Keep a Node integration canary that creates a Konva Group container and
  calls React-Konva's reconciler `createContainer` and `updateContainer` with
  a genuine React element. Static builds do not expose reconciler mismatches.
- On any renderer, Preact, or compatibility-layer upgrade, verify a real
  browser mount and point drag before accepting the new versions.
