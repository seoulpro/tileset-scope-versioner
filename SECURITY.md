# Security policy

This package reads asset trees and can write manifests, a sidecar, and a state
file. Treat the configured root and every manifest beneath it as
security-sensitive filesystem input.

Report path traversal, symbolic-link escape (including links in output parent
directories), reads or writes outside the root, content-hash confusion, unsafe
handling of manifest keys, or partial publication that can expose inconsistent
versions through the repository's private vulnerability reporting feature. If
that feature is unavailable, open a public issue without exploit details and
request a private channel.

Include the affected package version, operating system, minimal directory tree
and manifests, command or API options, impact, and any known mitigation. Remove
private asset names and contents unless they are essential to the report.

The library does not fetch remote references, validate the semantic correctness
of 3D Tiles content, upload assets, or control CDN behavior. Run it with only
the filesystem permissions required for the target asset root, and use
`--dry-run` before applying it to an unfamiliar tree. The package rejects
existing symbolic links in scope and output paths, but callers should still
prevent an untrusted concurrent process from replacing path components during
publication. Output files are replaced atomically one at a time; use a staged
directory and an external atomic switch if the entire publication must change
as one transaction.
