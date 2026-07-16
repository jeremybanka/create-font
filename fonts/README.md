# Font projects

Each immediate subdirectory is an independently addressable Trigraph font
project. The development server discovers projects by finding
`fonts/*/trigraph.json`.

When the repository contains one font, `trigraph serve` selects it
automatically. With multiple projects, use `trigraph serve --font=<name>`.
