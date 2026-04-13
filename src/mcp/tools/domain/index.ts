import { GetDomainContextTool } from './get-domain-context-tool.js'
import { CheckBusinessRulesTool } from './check-business-rules-tool.js'
import { SuggestWorkflowTool } from './suggest-workflow-tool.js'
import { GetWorkflowStepTool } from './get-workflow-step-tool.js'

export { BaseDomainTool } from './base-domain-tool.js'
export { GetDomainContextTool, CheckBusinessRulesTool, SuggestWorkflowTool, GetWorkflowStepTool }

/** All domain tool classes mapped by tool name */
export const DOMAIN_TOOL_CLASSES = {
  get_domain_context: GetDomainContextTool,
  check_business_rules: CheckBusinessRulesTool,
  suggest_workflow: SuggestWorkflowTool,
  get_workflow_step: GetWorkflowStepTool
}
