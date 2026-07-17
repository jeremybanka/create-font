# Font projects

Each immediate subdirectory is an independently addressable create-font font
project. The development server discovers projects by finding
`fonts/*/create-font.json`.

When the repository contains one font, `font dev` selects it automatically. With
multiple projects, pass the directory name, as in `font dev <name>`. Run
`create-font <name>` inside the workspace to add another font project.
