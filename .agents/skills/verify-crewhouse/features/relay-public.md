# Public relay pairing

`link.relayPublic` separates a cloud machine's provider-facing relay origin from the local address crewd dials.
No hosted Crewhouse relay, provider API or real cloud machine is needed for this backend journey.

## Drive and prove

Run from the candidate checkout under an isolated HOME, XDG directories and TMPDIR, through the memory gate:

```bash
node --test --test-name-pattern='the relay address:' test/link.test.ts
```

The existing phone-link journey starts real `src/main.ts` on the stub engine and a real `relay/main.ts`
server on OS-assigned ports. A disposable TCP proxy stands in for the provider's public port (HTTP/WS,
not a TLS or boat.dev proof). The driver uses the person's owned HTTP capability to:

1. Configure `PUT /api/phones/relay {url, publicUrl, enrol}`. Witness local registration with zero public
   proxy connections, and both normalized origins in `GET /api/phones/link`.
2. Reject invalid public URLs and unauthorized updates without changing the live connection.
3. Check that the QR offer carries the public link, never the local relay dial address. Feed
   `adapter.phoneTyped()` through the shared `readTyped`, then kit `findHost` against the public origin.
4. Pair by `pairWithCode` over the public proxy, compare the two Noise verification words and approve
   through the owned HTTP API. Open the kit's `DeviceLink` and read `/api/reach`: public URL present.
5. Confirm phone admin remains refused; send a synthetic Chief message and witness its task finish
   through that same link. The log emits one JSON `proof: relayPublic` row with addresses and outcomes,
   never a capability, pairing code, invitation or device secret.
6. Clear the public override through an ordinary relay update and witness the live `link.urls` change.

Retain the command and stdout/stderr as evidence. Run the complete `test/link.test.ts` and
`test/relay.test.ts` too. Every listener, proxy socket and phone created by this journey is closed by
its cleanup hooks; the daemon is stopped by the file's cleanup hook. `./crewhouse test` separately
verifies the owner's `~/.pi` remains byte-for-byte unchanged.

No screenshots, PWA/native captures or real AI sign-in are claimed: this change only chooses transport
addresses. Stub Chief words prove the product/link path, not a hosted model answer.
