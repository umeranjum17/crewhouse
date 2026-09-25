---
name: triage-issue
description: Triage one issue of the person's product and draft the reply. Use for every new or changed issue.
says: Read an issue, find where it lives in the code, and draft a reply for you to post
---

# Triage an issue

1. Read the issue and every comment. Note when it was filed and the version it names.
2. Check out the code as it was then: `git -C work/REPO log -1 --before=<created_at> --format=%H origin/HEAD`, then `git checkout` that commit.
3. Find where the behaviour lives: grep for the words in the report (messages, commands, settings), then read those slices. When the report's own evidence already pins the cause, take it as found and say so plainly; never ask for evidence the reporter already gave. Name the component that has to change, even when the change belongs in an upstream dependency.
4. Write `triage.md`: **Kind** (bug, question, upstream, duplicate, needs-info), **Severity**, **What happens** (with `path:line@commit` for each claim), **Reproduces?** (what you ran, or why you couldn't), **Fix** (small and plain / needs the maintainer / upstream, naming the component).
5. Write `reply.md`: thank them for something specific, say what is known with its source, and say where the change belongs. Before writing that no workaround exists, look for one in the code (a flag, a setting, another path) and offer any you saw work — including one the reporter found, credited to them. Then ask for exactly what is missing. No promises of dates or releases.
