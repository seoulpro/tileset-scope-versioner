# Security policy

## Supported versions

During the `0.x` series, only the current `latest` release on npm receives
security fixes. Older releases are not supported, and backports are not
promised. When it is safe and practical, confirm whether the issue reproduces
on the latest release before reporting.

## Reporting a vulnerability

Do not report vulnerabilities through public GitHub issues.

Email [lim@limsumin.com](mailto:lim@limsumin.com) with the subject
`SECURITY: tileset-scope-versioner`. If the repository's Security tab offers
private vulnerability reporting, you may use that instead; otherwise email is
the working private route.

Please include:

- the affected package version and your operating system;
- a minimal fabricated directory tree and manifests that reproduce the issue;
- the exact command or API options used;
- the observed impact and any known mitigation.

Remove private asset names and contents unless they are essential to the report.

## Scope

This package reads asset trees and can write manifests, a sidecar, and a state
file. Treat the configured root and every manifest beneath it as
security-sensitive filesystem input. Reports about the following are in scope:
path traversal, symbolic-link escape (including links in output parent
directories), reads or writes outside the root, content-hash confusion, unsafe
handling of manifest keys, and partial publication that can expose inconsistent
versions.

The library does not fetch remote references, validate the semantic correctness
of 3D Tiles content, upload assets, or control CDN behavior.

## Operational advice

Run the package with only the filesystem permissions required for the target
asset root, and use `--dry-run` before applying it to an unfamiliar tree. The
package rejects existing symbolic links in scope and output paths, but callers
should still prevent an untrusted concurrent process from replacing path
components during publication. Output files are replaced atomically one at a
time; use a staged directory and an external atomic switch if the entire
publication must change as one transaction.
