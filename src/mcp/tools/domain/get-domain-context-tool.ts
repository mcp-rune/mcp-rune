import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ToolResult } from '../tool-result.js'
import { BaseDomainTool } from './base-domain-tool.js'

interface ConceptDetail {
  inheritance?: { from: string; to: string; fields: string[] }
  process?: string
  tips?: string[]
  [key: string]: unknown
}

interface Concept {
  name: string
  title: string
  description: string
  models: string[]
  tags: string[]
  details?: ConceptDetail
}

interface ModelAttribute {
  name: string
  label?: string
  type?: string
  required?: boolean
  immutable?: boolean
  description?: string
}

interface BusinessRule {
  name: string
  description: string
  severity: string
}

interface WorkflowRef {
  name: string
  title: string
  description: string
  tags: string[]
}

interface ModelContext {
  model: string
  readOnly?: boolean
  description?: string
  attributes?: ModelAttribute[]
  concepts?: Concept[]
  rules?: BusinessRule[]
  workflows?: WorkflowRef[]
}

/**
 * Get domain context for a model or concept
 *
 * Composes model field-level metadata (from model registry) with
 * cross-entity concepts, applicable business rules, and related workflows.
 */
export class GetDomainContextTool extends BaseDomainTool {
  override get name(): string {
    return 'get_domain_context'
  }

