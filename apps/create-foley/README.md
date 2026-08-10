# create-foley

`create-foley` scaffolds source-first sound-effect projects. `foley dev` opens
the browser sound designer, `foley check` validates source, and `foley render`
mixes the project to a deterministic 48 kHz WAV by default.

```sh
npx create-foley cinematic-hit
cd cinematic-hit
npm run dev
```

Project source is split into `create-foley.json`, `layers/index.json`, and one
reviewable JSON file per procedural layer. No audio plug-ins, cloud service, or
API key is required.

The editor follows the shared `create-` application conventions: it tracks the
system appearance with explicit light and dark overrides, provides undo and
redo, and includes a persistent 12-slot action hotbar. Open the command palette
with `Mod+Shift+P`; drag commands to hotbar slots or press `Mod+Enter` to assign
the highlighted command with a slot key.
