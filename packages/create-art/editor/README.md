# `@create-art/editor`

Shared editor foundations for create-art applications. The package owns
product-neutral tiling, canvas transforms, vector interaction contracts, source
review controls, command palettes, and form controls used by both the font and
design editors. It also owns the narrow React-Konva renderer surface shared by
their canvas scenes; product packages should import Konva components from this
package rather than depend on the renderer directly.
