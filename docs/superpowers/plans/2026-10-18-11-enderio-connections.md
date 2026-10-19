# EnderIO Conduits and Connections View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fourth logistics mode, EnderIO conduits (item and fluid conduits in bundles, every machine face set to Input / Output / In-Out with its own extract filter, insert filter, input colour, output colour, speed upgrades, priority, round robin, self feed and redstone mode), and a "Connections" project tab that draws any planned line, in all four modes, as a schematic graph with every face's configuration.

**Architecture:** (filled in below once the research is pinned)

**Tech Stack:** TypeScript 6.0.3 (erasable syntax), Node 24, React 19.3, three 0.186.1, elkjs 0.12.0, vitest 5.0.3, Playwright 1.63.0 — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.6 (mode 4 "EnderIO conduits"), §3.7, §3.8, §3.8c, §3.10; architecture `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.7, §7.1–§7.2, §11.13, §11.14, §11.30; Plan 5 `docs/superpowers/plans/2026-10-17-05-line-layout-3d.md`.

## Global Constraints

(filled in below)

## Review Focus

(filled in below)

## Task outline

1. Docs, mode plumbing and EnderIO facts (shared types, constants, sizing, parts)
2. Channel and filter planner (pure)
3. EnderIO mode: conduit bundles, faces, tail chests, hookup
4. Layout integration: fluids over conduits, steps, configure text, BOM
5. Map overlay and 3D bundles
6. Connections graph model (all four modes)
7. Connections tab (view, face details, tab registration)
8. End-to-end check, real-data check, README

---