  override get baseDescription(): string {
    return `Get domain knowledge for a model or concept. Returns field semantics, cross-entity relationships, applicable business rules, and related workflows.

USE THIS TOOL WHEN:
- Analyzing or reviewing existing entities (rights, deals, scheduling) to interpret what the data means
- Before creating/modifying entities to understand required fields and constraints
- Troubleshooting issues like "No rights" status or validation failures
- Understanding how entities relate (e.g., deal -> rights -> platforms, requirements system)

Call this FIRST when asked to review, analyze, or explain rights, deals, rules, or scheduling data.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: z
        .string()
        .describe('Model name to get context for (e.g., "deal", "right", "rule", "scheduling")')
        .optional(),
      concept: z
        .string()
        .describe(
          'Specific concept name or search query (e.g., "deal_rights_hierarchy", "catch-up")'
        )
        .optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.requireDomainRegistry()
    const { model, concept } = args as { model?: string; concept?: string }

    if (!model && !concept) {
      return this.formatResponse(await this._formatOverview())
    }

    const parts: string[] = []

    // Model context
    if (model) {
      const context = (await this.domainRegistry.getContextForModel(
        model
      )) as unknown as ModelContext
      parts.push(this._formatModelContext(context))
    }

    // Concept lookup or search
    if (concept) {
      const exact = (await this.domainRegistry.getConcept(concept)) as unknown as
        | Concept
        | undefined
      if (exact) {
        parts.push(this._formatConcept(exact))
      } else {
        const results = (await this.domainRegistry.searchConcepts(concept)) as unknown as Concept[]
        if (results.length > 0) {
          parts.push(this._formatConceptSearch(concept, results))
        } else {
          parts.push(`No concepts found matching "${concept}".`)
        }
      }
    }

    return this.formatResponse(parts.join('\n\n---\n\n'))
  }

  private async _formatOverview(): Promise<string> {
    this.requireDomainRegistry()
    const [concepts, allWorkflows] = await Promise.all([
      this.domainRegistry.getAllConcepts() as unknown as Promise<Concept[]>,
      this.domainRegistry.getAllWorkflows() as unknown as Promise<WorkflowRef[]>
    ])

    const lines = ['# Domain Knowledge Overview', '']

    if (concepts.length > 0) {
      lines.push('## Concepts')
      for (const c of concepts) {
        lines.push(`- **${c.title}** (\`${c.name}\`) \u2014 ${c.description.split('.')[0]}.`)
      }
      lines.push('')
    }

    if (allWorkflows.length > 0) {
      lines.push('## Workflows')
      for (const w of allWorkflows) {
        const tags = w.tags.length > 0 ? ` [${w.tags.join(', ')}]` : ''
        lines.push(`- **${w.title}** (\`${w.name}\`)${tags} \u2014 ${w.description.split('.')[0]}.`)
      }
      lines.push('')
    }

    lines.push(
      'Use `model` parameter to get context for a specific model, or `concept` to look up a specific concept.'
    )
    return lines.join('\n')
  }

  private _formatModelContext(context: ModelContext): string {
    const readOnlySuffix = context.readOnly ? ' (Read-Only)' : ''
    const lines = [`# ${context.model} \u2014 Domain Context${readOnlySuffix}`, '']

    if (context.description) {
      lines.push(context.description, '')
    }

    // Attributes summary
    if (context.attributes && context.attributes.length > 0) {
      const hasImmutable = context.attributes.some((a) => a.immutable)
      const hasLabels = context.attributes.some((a) => a.label)
      lines.push('## Fields')
      if (hasImmutable) {
        lines.push('| Field | API Name | Type | Required | Immutable | Description |')
        lines.push('|-------|----------|------|----------|-----------|-------------|')
      } else if (hasLabels) {
        lines.push('| Field | API Name | Type | Required | Description |')
        lines.push('|-------|----------|------|----------|-------------|')
      } else {
        lines.push('| Field | Type | Required | Description |')
        lines.push('|-------|------|----------|-------------|')
      }
      for (const attr of context.attributes) {
        if (attr.description) {
          const displayName = attr.label || attr.name
          if (hasImmutable) {
            lines.push(
              `| ${displayName} | ${attr.name} | ${attr.type || '-'} | ${attr.required ? 'Yes' : 'No'} | ${attr.immutable ? 'Yes' : 'No'} | ${attr.description} |`
            )
          } else if (hasLabels) {
            lines.push(
              `| ${displayName} | ${attr.name} | ${attr.type || '-'} | ${attr.required ? 'Yes' : 'No'} | ${attr.description} |`
            )
          } else {
            lines.push(
              `| ${attr.name} | ${attr.type || '-'} | ${attr.required ? 'Yes' : 'No'} | ${attr.description} |`
            )
          }
        }
      }
      lines.push('')
    }

    // Cross-entity concepts
    if (context.concepts && context.concepts.length > 0) {
      lines.push('## Cross-Entity Concepts')
      for (const c of context.concepts) {
        lines.push(`### ${c.title}`)
        lines.push(c.description)
        if (c.details) {
          if (c.details.process) lines.push(`\n**Process:** ${c.details.process}`)
          if (c.details.tips) {
            lines.push('\n**Tips:**')
            for (const tip of c.details.tips) {
              lines.push(`- ${tip}`)
            }
          }
        }
        lines.push('')
      }
    }

    // Business rules
    if (context.rules && context.rules.length > 0) {
      lines.push('## Business Rules')
      for (const r of context.rules) {
        const severity =
          r.severity === 'error' ? '[ERROR]' : r.severity === 'warning' ? '[WARN]' : '[INFO]'
        lines.push(`- ${severity} **${r.name}**: ${r.description}`)
      }
      lines.push('')
    }

    // Related workflows
    if (context.workflows && context.workflows.length > 0) {
      lines.push('## Related Workflows')
      for (const w of context.workflows) {
        lines.push(`- **${w.title}** (\`${w.name}\`): ${w.description}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  private _formatConcept(concept: Concept): string {
    const lines = [`# Concept: ${concept.title}`, '']
    lines.push(concept.description, '')
    lines.push(`**Models:** ${concept.models.join(', ')}`)

    if (concept.tags.length > 0) {
      lines.push(`**Tags:** ${concept.tags.join(', ')}`)
    }

    if (concept.details) {
      if (concept.details.inheritance) {
        const inh = concept.details.inheritance
        lines.push(
          `\n**Inheritance:** ${inh.from} \u2192 ${inh.to} (fields: ${inh.fields.join(', ')})`
        )
      }
      if (concept.details.process) {
        lines.push(`\n**Process:** ${concept.details.process}`)
      }
      if (concept.details.tips) {
        lines.push('\n**Tips:**')
        for (const tip of concept.details.tips) {
          lines.push(`- ${tip}`)
        }
      }
    }

    return lines.join('\n')
  }

  private _formatConceptSearch(query: string, results: Concept[]): string {
    const lines = [`Found ${results.length} concept(s) matching "${query}":`, '']
    for (const c of results) {
      lines.push(`- **${c.title}** (\`${c.name}\`) \u2014 ${c.description.split('.')[0]}.`)
    }
    lines.push('', 'Use `concept: "<name>"` to get full details.')
    return lines.join('\n')
  }
}
