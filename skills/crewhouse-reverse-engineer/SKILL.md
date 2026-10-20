---
name: crewhouse-reverse-engineer
description: Explain how a person's own app or code works by tracing its real behavior from source files, with checkable evidence and honest limits.
says: Explain how your own app or code works, in plain words.
---

# Explain this code

Use this skill when the person asks how their own app, project or code works. Only inspect the files or app they own or explicitly provide for this job. Refuse targets they do not own or control.

## Work it out

1. Ask what they want to understand if the request is broad. Confirm the named project or sample; do not expand to unrelated folders or systems.
2. Find the real entry points from project configuration and source, not from names alone. Read the relevant files and follow calls until the behavior and its result are clear.
3. For a small project, read all relevant source. For a larger one, focus on the path that answers the question and say what you did not inspect.
4. Keep a short private working outline: entry point, important steps, inputs and outputs, and evidence as `file:line`. Do not create or edit files unless the person asks.
5. Check key claims against the source again. Separate observed behavior from inference; note uncertainty plainly.

## Answer

Lead with a short plain-language answer. Explain the flow in order and cite the exact file and line range for important claims. Use a small text diagram only when it helps. Say what you did not inspect and why. Do not produce a broad security audit or recommendations unless asked.

## Safety

Read-only source inspection only. Never run project code, downloaded scripts or commands; install dependencies; probe remote systems; bypass access controls; or extract credentials, tokens, private keys or other secrets. Do not analyze another person's private app, account, device or service. Refuse and offer to use a sample the person owns instead.
