import { z } from 'zod'
import { BaseDomainTool } from './base-domain-tool.js'

/**
 * Get domain context for a model or concept
 *
 * Composes model field-level metadata (from model registry) with
 * cross-entity concepts, applicable business rules, and related workflows.
 */
export class GetDomainContextTool extends BaseDomainTool {
  get name() {
    return 'get_domain_context'
  }

  get baseDescription() {
    return `Get domain knowledge for a model or concept. Returns field semantics, cross-entity relationships, applicable business rules, and related workflows.

USE THIS TOOL WHEN:
- Analyzing or reviewing existing entities (rights, deals, scheduling) to interpret what the data means
- Before creating/modifying entities to understand required fields and constraints
- Troubleshooting issues like "No rights" status or validation failures
- Understanding how entities relate (e.g., deal → rights → platforms, requirements system)

Call this FIRST when asked to review, analyze, or explain rights, deals, rules, or scheduling data.`
  }

  get inputSchema() {
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

  async execute(args) {
    this.requireDomainRegistry()
    const { model, concept } = args

    if (!model && !concept) {
      return this.formatResponse(this._formatOverview())
    }

    const parts = []

    // Model context
    if (model) {
      const context = this.domainRegistry.getContextForModel(model)
      parts.push(this._formatModelContext(context))
    }

    // Concept lookup or search
    if (concept) {
      const exact = this.domainRegistry.getConcept(concept)
      if (exact) {
        parts.push(this._formatConcept(exact))
      } else {
        const results = await this.domainRegistry.searchConcepts(concept)
        if (results.length > 0) {
          parts.push(this._formatConceptSearch(concept, results))
        } else {
          parts.push(`No concepts found matching "${concept}".`)
        }
      }
    }

    return this.formatResponse(parts.join('\n\n---\n\n'))
  }

  _formatOverview() {
    const concepts = this.domainRegistry.knowledge.getAllConcepts()
    const workflows = this.domainRegistry.workflows.getAllWorkflows()

    const lines = ['# Domain Knowledge Overview', '']

    if (concepts.length > 0) {
      lines.push('## Concepts')
      for (const c of concepts) {
        lines.push(`- **${c.title}** (\`${c.name}\`) — ${c.description.split('.')[0]}.`)
      }
      lines.push('')
    }

    if (workflows.length > 0) {
      lines.push('## Workflows')
      for (const w of workflows) {
        const tags = w.tags.length > 0 ? ` [${w.tags.join(', ')}]` : ''
        lines.push(`- **${w.title}** (\`${w.name}\`)${tags} — ${w.description.split('.')[0]}.`)
      }
      lines.push('')
    }

    lines.push(
      'Use `model` parameter to get context for a specific model, or `concept` to look up a specific concept.'
    )
    return lines.join('\n')
  }

  _formatModelContext(context) {
    const readOnlySuffix = context.readOnly ? ' (Read-Only)' : ''
    const lines = [`# ${context.model} — Domain Context${readOnlySuffix}`, '']

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

  _formatConcept(concept) {
    const lines = [`# Concept: ${concept.title}`, '']
    lines.push(concept.description, '')
    lines.push(`**Models:** ${concept.models.join(', ')}`)

    if (concept.tags.length > 0) {
      lines.push(`**Tags:** ${concept.tags.join(', ')}`)
    }

    if (concept.details) {
      if (concept.details.inheritance) {
        const inh = concept.details.inheritance
        lines.push(`\n**Inheritance:** ${inh.from} → ${inh.to} (fields: ${inh.fields.join(', ')})`)
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

  _formatConceptSearch(query, results) {
    const lines = [`Found ${results.length} concept(s) matching "${query}":`, '']
    for (const c of results) {
      lines.push(`- **${c.title}** (\`${c.name}\`) — ${c.description.split('.')[0]}.`)
    }
    lines.push('', 'Use `concept: "<name>"` to get full details.')
    return lines.join('\n')
  }
}
