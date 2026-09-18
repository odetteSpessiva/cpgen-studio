# Roadmap

CPGen Studio is currently in alpha (`0.2.4-alpha.1`). This document tracks the features planned for the `1.0` release.

## Milestone: 1.0

The `1.0` release is defined by full **subtask support**: the ability to define independent schema trees per subtask, each with its own weight, inside a single workspace. This is the largest structural change on the roadmap and the last major feature before a stable release.

All other items below are being implemented in the lead-up to `1.0`.

---

## Generation & Schema

- [x] **Problem name field**: expose the problem name field already supported by the generation backend (currently hardcoded on the frontend)
- [x] **Starting index for test generation**: configurable starting index instead of a fixed default
- [x] **Optional solution file**: support generating tests only, without requiring a solution file
- [x] **Per-block separator field**: configurable separator between block outputs (currently hardcoded to newline)
- [x] **Field output expressions**: allow a field's output to be a derived expression (e.g. output `2*Q` instead of the raw generated value)
- [x] **Optional block output**: a block is omitted from output entirely when its output expression evaluates to empty/blank
- [x] **Conditional block**: an `IF` block supporting basic branching logic within a schema tree
- [ ] **Additional block types**: expand the block library over time
- [x] **Savable schema**: export/import the schema as JSON
- [x] **Cross-container drag and drop**: move blocks between nested containers and the root reliably

## Fixes

- [x] **Remove index delivery option in visual mode**: not applicable in this mode, should be hidden/disabled
- [ ] **Optimize schema builder's findParentList**: currently running an (potentially) expensive tree walk when user starts dragging

## Editor & UI

- [x] **Color-coded blocks**: visual differentiation by block category (input / output / constraint / generator, etc.)
- [x] **Settings page**: global configuration for application behavior, compiler flags, and other configurable defaults
- [x] Replace pylsp path setting with py env path because my dumbass forgot it was a python module, not an executable
- [x] Format on save

## Subtasks (1.0)

- [ ] Subtask-aware workspace file format
- [ ] Subtask menu: create, select, and switch between subtasks
- [ ] Independent schema tree per subtask
- [ ] Per-subtask weight/percentage
- [ ] Validation that subtask weights sum to ~100%
- [ ] Subtask-aware test generation (numbering and output organization per subtask)
- [ ] Migration path for existing single-tree workspace files to the subtask format

## Other

- [x] Support LSP for code autocompletion
- [x] In app method to download mingw
- [ ] Output format for strings
- [ ] Support other languages

---

## Sequencing

Smaller, self-contained items above are being implemented first. Subtasks are deliberately last, since they change the underlying schema and workspace file format: building the smaller features against the current model first minimizes rework once that change lands.
