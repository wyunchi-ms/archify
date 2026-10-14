# Agent instructions

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for repository changes and [REVIEWING.md](REVIEWING.md) for reviews.

## Live Archify installations

Install, update, reinstall, or remove a live Archify installation only when the user explicitly requests that action. Repository editing, testing, reviewing, publishing, or syncing does not authorize installation. This applies to Skills CLI, manual ZIP copies, and DSH plugins. Reuse authorization already given for the same action and scope; ask only for unresolved decisions.

- Keep the source, Skill/package, target agents, and global/project scope within the request. Avoid bulk operations or force flags that expand that scope. An update notification is informational.
- Before a Skills CLI install, discover the selected source with `npx -y skills add <source> --list --full-depth` (default source: `tt-a1i/archify`) and verify exactly one Skill named `archify`. For an explicitly requested durable local source, inspect that checkout. Stop on failed or ambiguous discovery.
- Use the canonical remote source by default. Use a local source only when requested, from a durable checkout; live symlinks must not point into temporary directories or disposable worktrees.
- Preserve unrelated files and existing unmanaged destinations. Report a destination conflict before replacing it unless that exact replacement is already explicitly authorized; use the installer's documented conflict handling within the approved scope.
- Report the action, source, targets, and result, including skipped or failed destinations. A partial installation is not a complete success.

### Authorized development Skill synchronization

The current checkout's user has explicitly authorized keeping their user-level
GitHub Copilot `archify` Skill synchronized after feature updates on
`wyunchi/drill-down`. This is a scoped exception to the explicit-action rule
above, not authorization to change other users' installations.

- After the feature changes and relevant validation are complete, synchronize
  only `archify` from this durable checkout to the current user's existing
  GitHub Copilot global installation. Use Skills CLI copy mode; do not install
  other agents, update Pi/DSH packages, or use the canonical remote instead.
- Before each sync, repeat source discovery and check that
  `.archify-development-install.json` in the installed Skill still points to
  this checkout. Skills CLI does not record this local global source in its
  remote-update lock. If the branch, source, agent, scope,
  or destination ownership differs, report the mismatch rather than replacing
  another installation. If the installation has been removed, do not recreate
  it automatically.
- The scoped command is `npx -y skills add . --skill archify --agent github-copilot --global --copy --yes`.
  If registry resolution fails, use the repository's available pinned Skills
  CLI version after successful discovery; do not change global npm settings.
- Verify installed Skill/runtime files and a CLI smoke check after copying,
  then refresh that installation receipt with the source revision and report
  the synchronization result separately from commit/push. Use the installer's
  actual destination (currently the shared user directory `.agents\skills\archify`),
  not an assumed `.copilot\skills` path.
  This instruction does not authorize a background watcher or Git hook.
