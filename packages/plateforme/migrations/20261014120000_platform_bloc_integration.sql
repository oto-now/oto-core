-- Version 1.4.3 du paquet : le bloc « Intégration » (`embed`), la page `https` d'un autre site montrée dans une page,
-- dans une iframe isolée (pages et blocs). Les contraintes de type et de forme des blocs sont reposées telles que les
-- écrit 20260930100000_v1_1_0.sql (partie 3), le type `embed` et sa forme en plus. Additive : aucun bloc existant ne
-- change de forme admise.

alter table platform.blocks
  drop constraint blocks_type_check,
  add constraint blocks_type_check check (type = any (array['heading', 'paragraph', 'list', 'checklist', 'code', 'call', 'mermaid', 'image', 'callout', 'reference', 'row', 'simple_table', 'divider', 'toggle', 'file', 'embed'])),
  drop constraint blocks_shape_check,
  add constraint blocks_shape_check check (coalesce(
    case type
      when 'heading' then text is not null and char_length(btrim(text)) between 1 and 200 and text !~ '[\r\n]'
        and jsonb_path_exists(data, '$."level" ? (@ == 1 || @ == 2 || @ == 3 || @ == 4 || @ == 5)')
      when 'paragraph' then text is not null
      when 'list' then text is null
        and coalesce(jsonb_typeof(data -> 'items'), '') = 'array'
        and jsonb_array_length(data -> 'items') between 1 and 500
        -- premier niveau : des chaînes ou des objets
        and not jsonb_path_exists(data, 'strict $.items[*] ? (@.type() != "string" && @.type() != "object")')
        -- un élément objet : `text` et `children` seuls ; `children` : `items` non vide, `ordered` et `start` facultatifs
        and not jsonb_path_exists(data, 'lax $.items[*] ? (@.type() == "object" && !(@.text.type() == "string" && @.children.type() == "object" && !exists(@.keyvalue() ? (@.key != "text" && @.key != "children")) && @.children.items.type() == "array" && @.children.items.size() > 0 && !exists(@.children.keyvalue() ? (@.key != "items" && @.key != "ordered" && @.key != "start")) && (!exists(@.children.ordered) || @.children.ordered.type() == "boolean") && (!exists(@.children.start) || (@.children.start.type() == "number" && @.children.start >= 1))))')
        -- deuxième niveau : même forme ; une erreur de parcours (`null`) vaut un refus
        and not coalesce(jsonb_path_exists(data, 'strict $.items[*] ? (@.type() == "object").children.items[*] ? (@.type() != "string" && @.type() != "object")', '{}', true), true)
        and not jsonb_path_exists(data, 'lax $.items[*].children.items[*] ? (@.type() == "object" && !(@.text.type() == "string" && @.children.type() == "object" && !exists(@.keyvalue() ? (@.key != "text" && @.key != "children")) && @.children.items.type() == "array" && @.children.items.size() > 0 && !exists(@.children.keyvalue() ? (@.key != "items" && @.key != "ordered" && @.key != "start")) && (!exists(@.children.ordered) || @.children.ordered.type() == "boolean") && (!exists(@.children.start) || (@.children.start.type() == "number" && @.children.start >= 1))))')
        -- troisième niveau : des chaînes seules, aucun quatrième niveau
        and not coalesce(jsonb_path_exists(data, 'strict $.items[*] ? (@.type() == "object").children.items[*] ? (@.type() == "object").children.items[*] ? (@.type() != "string")', '{}', true), true)
        -- 500 éléments en tout : un élément porte une seule chaîne, son texte
        and jsonb_array_length(jsonb_path_query_array(data, 'strict $.items.** ? (@.type() == "string")')) <= 500
        and ((data -> 'ordered') is null or jsonb_typeof(data -> 'ordered') = 'boolean')
        and ((data -> 'start') is null or jsonb_path_exists(data, '$."start" ? (@.type() == "number" && @ >= 1)'))
      when 'checklist' then text is null
        and jsonb_typeof(data -> 'items') = 'array'
        and jsonb_array_length(data -> 'items') between 1 and 500
        and not jsonb_path_exists(data, '$."items"[*] ? (!(exists (@."text" ? (@.type() == "string"))) || !(exists (@."checked" ? (@.type() == "boolean"))))')
      when 'code' then text is not null and ((data -> 'language') is null or jsonb_typeof(data -> 'language') = 'string')
      when 'call' then text is null
        and jsonb_typeof(data -> 'function') = 'string'
        and char_length(data ->> 'function') between 1 and 100
        and jsonb_typeof(data -> 'args') = 'object'
      when 'mermaid' then text is not null and char_length(btrim(text)) >= 1
      -- une adresse `https` externe, ou un fichier joint (E10-S02), jamais les deux
      when 'image' then ((jsonb_typeof(data -> 'src') = 'string'
          and char_length(data ->> 'src') between 1 and 2000
          and (data -> 'file_id') is null)
        or (jsonb_typeof(data -> 'file_id') = 'string'
          and (data ->> 'file_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (data -> 'src') is null))
        and ((data -> 'alt') is null or jsonb_typeof(data -> 'alt') = 'string')
        and ((data -> 'width') is null or (jsonb_typeof(data -> 'width') = 'string' and (data ->> 'width') in ('small', 'medium', 'full')))
      when 'callout' then text is not null and ((data -> 'tone') is null or jsonb_typeof(data -> 'tone') = 'string')
      when 'reference' then text is null
        and jsonb_typeof(data -> 'path') = 'string'
        and (data ->> 'path') ~ '^[a-z0-9_]+(/[a-z0-9_]+)*$'
        and char_length(data ->> 'path') <= 1000
        and ((data -> 'view') is null or jsonb_typeof(data -> 'view') = 'object')
      when 'row' then text is null and key is not null
      -- une cellule : une ligne, sans blanc de bord, chaque `|` précédé d'un nombre impair de `\`
      when 'simple_table' then text is null
        and coalesce(jsonb_typeof(data -> 'columns'), '') = 'array'
        and jsonb_array_length(data -> 'columns') between 1 and 20
        and coalesce(jsonb_typeof(data -> 'rows'), '') = 'array'
        and jsonb_array_length(data -> 'rows') <= 200
        and not jsonb_path_exists(data, 'strict $.rows[*] ? (@.type() != "array" || @.size() != $n)', jsonb_build_object('n', jsonb_array_length(data -> 'columns')))
        and not jsonb_path_exists(data, 'strict $.columns[*] ? (@.type() != "string" || @ like_regex "[\r\n]" || @ like_regex "^[ \t]" || @ like_regex "[ \t]$" || @ like_regex "(^|[^\\\\])(\\\\\\\\)*[|]")')
        and not jsonb_path_exists(data, 'strict $.rows[*][*] ? (@.type() != "string" || @ like_regex "[\r\n]" || @ like_regex "^[ \t]" || @ like_regex "[ \t]$" || @ like_regex "(^|[^\\\\])(\\\\\\\\)*[|]")')
        and ((data -> 'align') is null or (jsonb_typeof(data -> 'align') = 'array'
          and jsonb_array_length(data -> 'align') = jsonb_array_length(data -> 'columns')
          and not jsonb_path_exists(data, 'strict $.align[*] ? (!(@.type() == "null" || (@.type() == "string" && (@ == "left" || @ == "center" || @ == "right"))))')))
      when 'divider' then text is null
      -- le corps : sans ligne blanche de bord, sans ligne `<details…` ni `</details>`
      when 'toggle' then text is not null
        and (text = '' or (text !~ '^[ \t]*(\n|$)' and text !~ '(^|\n)[ \t]*$'))
        and text !~ '(^|\n)[ \t]*<details'
        and text !~ '(^|\n)[ \t]*</details>[ \t]*(\n|$)'
        and coalesce(jsonb_typeof(data -> 'summary'), '') = 'string'
        and char_length(btrim(data ->> 'summary')) between 1 and 200
        and (data ->> 'summary') !~ '[\r\n]'
      -- un fichier joint (E10-S02) : son identifiant, son nom, sa taille (1 octet à 50 Mo) et son type
      when 'file' then text is null
        and coalesce(jsonb_typeof(data -> 'file_id'), '') = 'string'
        and (data ->> 'file_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and coalesce(jsonb_typeof(data -> 'name'), '') = 'string'
        and char_length(data ->> 'name') between 1 and 255
        and coalesce(jsonb_path_exists(data, 'strict $.size ? (@.type() == "number" && @ >= 1 && @ <= 52428800 && @ == @.floor())', '{}', true), false)
        and coalesce(jsonb_typeof(data -> 'mime'), '') = 'string'
        and char_length(data ->> 'mime') between 1 and 255
      -- un cadre intégré (1.4.3) : une adresse `https` de 9 à 2 000 caractères, sans blanc ni guillemet, et sa hauteur facultative
      when 'embed' then text is null
        and coalesce(jsonb_typeof(data -> 'url'), '') = 'string'
        and char_length(data ->> 'url') between 9 and 2000
        and starts_with(data ->> 'url', 'https://')
        and (data ->> 'url') !~ '[[:space:]"''<>]'
        and ((data -> 'height') is null or (jsonb_typeof(data -> 'height') = 'string' and (data ->> 'height') in ('small', 'medium', 'large')))
      else null
    end, false));

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   delete from platform.blocks where type = 'embed' ;
--   blocks_type_check et blocks_shape_check : reprendre la partie 3 de 20260930100000_v1_1_0.sql.
