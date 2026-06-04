# Tools & Services

How tool classes hook into ModelService, the ApiClient pipeline, and the multi-step workflow runner.

**Read in this order:**

1. [Tool creation](./tool-creation.md) — the two layers (generic CRUD + server-specific), pipeline, interceptors, validators
2. [Service layer](./service-layer.md) — ModelService orchestrates EndpointResolver + Convention + ApiClient
3. [Workflow creation](./workflow-creation.md) — multi-step LLM-driven workflows; `get_workflow_step`, contextHints, the fetch-analyze loop
