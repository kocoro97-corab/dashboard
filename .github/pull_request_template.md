## Problem and resulting behavior

## Modified files

## Validation

- [ ] Node, Python, and browser checks passed; CI run is linked.
- [ ] OCR fixtures are synthetic; no private account identifiers or real holdings were committed.
- [ ] Mock validation and live API validation are reported separately.
- [ ] NH general domestic/overseas inquiry still works in regression tests; no order routes were added.
- [ ] Unknown quotes display unavailable, not zero; stock identities are not guessed.

## GAS impact and rollback

- [ ] Describe any new files, storage schema, concurrency rules, and recovery behavior.
- [ ] Main merge requires explicit user approval.
- [ ] Production GAS deployment requires separate explicit approval and a manual workflow trigger.
- [ ] No production Google/NH requests or private-source exports occurred during this PR task.

Rollback:
