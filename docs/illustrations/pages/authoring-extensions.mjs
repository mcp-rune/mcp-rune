// pages/authoring-extensions.mjs
//
// Authoring source for the authoring-extensions guide's illustrations.
// Ported from the pilot's authoring-extensions.html. Two tree figures:
// the five-piece file shape, and the bulk-actions walkthrough.

import { colorizeTree } from '../illus.mjs'

// Build the "five-piece extension shape" tree.
// Verbatim ASCII from the pilot's #src-shape block.
function buildShapeFigure() {
  const ascii = `your-extension/
├── types.ts         (1) Config type the extension consumes
├── capabilities.ts  (2) Typed helper + (3) typed reader
├── factory.ts       (4) Service factory (only if you contribute a service)
├── extension.ts     (5) MCP tools + the searchExtension()-style factory
└── index.ts             Public re-exports — one stable import path`

  const altText =
    'Directory tree of an extension: types.ts (Config type), ' +
    'capabilities.ts (typed helper + typed reader), an optional ' +
    'factory.ts (service factory), extension.ts (MCP tools + the ' +
    'searchExtension()-style factory), and index.ts (public re-exports).'

  return { svg: colorizeTree(ascii), alt: altText }
}

// Build the "bulk-actions" walkthrough tree.
// Same shape minus the optional factory.
function buildBulkFigure() {
  const ascii = `src/api-extensions/bulk-actions/
├── types.ts
├── capabilities.ts
├── extension.ts
└── index.ts`

  const altText =
    'Directory tree of src/api-extensions/bulk-actions/ containing ' +
    'four files: types.ts, capabilities.ts, extension.ts, and index.ts.'

  return { svg: colorizeTree(ascii), alt: altText }
}

export const shape = buildShapeFigure()
export const bulk = buildBulkFigure()
