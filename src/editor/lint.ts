import { linter, lintGutter } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { syntaxTree } from '@codemirror/language'
import { t } from '../lib/i18n'

/**
 * Syntax-error diagnostics from the loaded grammar: lezer parks parse errors
 * in ⚠ (error) nodes, so a working grammar gives red squiggles for free —
 * no external linter involved. StreamLanguage grammars (legacy modes) don't
 * produce error nodes, so those files simply stay quiet.
 */

/** Don't descend into an error node — nested errors describe the same
 * problem and would paint overlapping squiggles. Zero-length error nodes
 * (missing-token hints) and same-range duplicates are skipped: several
 * grammars emit a cluster at one position and four overlapping dots read
 * as noise. */
const syntaxErrorLinter = linter(
  (view) => {
    const diags: Diagnostic[] = []
    const seen = new Set<string>()
    syntaxTree(view.state).iterate({
      enter(node) {
        if (!node.type.isError) return
        if (node.to > node.from) {
          const key = `${node.from}:${node.to}`
          if (!seen.has(key)) {
            seen.add(key)
            diags.push({
              from: node.from,
              to: node.to,
              severity: 'error',
              message: t('lint.syntaxError'),
            })
          }
        }
        return false
      },
    })
    return diags
  },
  // Debounced so mid-typing incomplete constructs don't flash red constantly.
  { delay: 750 },
)

export const syntaxLint = [syntaxErrorLinter, lintGutter()]
