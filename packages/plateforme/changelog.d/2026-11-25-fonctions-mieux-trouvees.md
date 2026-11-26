### Assistants
- `context` proposes up to three functions for every request, also under a served procedure, ranked like procedures (full text, trigrams, typos); `find` ranks its functions the same way.
- `find` and `context` put first the functions you can call; one without your account, or above its level, comes after, only if clearly better, marked "to connect" or "ask for access".
- The description of `find` says "up to five functions" (three before), and `find` serves five.
- `find` scores a function between 0 and 1 like a node, no longer as the share of words found, and leaves out those under 0.40, as `context` does.
- `read` of path `functions` becomes an outline by connector past 45,000 characters; `section` set to a connector name, or to the name of the host's API, reads its functions.
- `context` names the personal accounts colleagues shared with you, with their owner and your level: used only when named in `call`, never one not shared with you.
