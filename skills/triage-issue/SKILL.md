---
name: triage-issue
description: Triage one issue of the person's product and draft the reply. Use for every new or changed issue.
says: Read an issue, find where it lives in the code, and draft a reply for you to post
---

# Triage an issue

1. Read the issue and every comment. Note when it was filed and the version it names.
2. Check out the code as it was then: `git -C work/REPO log -1 --before=<created_at> --format=%H origin/HEAD`, then `git checkout` that commit.
3. Find where the behaviour lives: grep for the words in the report (messages, commands, settings), then read those slices.
4. Write `triage.md`: **Kind** (bug, question, upstream, duplicate, needs-info), **Severity**, **What happens** (with `path:line@commit` for each claim), **Reproduces?** (what you ran, or why you couldn't), **Fix** (small and plain / needs the maintainer / upstream).
5. Write `reply.md`: thank them for something specific, say what is known with its source, give a workaround only if you saw it work in the code, and ask for exactly what is missing. No promises of dates or releases.
