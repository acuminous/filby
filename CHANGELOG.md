# Changelog

## Unreleased

### Upgrading

Upgrade and restart. Filby applies its own migrations when `init()` is called.

### Changed

- Aggregate functions select, for each key, the frame from the change set with the latest effective date rather than the most recently added frame. Previously, backfilling a change set dated before an existing one overrode the later values (#3).
