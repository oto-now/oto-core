### Assistants
- The rules of `context` are shorter: nothing a tool's description already says; one line on a procedure's title and summary; a tool not named may exist: `find` it first.
- `context` lists the closest procedures and contents without score nor words in common, and serves each summary as its first sentence, 160 characters at most; `read` serves it whole.
- « Recent content » in `context` holds 10 lines (20 before); `read path journal` gives the rest.
- « Shared with you by other teams » lists 25 entry points at most, then says how many more and to `find` them.
- The guide (section procedures) and `write.procedure` say how to title a procedure (a verb and an object) and what its summary holds (three to five ways people ask for it).

### Hosts
- UI: the preference sentence of the connect screen (`preferenceSentence`) has four lines, the last one for people with several Oto; the note against pasting it with several connectors is gone. People who pasted the former sentence replace it.
- Server: `previewContext` also returns `related` (the close pages and tables, with `score` and `words`) and `words` on each candidate; the « Contexte » screen reads the scores and words there, no longer in the served text.
- Schemas: `SERVED_GUESTS` loses `cutMark`, `countOne`, `countMany`, `countEnd` (the size tiers of the guest view are gone) and gains `moreStart`, `moreMiddle`, `moreEnd`; `SERVED_RELATED.score` is only in `find` lines now.
