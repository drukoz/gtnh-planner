# RUK-529 reference patches

Changes the CTO wrote and verified on `main` (`e5d667adc`) while measuring them, for the milestone 1 subtasks to apply:
`surplus-rule.patch` (subtask A), `lp-pool.patch` (subtask B) and `compress.patch` (subtask C). `layout-recheck.patch`, verified on
`feat/perf-m1` (`8676a9f4e`), fixes the regression of subtask D that QA found (RUK-543): the layout is checked again after every plan answer,
an answer of the same plan too. Each applies with `git apply` from the repository root. This folder is removed before the pull request is
marked ready.
