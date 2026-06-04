// pages/domain-knowledge.mjs
//
// Authoring source for the domain-knowledge guide's illustrations.
// Ported from the pilot's domain-knowledge.html. Two tree figures:
// the framework + server architecture, and the server-specific
// domain directory shape.

import { colorizeTree } from '../illus.mjs'

// Build the "framework classes, domain tools & server data" tree.
// Verbatim ASCII from the pilot's #src-arch block.
function buildArchFigure() {
  const ascii = `lib/mcp/domain/                      # Framework classes (shared)
├── knowledge.js                     # DomainConcept + DomainKnowledge
├── business-rules.js                # BusinessRule + RuleSet
├── workflows.js                     # WorkflowStep + WorkflowDefinition + WorkflowRegistry
└── registry.js                      # DomainRegistry (aggregates all of the above)

lib/mcp/tools/domain/                # Domain tools (shared)
├── base-domain-tool.js              # BaseDomainTool (DOMAIN category, no auth)
├── get-domain-context-tool.js       # Retrieves composed context for a model/concept
├── check-business-rules-tool.js     # Validates data against business rules
├── suggest-workflow-tool.js         # Returns a workflow roadmap + first step
└── get-workflow-step-tool.js        # Returns detail for a specific workflow step

src/<server>/domain/                 # Server-specific domain data
├── registry.js                      # Factory: createXxxDomainRegistry()
├── knowledge/
│   └── concepts.js                  # DomainConcept instances
├── rules/
│   ├── <domain>-rules.js            # BusinessRule instances
│   └── mutability-rules.js          # Auto-generated from model metadata
└── workflows/
    └── <workflow-category>.js       # WorkflowDefinition instances`

  const altText =
    'Directory tree showing three roots. lib/mcp/domain/ holds shared ' +
    'framework classes (knowledge.js, business-rules.js, workflows.js, ' +
    'registry.js). lib/mcp/tools/domain/ holds shared domain tools ' +
    '(base-domain-tool.js, get-domain-context-tool.js, ' +
    'check-business-rules-tool.js, suggest-workflow-tool.js, ' +
    'get-workflow-step-tool.js). src/<server>/domain/ holds the ' +
    'server-specific data: registry.js, knowledge/concepts.js, ' +
    'rules/<domain>-rules.js and mutability-rules.js, and ' +
    'workflows/<workflow-category>.js.'

  return { svg: colorizeTree(ascii), alt: altText }
}

// Build the "server domain directory structure" tree.
// Minimal shape for a new server's domain directory.
function buildSetupFigure() {
  const ascii = `src/<server>/domain/
├── registry.js
├── knowledge/
│   └── concepts.js
├── rules/
│   └── <domain>-rules.js
└── workflows/
    └── <category>.js`

  const altText =
    'Minimal directory tree for a server domain: registry.js at the ' +
    'top, plus knowledge/concepts.js, rules/<domain>-rules.js, and ' +
    'workflows/<category>.js.'

  return { svg: colorizeTree(ascii), alt: altText }
}

export const arch = buildArchFigure()
export const setup = buildSetupFigure()
