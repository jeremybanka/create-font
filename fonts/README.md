# Font projects

Each immediate subdirectory is an independently addressable create-font font
project. The development server discovers projects by finding
`fonts/*/create-font.json`.

When the repository contains one font, `create-font serve` selects it
automatically. With multiple projects, use `create-font serve --font=<name>`.
