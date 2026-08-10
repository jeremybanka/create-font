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
