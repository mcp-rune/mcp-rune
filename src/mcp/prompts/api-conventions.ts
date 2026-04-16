/**
 * Re-export shim -- conventions moved to lib/mcp/api-conventions/.
 *
 * Keeps existing model imports working without a mass-rename.
 */
export {
  BaseConvention,
  defaultConvention,
  halConvention,
  jsonApiConvention
} from '../api-conventions/index.js'
