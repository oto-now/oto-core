### Assistants
- A table column may declare an optional `label` (1 to 100 characters, trimmed), written with the header of `write` and merged like the other attributes.
- `table.schema` serves a column's label in `columns` and on its line (« shown as « Montant estimé » »); publishing names its change (« changed ref (label) »).

### Hosts
- Schemas: `TableColumn` and `TableColumnPatch` gain `label` (optional).
- UI: the table screens show a column's label wherever they show the column (header, filter, provenance, totals, review, view), else its name.
